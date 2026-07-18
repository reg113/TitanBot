import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    PermissionFlagsBits 
} from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('sendembed')
        .setDescription('Send a custom user-headed embed to a specific channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Restrict to staff/admins by default
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The text message to display inside the embed body')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('The Discord User ID of the person for the header')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('channel_id')
                .setDescription('The target Channel ID where the embed will be sent')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        // Defer ephemerally so the person running the command sees a quiet execution status
        const deferred = await interaction.deferReply({ ephemeral: true });
        if (!deferred) return;

        const messageContent = interaction.options.getString('message');
        const targetUserId = interaction.options.getString('user_id').trim();
        const targetChannelId = interaction.options.getString('channel_id').trim();

        try {
            // 1. Fetch the target channel
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
            if (!targetChannel) {
                return interaction.editReply({ content: '❌ Could not find a channel with that ID. Ensure the bot has access to it.' });
            }

            if (!targetChannel.isTextBased()) {
                return interaction.editReply({ content: '❌ The target channel must be a text-based channel!' });
            }

            // 2. Fetch the target user
            const targetUser = await client.users.fetch(targetUserId).catch(() => null);
            if (!targetUser) {
                return interaction.editReply({ content: '❌ Could not find a Discord user with that ID.' });
            }

            // 3. Build the custom embed
            const embed = new EmbedBuilder()
                .setColor('#5865F2') // Blurple branding color, tweak as desired
                .setAuthor({
                    name: targetUser.username,
                    iconURL: targetUser.displayAvatarURL({ forceStatic: false })
                })
                .setDescription(messageContent)
                .setTimestamp();

            // 4. Dispatch the embed package
            await targetChannel.send({ embeds: [embed] });

            // 5. Log activity and notify executor
            logger.info(`[COMMANDS] Custom embed dispatched to channel ${targetChannelId} profiling user ${targetUserId} by staff member ${interaction.user.id}`);
            
            await interaction.editReply({ content: `✅ Embed successfully sent to ${targetChannel.toString()}!` });

        } catch (err) {
            logger.error('[COMMANDS] Failed executing sendembed tool script structure', err);
            await interaction.editReply({ content: '💥 A critical system error occurred while transmitting the embed layout.' });
        }
    }, { command: 'sendembed' })
};
