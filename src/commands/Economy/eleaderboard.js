import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    MessageFlags 
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("eleaderboard")
        .setDescription("View the server's top 10 richest users.")
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        logger.debug(`[ECONOMY] Leaderboard requested`, { guildId });

        const prefix = `economy:${guildId}:`;
        let allKeys = await client.db.list(prefix);

        if (!Array.isArray(allKeys)) {
            allKeys = [];
        }

        if (allKeys.length === 0) {
            throw createError(
                "No economy data found",
                ErrorTypes.VALIDATION,
                "No economy data found for this server."
            );
        }

        // 1. Gather and format data utilizing the exact layout type checks from your balance command
        const allUserData = [];
        for (const key of allKeys) {
            const userId = key.replace(prefix, "");
            const userData = await client.db.get(key);

            if (userData) {
                // Safeguards copied directly from balance tracking parameters
                const wallet = typeof userData.wallet === 'number' ? userData.wallet : 0;
                const bank = typeof userData.bank === 'number' ? userData.bank : 0;
                
                allUserData.push({
                    userId: userId,
                    wallet: wallet,
                    bank: bank, // Saved explicitly to allow standalone bank sorting
                    total: wallet + bank,
                });
            }
        }

        if (allUserData.length === 0) {
            throw createError(
                "No economy data found",
                ErrorTypes.VALIDATION,
                "No economy data found for this server."
            );
        }

        // Pre-sort data pools for lightning-fast button switches
        const cashSorted = [...allUserData].sort((a, b) => b.wallet - a.wallet);
        const bankSorted = [...allUserData].sort((a, b) => b.bank - a.bank);
        const totalSorted = [...allUserData].sort((a, b) => b.total - a.total);

        const rankEmoji = ["🥇", "🥈", "🥉"];

        // 2. Page Generation Matrix Helper
        const generateLeaderboardPage = (pageType) => {
            let sortedList;
            let title;
            let formatIcon;

            // Resolve layout parameters depending on active page selection
            if (pageType === 'cash') {
                sortedList = cashSorted;
                title = `💵 Cash Leaderboard`;
                formatIcon = '💵';
            } else if (pageType === 'bank') {
                sortedList = bankSorted;
                title = `💳 Bank Leaderboard`;
                formatIcon = '💳';
            } else {
                sortedList = totalSorted;
                title = `💰 Total Wealth Leaderboard`;
                formatIcon = '💰';
            }

            const topUsers = sortedList.slice(0, 10);
            
            // Calculate running execution user's relative position
            const rawRank = sortedList.findIndex((u) => u.userId === interaction.user.id);
            const userRank = rawRank !== -1 ? rawRank + 1 : 0;
            
            const leaderboardEntries = [];

            for (let i = 0; i < topUsers.length; i++) {
                const user = topUsers[i];
                const rank = i + 1;
                const emoji = rankEmoji[i] || `**#${rank}**`;
                
                let value;
                if (pageType === 'cash') value = user.wallet;
                else if (pageType === 'bank') value = user.bank;
                else value = user.total;

                leaderboardEntries.push(
                    `${emoji} <@${user.userId}> - ${formatIcon} $${value.toLocaleString()}`
                );
            }

            const description = leaderboardEntries.length > 0
                ? leaderboardEntries.join("\n")
                : "No economy data is available for this server yet.";

            const embed = createEmbed({
                title,
                description,
                footer: `Your Rank: ${userRank > 0 ? `#${userRank}` : "No ranking data available"}`,
            });

            // Interactive Buttons Setup
            const cashButton = new ButtonBuilder()
                .setCustomId('leaderboard_cash')
                .setLabel('Cash Only')
                .setEmoji('💵')
                .setStyle(pageType === 'cash' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(pageType === 'cash');

            const bankButton = new ButtonBuilder()
                .setCustomId('leaderboard_bank')
                .setLabel('Bank Only')
                .setEmoji('💳')
                .setStyle(pageType === 'bank' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(pageType === 'bank');

            const totalButton = new ButtonBuilder()
                .setCustomId('leaderboard_total')
                .setLabel('Total Wealth')
                .setEmoji('💰')
                .setStyle(pageType === 'total' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(pageType === 'total');

            const row = new ActionRowBuilder().addComponents(cashButton, bankButton, totalButton);

            return { embeds: [embed], components: [row] };
        };

        // 3. Render initial base layout (Defaults to Cash Only)
        let currentPage = 'cash';
        const initialPayload = generateLeaderboardPage(currentPage);
        
        await InteractionHelper.safeEditReply(interaction, initialPayload);

        logger.info(`[ECONOMY] Interactive Leaderboard initialized`, { 
            guildId, 
            userCount: allUserData.length 
        });

        // 4. Setup Component Collector by explicitly fetching the message reply first
        const replyMessage = await interaction.fetchReply(); 
        const collector = replyMessage.createMessageComponentCollector({ 
            componentType: ComponentType.Button,
            time: 60000 // Interface expires after 60 seconds of inactivity
        });

        collector.on('collect', async (btnInteraction) => {
            // Guard clause: Only allow the command runner to toggle values
            if (btnInteraction.user.id !== interaction.user.id) {
                await btnInteraction.reply({
                    content: "❌ Run `/eleaderboard` yourself to look through this server's statistics!",
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Map button Custom IDs directly to our internal page types
            if (btnInteraction.customId === 'leaderboard_cash') {
                currentPage = 'cash';
            } else if (btnInteraction.customId === 'leaderboard_bank') {
                currentPage = 'bank';
            } else {
                currentPage = 'total';
            }

            const updatedPayload = generateLeaderboardPage(currentPage);
            await btnInteraction.update(updatedPayload).catch(() => {});
        });

        collector.on('end', async () => {
            // Cleanup: Drop UI components instantly upon lifecycle expiration
            const disabledPayload = generateLeaderboardPage(currentPage);
            disabledPayload.components = []; 

            await InteractionHelper.safeEditReply(interaction, disabledPayload).catch(() => {});
        });

    }, { command: 'eleaderboard' })
};
