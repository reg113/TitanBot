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
        // Defer publicly (ephemeral: false) so the text broadcast is visible to the entire channel
        const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: false });
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const itemId = interaction.options.getString('item_id').toLowerCase();

        // 1. Verify the item exists in the shop items configuration
        const item = getItemById(itemId);
        if (!item) {
            throw createError(
                "Item not found",
                ErrorTypes.VALIDATION,
                `The item ID \`${itemId}\` does not exist in the shop system.`,
                { itemId }
            );
        }

        // 2. Fetch user data and ensure inventory objects are initialized
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData.inventory) {
            userData.inventory = {};
        }

        const currentQuantity = userData.inventory[itemId] || 0;

        // 3. Check if they actually own the item
        if (currentQuantity <= 0) {
            throw createError(
                "Item not owned",
                ErrorTypes.VALIDATION,
                `You do not own any **${item.name}** (\`${item.id}\`). Buy one first using \`/buy\`.`,
                { itemId }
            );
        }

        // 4. Item execution logic
        if (itemId === 'party_popper') {
            // Deduct 1 item from inventory
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);

            // --- SAMPLE BROADCAST PLAIN TEXT ---
            const broadcastMessage = `🎉 **PARTY POPPER ACTIVATED!** 🥳✨\nLet's turn the hype up in this channel! Grab some cake 🍰, blast the music 🎶, and get celebrating! 💃🕺\n\n-# Activated by ${interaction.user.toString()} • ${userData.inventory[itemId]} remaining`;

            // Reply with the clean markdown string
            await InteractionHelper.safeEditReply(interaction, { content: broadcastMessage });

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
