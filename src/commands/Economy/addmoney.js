import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

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
