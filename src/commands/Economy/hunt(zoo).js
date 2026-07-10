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
        
        // If a tier has too many animals, chunk them into separate columns
        // Discord allows up to ~1024 characters per field value, so chunking keeps it clean.
        const chunkSize = 5; // Adjust based on how many items you want per column
        for (let i = 0; i < animals.length; i += chunkSize) {
            const chunk = animals.slice(i, i + chunkSize);
            
            embed.addFields({
                // Only show the Tier Name on the first column chunk, otherwise keep it clean or label it "Cont."
                name: i === 0 ? `✨ ${tierName}` : `${tierName} (Cont.)`,
                value: chunk.join('\n'),
                inline: true // 👈 This enables the side-by-side columns
            });
        }
    }
}
