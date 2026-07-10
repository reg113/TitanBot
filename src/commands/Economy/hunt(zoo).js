import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData } from '../../utils/economy.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ANIMAL_DISPLAY = {
    rabbit: { name: 'Rabbit', emoji: '🐇' },
    duck: { name: 'Duck', emoji: '🦆' },
    deer: { name: 'Deer', emoji: '🦌' },
    bear: { name: 'Bear', emoji: '🐻' },
    unicorn: { name: 'Unicorn', emoji: '🦄' }
};

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
        
        for (const [id, info] of Object.entries(ANIMAL_DISPLAY)) {
            const count = userZoo[id] || 0;
            zooDescription += `${info.emoji} **${info.name}**: \`x${count}\`\n`;
        }

        const embed = createEmbed({
            title: `🐾 ${targetUser.username}'s Zoo Collection`,
            description: zooDescription || "This zoo is completely empty! Run `/hunt` to find some animals.",
            color: "primary"
        }).setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'zoo' })
};
