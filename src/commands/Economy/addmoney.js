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
        .setName('addmoney')
        .setDescription('Generate money and add it to a user\'s wallet')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to receive the generated money')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('The amount of cash to generate')
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
                ErrorTypes.PERMISSION, // Assuming your errorHandler handles PERMISSION types
                "You do not have the required role or permission to use this administrator command.",
                { userId }
            );
        }

        // 2. Existing command logic
        const targetUser = interaction.options.getUser("user");
        const targetId = targetUser.id;
        const guildId = interaction.guildId;
        const amountToAdd = interaction.options.getInteger("amount");

        // Prevent adding money to bots
        if (targetUser.bot) {
            throw createError(
                "Invalid Target",
                ErrorTypes.VALIDATION,
                "You cannot generate money for a bot.",
                { targetId }
            );
        }

        // Fetch target's economy data
        const targetData = await getEconomyData(client, guildId, targetId);

        // Process the addition
        targetData.wallet = (targetData.wallet || 0) + amountToAdd;

        // Save data back to the database
        await setEconomyData(client, guildId, targetId, targetData);

        // Build response message
        const resultEmbed = successEmbed(
            "💰 Money Generated!",
            `Successfully added **$${amountToAdd.toLocaleString()}** to ${targetUser}'s wallet.`
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
    }, { command: 'addmoney' })
};
