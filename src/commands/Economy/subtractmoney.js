import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Define the allowed IDs here (replace these placeholder strings with your actual IDs)
const ALLOWED_USER_IDS = ['1524978803854540842', '1524978803854540842']; 
const ALLOWED_ROLE_IDS = ['1524982677810184223'];

export default {
    data: new SlashCommandBuilder()
        .setName('removemoney')
        .setDescription('Subtract money from a user\'s wallet')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to remove money from')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('The amount of cash to subtract')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        // 1. Authorization Check
        const userId = interaction.user.id;
        const memberRoles = interaction.member.roles.cache; // Collection of roles the user has

        const isAllowedUser = ALLOWED_USER_IDS.includes(userId);
        const hasAllowedRole = ALLOWED_ROLE_IDS.some(roleId => memberRoles.has(roleId));

        if (!isAllowedUser && !hasAllowedRole) {
            throw createError(
                "Access Denied",
                ErrorTypes.PERMISSION, 
                "You do not have the required role or permission to use this administrator command.",
                { userId }
            );
        }

        // 2. Command logic
        const targetUser = interaction.options.getUser("user");
        const targetId = targetUser.id;
        const guildId = interaction.guildId;
        const amountToRemove = interaction.options.getInteger("amount");

        // Prevent managing money for bots
        if (targetUser.bot) {
            throw createError(
                "Invalid Target",
                ErrorTypes.VALIDATION,
                "You cannot subtract money from a bot.",
                { targetId }
            );
        }

        // Fetch target's economy data
        const targetData = await getEconomyData(client, guildId, targetId);
        const currentWallet = targetData.wallet || 0;

        // Prevent negative balances
        if (currentWallet < amountToRemove) {
            throw createError(
                "Insufficient Funds",
                ErrorTypes.VALIDATION,
                `You cannot subtract $${amountToRemove.toLocaleString()} because ${targetUser} only has $${currentWallet.toLocaleString()} in their wallet.`,
                { targetId, currentWallet, amountToRemove }
            );
        }

        // Process the subtraction
        targetData.wallet = currentWallet - amountToRemove;

        // Save data back to the database
        await setEconomyData(client, guildId, targetId, targetData);

        // Build response message
        const resultEmbed = successEmbed(
            "💸 Money Removed!",
            `Successfully removed **$${amountToRemove.toLocaleString()}** from ${targetUser}'s wallet.`
        );

        resultEmbed.addFields(
            {
                name: "Their New Balance",
                value: `$${targetData.wallet.toLocaleString()}`,
                inline: true,
            }
        );

        resultEmbed.setFooter({
            text: `Admin transaction completed.`,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'removemoney' })
};
