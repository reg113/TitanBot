import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getItemById } from '../../config/shop/items.js';

export default {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Use a consumable item from your inventory')
        .addStringOption(option =>
            option
                .setName('item_id')
                .setDescription('The ID of the item you want to use (e.g., party_popper)')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        // 1. Detect if this was triggered by a regular message or a slash command
        const isMessage = !interaction.options;
        
        const user = isMessage ? interaction.author : interaction.user;
        const userId = user.id;
        const guildId = interaction.guildId || interaction.guild?.id;
        
        let itemId = '';
        if (isMessage) {
            // Parse item_id from text content (e.g., "!use party_popper" -> "party_popper")
            const args = interaction.content.trim().split(/ +/);
            itemId = args[1] ? args[1].toLowerCase() : '';
            
            if (!itemId) {
                throw createError(
                    "Missing argument",
                    ErrorTypes.VALIDATION,
                    "Please specify an item ID to use. Example: `!use party_popper`"
                );
            }
        } else {
            // Defer if it is a slash command to prevent interaction token timeouts
            const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: false });
            if (!deferred) return;
            itemId = interaction.options.getString('item_id').toLowerCase();
        }

        // 2. Verify the item exists in the shop config
        const item = getItemById(itemId);
        if (!item) {
            throw createError(
                "Item not found",
                ErrorTypes.VALIDATION,
                `The item ID \`${itemId}\` does not exist in the shop system.`,
                { itemId }
            );
        }

        // 3. Fetch user data and ensure inventory objects are initialized
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData.inventory) {
            userData.inventory = {};
        }

        const currentQuantity = userData.inventory[itemId] || 0;

        // 4. Check if they actually own the item
        if (currentQuantity <= 0) {
            throw createError(
                "Item not owned",
                ErrorTypes.VALIDATION,
                `You do not own any **${item.name}** (\`${item.id}\`). Buy one first using \`/buy\`.`,
                { itemId }
            );
        }

        // 5. Item execution logic
        if (itemId === 'party_popper') {
            // Deduct 1 item from inventory
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);

            // Split the messages based on your preference
            const messageAlert = `🎉 **PARTY POPPER ACTIVATED!**`;
            const messageMain = `🥳✨\nLet's turn the hype up in this channel! Grab some cake 🍰, blast the music 🎶, and get celebrating! 💃🕺\n\n-# Activated by ${user.toString()} • ${userData.inventory[itemId]} remaining`;

            let temporaryMessage;

            if (isMessage) {
                // Delete the user's triggering text message (e.g., "!use party_popper")
                await interaction.delete().catch(() => {});

                // Send both pieces as standard channel text messages
                temporaryMessage = await interaction.channel.send({ content: messageAlert });
                await interaction.channel.send({ content: messageMain });
            } else {
                // Acknowledge the slash command interaction with the main long-form text
                await InteractionHelper.safeEditReply(interaction, { content: messageMain });
                
                // Send the alert line as a standalone channel text message
                temporaryMessage = await interaction.channel.send({ content: messageAlert });
            }

            // Automatically delete the "PARTY POPPER ACTIVATED!" text line after 5 seconds
            if (temporaryMessage) {
                setTimeout(() => {
                    temporaryMessage.delete().catch(() => {});
                }, 5000);
            }

        } else {
            // Guard fallback for items that are consumables but don't have functional code yet
            throw createError(
                "Item not functional",
                ErrorTypes.VALIDATION,
                `The item **${item.name}** is a consumable but does not have a functional use routine set up yet.`,
                { itemId }
            );
        }
    }, { command: 'use' })
};
