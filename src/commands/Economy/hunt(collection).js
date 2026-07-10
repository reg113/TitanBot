import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMAL_LIST } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('collection')
        .setDescription('View your or another user\'s lifetime hunting achievements')
        .addUserOption(option => 
            option.setName('user').setDescription('The user whose achievements you want to look at').setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userData = await getEconomyData(client, interaction.guildId, targetUser.id);
        
        // This relies on your hunting script saving lifetime catches here:
        const discoveredBook = userData.zoo_discovered || {}; 

        let uniqueDiscovered = 0;
        const totalUniqueAnimals = ANIMAL_LIST.length;

        const tiers = {
            'LEGENDARY': [],
            'EPIC': [],
            'RARE': [],
            'UNCOMMON': [],
            'COMMON': []
        };

        for (const animal of ANIMAL_LIST) {
            const hasDiscovered = discoveredBook[animal.id] || (userData.zoo && userData.zoo[animal.id] > 0);
            
            let displayLine;
            if (hasDiscovered) {
                uniqueDiscovered++;
                displayLine = `✅ ${animal.emoji} **${animal.name}**`;
            } else {
                displayLine = `❌ ❓ *Undiscovered*`;
            }

            if (animal.maxPrice > 4000) tiers['LEGENDARY'].push(displayLine);
            else if (animal.maxPrice > 400) tiers['EPIC'].push(displayLine);
            else if (animal.maxPrice > 100) tiers['RARE'].push(displayLine);
            else if (animal.maxPrice > 35) tiers['UNCOMMON'].push(displayLine);
            else tiers['COMMON'].push(displayLine);
        }

        const completionPercent = Math.round((uniqueDiscovered / totalUniqueAnimals) * 100);
        const barFilled = Math.round(completionPercent / 10);
        const progressBar = '🏆'.repeat(barFilled) + '⬛'.repeat(10 - barFilled);

        const embed = createEmbed({
            title: `🏆 HUNTING DEX: ${targetUser.username.toUpperCase()}`,
            color: "#F1C40F"
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(
            `\`\`\`yaml\n` +
            `Overall Completion: ${uniqueDiscovered}/${totalUniqueAnimals} (${completionPercent}%)\n` +
            `\`\`\`\n` +
            `${progressBar}\n⠀`
        );

        for (const [tierName, animals] of Object.entries(tiers)) {
            embed.addFields({
                name: `✨ ${tierName}`,
                value: animals.join('\n'),
                inline: true
            });
        }

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'collection' })
};
