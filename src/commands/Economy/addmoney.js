import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give some of your money to another user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user you want to give money to')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of cash to transfer')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
        const senderId = interaction.user.id;
        const targetUser = interaction.options.getUser("user");
        const targetId = targetUser.id;
        const guildId = interaction.guildId;
        const transferAmount = interaction.options.getInteger("amount");

        // Prevent users from giving money to themselves
        if (senderId === targetId) {
            throw createError(
                "Invalid Target",
                ErrorTypes.VALIDATION,
                "You cannot transfer money to yourself.",
                { senderId, targetId }
            );
        }

        // Prevent transferring money to bots
        if (targetUser.bot) {
            throw createError(
                "Invalid Target",
                ErrorTypes.VALIDATION,
                "You cannot transfer money to a bot.",
                { targetId }
            );
        }

        // Fetch economy data for both users
        const senderData = await getEconomyData(client, guildId, senderId);
        const targetData = await getEconomyData(client, guildId, targetId);

        // Check if sender has enough money
        if ((senderData.wallet || 0) < transferAmount) {
            throw createError(
                "Insufficient cash for transfer",
                ErrorTypes.VALIDATION,
                `You only have $${(senderData.wallet || 0).toLocaleString()} cash, but you are trying to give $${transferAmount.toLocaleString()}.`,
                { required: transferAmount, current: senderData.wallet }
            );
        }

        // Process the transfer
        senderData.wallet = (senderData.wallet || 0) - transferAmount;
        targetData.wallet = (targetData.wallet || 0) + transferAmount;

        // Save data back to the database
        await setEconomyData(client, guildId, senderId, senderData);
        await setEconomyData(client, guildId, targetId, targetData);

        // Build response message
        const resultEmbed = successEmbed(
            "💸 Transfer Successful!",
            `You successfully transferred **$${transferAmount.toLocaleString()}** to ${targetUser}.`
        );

        resultEmbed.addFields(
            {
                name: "Your New Balance",
                value: `$${senderData.wallet.toLocaleString()}`,
                inline: true,
            }
        );

        resultEmbed.setFooter({
            text: `Transaction completed successfully.`,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'give' })
};

data: new SlashCommandBuilder()
        .setName('addmoney')
        .setDescription('Generate money and add it to a user wallet')
        // (Removed permission restrictions line for testing)
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to receive the generated money')
                .setRequired(true)
        )
