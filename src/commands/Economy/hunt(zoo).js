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

        const tiers = {
            'LEGENDARY': [],
            'EPIC': [],
            'RARE': [],
            'UNCOMMON': [],
            'COMMON': []
        };

        let totalAnimals = 0;

        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                totalAnimals += count;
                const displayLine = `${animal.emoji} \`x${count.toString().padEnd(2)}\` **${animal.name}**`;
                
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

        const embed = createEmbed({
            title: `🐾 ${targetUser.username}'s Zoo Collection`,
            color: "#2ECC71" 
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(`Total Animals: **${totalAnimals}**`);

        let hasAnimals = false;

        for (const [tierName, animals] of Object.entries(tiers)) {
            if (animals.length > 0) {
                hasAnimals = true;
                embed.addFields({
                    name: tierName,
                    value: animals.join('\n'),
                    inline: false
                });
            }
        }

        if (!hasAnimals) {
            embed.setDescription(`This zoo is empty.\n\nUse \`/hunt\` to catch your first animals.`);
        }

        embed.setFooter({ text: `TitanBot Reserve • Challenge them with /battle` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
