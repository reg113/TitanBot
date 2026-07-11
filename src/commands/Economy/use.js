import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
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
        // Defer publicly so the broadcast is visible to everyone in the channel
        const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: false });
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const itemId = interaction.options.getString('item_id').toLowerCase();

        // 1. Verify the item exists in the master configuration
        const item = getItemById(itemId);
        if (!item) {
            throw createError(
                "Item not found",
                ErrorTypes.VALIDATION,
                `The item ID \`${itemId}\` does not exist in the shop system.`,
                { itemId }
            );
        }

        // 2. Fetch user data and check inventory levels
        const userData = await getEconomyData(client, guildId, userId);
        const currentQuantity = userData.inventory?.[itemId] || 0;

        if (currentQuantity <= 0) {
            throw createError(
                "Item not owned",
                ErrorTypes.VALIDATION,
                `You do not own any **${item.name}** (\`${item.id}\`). Buy one first using \`/buy\`.`,
                { itemId }
            );
        }

        // 3. Process item execution behavior based on ID
        if (itemId === 'party_popper') {
            // Deduct 1 item from inventory
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);

            // --- SAMPLE BROADCAST MESSAGE ---
            // You can easily modify the title, description, and emojis below!
            const embed = createEmbed({
                title: '🎉 PARTY POPPER ACTIVATED! 🎉',
                description: `**${interaction.user.toString()}** just popped a **Party Popper**! 🥳✨\n\n Let's turn the hype up in this channel! Grab some cake 🍰, blast the music 🎶, and get celebrating! 💃🕺`,
                color: '#FF69B4' // Vibrant pink party color
            }).setFooter({ text: `Remaining in your inventory: ${userData.inventory[itemId]}` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

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
