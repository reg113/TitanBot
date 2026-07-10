import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMAL_LIST } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('zoo')
        .setDescription('Display your or another user\'s animal collection')
        .addUserOption(option => 
            option.setName('user').setDescription('The user whose zoo you want to look at').setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userData = await getEconomyData(client, interaction.guildId, targetUser.id);
        const userZoo = userData.zoo || {};

        // Track stats for the overview panel
        let uniqueDiscovered = 0;
        const totalUniqueAnimals = ANIMAL_LIST.length;
        let totalCount = 0;

        const tiers = {
            'LEGENDARY': [],
            'EPIC': [],
            'RARE': [],
            'UNCOMMON': [],
            'COMMON': []
        };

        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                totalCount += count;
                uniqueDiscovered++;
                
                // RPG Inventory Style Grid Formatting
                const displayLine = `\`[x${count.toString().padEnd(2)}]\` ${animal.emoji} **${animal.name}**`;
                
                if (animal.maxPrice > 4000) {
                    tiers['LEGENDARY'].push(displayLine);
                } else if (animal.maxPrice > 400) {
                    tiers['EPIC'].push(displayLine);
                } else if (animal.maxPrice > 100) {
                    tiers['RARE'].push(displayLine);
                } else if (animal.maxPrice > 35) {
                    tiers['UNCOMMON'].push(displayLine);
                } else {
                    tiers['COMMON'].push(displayLine);
                }
            }
        }

        // Generate a clean game-style progress bar
        const completionPercent = Math.round((uniqueDiscovered / totalUniqueAnimals) * 100);
        const barFilled = Math.round(completionPercent / 10);
        const progressBar = '🟩'.repeat(barFilled) + '⬛'.repeat(10 - barFilled);

        const embed = createEmbed({
            title: `📋 COLLECTION PROFILE: ${targetUser.username.toUpperCase()}`,
            color: "#2ECC71" 
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(
            `\`\`\`yaml\n` +
            `Total Animals: ${totalCount}\n` +
            `Discovery:     ${uniqueDiscovered}/${totalUniqueAnimals} (${completionPercent}%)\n` +
            `\`\`\`\n` +
            `${progressBar}`
        );

        let hasAnimals = false;

        for (const [tierName, animals] of Object.entries(tiers)) {
            if (animals.length > 0) {
                hasAnimals = true;
                
                // Splits items into clean, scannable blocks
                embed.addFields({
                    name: `─── ${tierName} ───`,
                    value: animals.join('\n'),
                    inline: false
                });
            }
        }

        if (!hasAnimals) {
            embed.setDescription(
                `\`\`\`yaml\n` +
                `Total Animals: 0\n` +
                `Discovery:     0/${totalUniqueAnimals} (0%)\n` +
                `\`\`\`\n` +
                `⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛\n\n` +
                `❌ No records found. Run \`/hunt\` to populate your collection.`
            );
        }

        embed.setFooter({ text: `SYSTEM LOG • Run /battle to duel other collectors` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
