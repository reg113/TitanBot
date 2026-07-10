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

        let zooDescription = "";
        
        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                zooDescription += `${animal.emoji} **${animal.name}**: \`x${count}\`\n`;
            }
        }

        const embed = createEmbed({
            title: `🐾 ${targetUser.username}'s Zoo Collection`,
            description: zooDescription || "This zoo is completely empty! Run `/hunt` to find some animals.",
            color: "primary"
        }).setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
