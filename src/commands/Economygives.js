import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('addmoney')
        .setDescription('Generate money and add it to a user wallet (Admin Only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Restricts visibility to server admins
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to receive the generated money')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of cash to generate')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
        const targetUser = interaction.options.getUser("user");
        const targetId = targetUser.id;
        const guildId = interaction.guildId;
        const generateAmount = interaction.options.getInteger("amount");

        // Prevent generating money for bots
        if (targetUser.bot) {
            throw createError(
                "Invalid Target",
                ErrorTypes.VALIDATION,
                "You cannot add money to a bot.",
                { targetId }
            );
        }

        // Fetch economy data for the target user
        const targetData = await getEconomyData(client, guildId, targetId);

        // Generate the cash out of thin air and add it
        targetData.wallet = (targetData.wallet || 0) + generateAmount;

        // Save the updated balance back to the database
        await setEconomyData(client, guildId, targetId, targetData);

        // Build the success response
        const resultEmbed = successEmbed(
            "🪙 Money Generated!",
            `Successfully generated **$${generateAmount.toLocaleString()}** and added it to ${targetUser}'s wallet.`
        );

        resultEmbed.addFields({
            name: "New Wallet Balance",
            value: `$${targetData.wallet.toLocaleString()}`,
            inline: true,
        });

        resultEmbed.setFooter({
            text: `Admin action performed by ${interaction.user.tag}`,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'addmoney' })
};
