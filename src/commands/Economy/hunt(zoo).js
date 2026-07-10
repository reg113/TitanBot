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
        .setDescription('Display your or another users animal collection')
        .addUserOption(option => 
            option.setName('user').setDescription('The user whose zoo you want to look at').setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userData = await getEconomyData(client, interaction.guildId, targetUser.id);
        const userZoo = userData.zoo || {};

        // Categorize animals by value brackets for a cleaner layout
        const tiers = {
            '🌟 Mythical Rarities': [],
            '🏆 Apex Predators': [],
            '🌲 Wilderness Wildlife': [],
            '🏡 Backyard Critters': []
        };

        let totalAnimals = 0;

        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                totalAnimals += count;
                const displayLine = `${animal.emoji} \`${count.toString().padEnd(3)}\` **${animal.name}**`;
                
                // Sort into visual sections based on maximum value
                if (animal.maxPrice > 4000) {
                    tiers['🌟 Mythical Rarities'].push(displayLine);
                } else if (animal.maxPrice > 400) {
                    tiers['🏆 Apex Predators'].push(displayLine);
                } else if (animal.maxPrice > 100) {
                    tiers['🌲 Wilderness Wildlife'].push(displayLine);
                } else {
                    tiers['🏡 Backyard Critters'].push(displayLine);
                }
            }
        }

        const embed = createEmbed({
            title: `🐾 ${targetUser.username}'s Grand Sanctuary`,
            color: "#2ECC71" // Premium emerald green theme
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(`*Managing a thriving ecosystem of **${totalAnimals}** total animals.*\n\n━━━ 🌿 **SANCTUARY EXHIBITS** 🌿 ━━━`);

        let hasAnimals = false;

        for (const [tierName, animals] of Object.entries(tiers)) {
            if (animals.length > 0) {
                hasAnimals = true;
                // Formats items into a clean code block style vertical layout
                embed.addFields({
                    name: `\n${tierName}`,
                    value: animals.join('\n'),
                    inline: false
                });
            }
        }

        if (!hasAnimals) {
            embed.setDescription(`*This sanctuary is currently empty.*\n\nUse \`/hunt\` to venture into the wild and capture your first exhibits!`);
        }

        embed.setFooter({ text: `TitanBot Nature Reserve • View value ranges with /sell` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
