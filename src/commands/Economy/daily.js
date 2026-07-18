import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ENTRY_FEE = 150;
const PEARDIVE_COOLDOWN = 45 * 1000; // 45-second cooldown between dives
const STANDARD_OYSTER_VALUE = 80;
const RARE_PEARL_VALUE = 300;

export default {
    data: new SlashCommandBuilder()
        .setName('pearldive')
        .setDescription('Rent a dhow boat and dive the Persian Gulf reef for legendary pearls!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        logger.debug(`[ECONOMY] Pearl dive expedition started for ${userId}`, { userId, guildId });

        // 1. Fetch Economy Data & Validate Balance
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData) {
            throw createError(
                "Failed to load economy data for pearldive",
                ErrorTypes.DATABASE,
                "Failed to load your economy data. Please try again later.",
                { userId, guildId }
            );
        }

        // 2. Cooldown check
        const lastPearlDive = userData.lastPearlDive || 0;
        if (now < lastPearlDive + PEARDIVE_COOLDOWN) {
            const timeRemaining = lastPearlDive + PEARDIVE_COOLDOWN - now;
            throw createError(
                "Pearl dive cooldown active",
                ErrorTypes.RATE_LIMIT,
                `Your lungs need time to recover! Please wait **${formatDuration(timeRemaining)}** before diving again.`,
                { timeRemaining, cooldownType: 'pearldive' }
            );
        }

        // 3. Check Balance
        const walletBalance = userData.wallet || 0;
        if (walletBalance < ENTRY_FEE) {
            throw createError(
                "Insufficient funds",
                ErrorTypes.VALIDATION,
                `You don't have enough money to rent a *dhow* boat! Renting a boat and hiring divers costs **$${ENTRY_FEE}**.\n\nYour Balance: **$${walletBalance.toLocaleString()}**`,
                { userId, guildId, wallet: walletBalance }
            );
        }

        // 4. Deduct fee immediately & apply cooldown to prevent exploits
        userData.wallet = walletBalance - ENTRY_FEE;
        userData.lastPearlDive = now;
        await setEconomyData(client, guildId, userId, userData);

        logger.info(`[ECONOMY_TRANSACTION] Pearl dive fee paid`, {
            userId,
            guildId,
            amount: -ENTRY_FEE,
            newWallet: userData.wallet,
            timestamp: new Date().toISOString()
        });

        // 5. Initialize Game State
        const state = {
            oxygen: 100,
            standardOysters: 0,
            rareOysters: 0,
            lastActionLog: '🚢 You sailed out of port and dropped anchor over the deep pearl beds. Take your first dive!',
            trackDisplay: '',
            targetSlot: 1
        };

        // Helper to generate the randomized Tide Alignment Track
        function generateTideTrack() {
            const target = Math.floor(Math.random() * 5) + 1; // 1 to 5
            let track = ['🟥', '🟥', '🟥', '🟥', '🟥'];
            
            track[target - 1] = '🟩'; // Sweet Spot
            
            // Generate yellow buffer margins around the sweet spot
            if (target - 2 >= 0) track[target - 2] = '🟨';
            if (target < 5) track[target] = '🟨';

            state.targetSlot = target;
            state.trackDisplay = `[ ${track.join(' ')} ]`;
        }

        // Helper to format a clean visual oxygen bar
        function getOxygenBar(oxygen) {
            const totalBars = 10;
            const filledBars = Math.max(0, Math.min(totalBars, Math.round(oxygen / 10)));
            const emptyBars = totalBars - filledBars;
            return `[${'█'.repeat(filledBars)}${'░'.repeat(emptyBars)}] **${Math.max(0, oxygen)}%**`;
        }

        // Helper to construct active gameplay embed
        function buildGameEmbed() {
            return infoEmbed(
                "⚓ Deep Sea Pearl Dive",
                state.lastActionLog
            )
            .addFields(
                { name: '🌊 Current Tide Drift', value: `\`\`\`\n${state.trackDisplay}\n   1   2   3   4   5\n\`\`\`` },
                { name: '🔋 Oxygen Reserves', value: getOxygenBar(state.oxygen) },
                { name: '🎒 Dive Bag', value: `🦪 **${state.standardOysters}** Standard Oysters\n✨ **${state.rareOysters}** Rare Black Pearls` }
            )
            .setFooter({ text: 'The deeper you go, the higher the risk. Surface before your oxygen runs dry!' });
        }

        // Helper to build action rows
        function buildGameControls(disabled = false) {
            const row1 = new ActionRowBuilder();
            for (let i = 1; i <= 5; i++) {
                row1.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`grab_${i}`)
                        .setLabel(`${i}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(disabled)
                );
            }

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('surface')
                    .setLabel('⛵ Return to Surface & Sell')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(disabled),
                new ButtonBuilder()
                    .setCustomId('abort')
                    .setLabel('🚨 Panic Surface (No Loot)')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(disabled)
            );

            return [row1, row2];
        }

        // Render initial game state
        generateTideTrack();
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [buildGameEmbed()],
            components: buildGameControls()
        });

        // 6. Component Collector
        const response = await interaction.fetchReply();
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000 // 3-minute hard limit
        });

        collector.on('collect', async (btnInteraction) => {
            if (btnInteraction.user.id !== userId) {
                return btnInteraction.reply({ 
                    content: "This is not your expedition! Use `/pearldive` to start your own.", 
                    ephemeral: true 
                });
            }

            await btnInteraction.deferUpdate();

            if (btnInteraction.customId.startsWith('grab_')) {
                const clickedNum = parseInt(btnInteraction.customId.split('_')[1]);
                const distance = Math.abs(clickedNum - state.targetSlot);

                if (distance === 0) {
                    state.rareOysters += 1;
                    state.oxygen -= 8;
                    state.lastActionLog = `🎯 **Perfect grab!** You cleanly snatched a massive oyster containing a **Rare Black Pearl**! (-8% Oxygen)`;
                } else if (distance === 1) {
                    state.standardOysters += 1;
                    state.oxygen -= 15;
                    state.lastActionLog = `🦪 **Decent grab.** You fought the currents and gathered a standard oyster. (-15% Oxygen)`;
                } else {
                    state.oxygen -= 30;
                    state.lastActionLog = `💥 **Missed!** You slammed your hands against sharp coral trying to reach the oysters. (-30% Oxygen)`;
                }

                // Check for Drowning
                if (state.oxygen <= 0) {
                    collector.stop('drowned');
                    return;
                }

                generateTideTrack();
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed()],
                    components: buildGameControls()
                });

            } else if (btnInteraction.customId === 'surface') {
                collector.stop('surfaced');
            } else if (btnInteraction.customId === 'abort') {
                collector.stop('aborted');
            }
        });

        collector.on('end', async (collected, reason) => {
            const disabledControls = buildGameControls(true);

            if (reason === 'surfaced') {
                const totalGoldEarned = (state.standardOysters * STANDARD_OYSTER_VALUE) + (state.rareOysters * RARE_PEARL_VALUE);
                const netProfit = totalGoldEarned - ENTRY_FEE;

                // Load fresh economy data to prevent transaction race conditions during active playtime
                const freshUserData = await getEconomyData(client, guildId, userId);
                if (freshUserData) {
                    freshUserData.wallet = (freshUserData.wallet || 0) + totalGoldEarned;
                    // FIX: Commit the earnings update back to the database!
                    await setEconomyData(client, guildId, userId, freshUserData);
                }

                logger.info(`[ECONOMY_TRANSACTION] Pearl dive completed successfully`, {
                    userId,
                    guildId,
                    earned: totalGoldEarned,
                    netProfit: netProfit,
                    newWallet: freshUserData ? freshUserData.wallet : 'Unknown',
                    timestamp: new Date().toISOString()
                });

                const winEmbed = successEmbed(
                    "⛵ Safe Return to Harbor!",
                    `Your crew hauled you back onto the deck of your *dhow* boat. You safely cracked open your oysters on the way back to port!`
                )
                .addFields(
                    { name: '📦 Haul Sold', value: `🦪 **${state.standardOysters}** Standard Oysters × $${STANDARD_OYSTER_VALUE}\n✨ **${state.rareOysters}** Rare Pearls × $${RARE_PEARL_VALUE}` },
                    { name: '💰 Total Revenue', value: `**$${totalGoldEarned.toLocaleString()}**`, inline: true },
                    { name: '📈 Net Profit', value: `${netProfit >= 0 ? '🟢 +' : '🔴 '}$${netProfit.toLocaleString()}`, inline: true }
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [winEmbed], components: disabledControls });

            } else if (reason === 'drowned') {
                logger.info(`[ECONOMY_TRANSACTION] Pearl dive failed (Drowned)`, {
                    userId,
                    guildId,
                    loss: ENTRY_FEE,
                    timestamp: new Date().toISOString()
                });

                const loseEmbed = errorEmbed(
                    "🦈 Blackout in the Deep!",
                    `Your oxygen tank ran completely empty! Your vision faded to black under the waves. Your crew managed to pull you back up just in time, but **your dive bag was swept away by the deep currents**.\n\nLoss: **-$${ENTRY_FEE}** (Rent & Medical Fees)`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [loseEmbed], components: disabledControls });

            } else if (reason === 'aborted') {
                logger.info(`[ECONOMY_TRANSACTION] Pearl dive aborted by user`, {
                    userId,
                    guildId,
                    loss: ENTRY_FEE,
                    timestamp: new Date().toISOString()
                });

                const abortEmbed = warningEmbed(
                    "🚨 Panic Ascent!",
                    `You panicked and pulled your emergency anchor rope to float straight back to the surface. You dropped your dive bag to ascend faster.\n\nLoss: **-$${ENTRY_FEE}** (Rent Fees)`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [abortEmbed], components: disabledControls });

            } else {
                // Timeout handler
                const timeoutEmbed = warningEmbed(
                    "⌛ Expedition Abandoned",
                    `You waited too long to make your next move, and your dhow captain returned to the harbor without you.`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [timeoutEmbed], components: disabledControls });
            }
        });
    }, { command: 'pearldive' })
};
