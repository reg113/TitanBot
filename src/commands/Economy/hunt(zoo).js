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
            '🔮 ✧ M Y T H I C A L ✧ 🔮': [],
            '👑 ✧ A P E X  P R E D A T O R S ✧ 👑': [],
            '🌲 ✧ W I L D L I F E ✧ 🌲': [],
            '🏡 ✧ C R I T T E R S ✧ 🏡': []
        };

        let totalAnimals = 0;

        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                totalAnimals += count;
                const displayLine = `> ${animal.emoji} \`x${count.toString().padEnd(3)}\` **${animal.name}**`;
                
                if (animal.maxPrice > 4000) {
                    tiers['🔮 ✧ M Y T H I C A L ✧ 🔮'].push(displayLine);
                } else if (animal.maxPrice > 400) {
                    tiers['👑 ✧ A P E X  P R E D A T O R S ✧ 👑'].push(displayLine);
                } else if (animal.maxPrice > 100) {
                    tiers['🌲 ✧ W I L D L I F E ✧ 🌲'].push(displayLine);
                } else {
                    tiers['🏡 ✧ C R I T T E R S ✧ 🏡'].push(displayLine);
                }
            }
        }

        const embed = createEmbed({
            title: `🐾 ${targetUser.username}'s Nature Sanctuary`,
            color: "#2ECC71" 
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(`*Managing a thriving ecosystem of **${totalAnimals}** total animals.*\n\n╔════════════════════════╗\n   🌿   **S A N C T U A R Y   E X H I B I T S**   🌿\n╚════════════════════════╝`);

        let hasAnimals = false;

        for (const [tierName, animals] of Object.entries(tiers)) {
            if (animals.length > 0) {
                hasAnimals = true;
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

        embed.setFooter({ text: `TitanBot Reserve • Challenge them with /battle` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
