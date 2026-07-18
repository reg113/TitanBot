import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { shopItems } from '../../config/shop/items.js';
import { getEconomyData, saveEconomyData } from '../../utils/economy.js'; // ⚠️ Assumes saveEconomyData exists in your economy utils
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SHOP_ITEMS = shopItems;

export default {
    data: new SlashCommandBuilder()
        .setName('giveitem')
        .setDescription('Give an item from your inventory to another user')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user you want to give the item to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The name or ID of the item to give')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of items to give (Defaults to 1)')
                .setMinValue(1)
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const senderId = interaction.user.id;
        
        const targetUser = interaction.options.getUser('target');
        const itemInput = interaction.options.getString('item').toLowerCase().trim();
        const amount = interaction.options.getInteger('amount') || 1;

        // Validation: Cannot give items to yourself
        if (targetUser.id === senderId) {
            const embed = createEmbed({
                title: '❌ Transfer Cancelled',
                description: "You can't give items to yourself!",
                color: 'error'
            });
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        // Validation: Cannot give items to bots
        if (targetUser.bot) {
            const embed = createEmbed({
                title: '❌ Transfer Cancelled',
                description: "Bots don't have inventories. You cannot give items to them.",
                color: 'error'
            });
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        // Validation: Match the requested item string against your item configurations
        const item = SHOP_ITEMS.find(i => i.id.toLowerCase() === itemInput || i.name.toLowerCase() === itemInput);
        if (!item) {
            const embed = createEmbed({
                title: '❌ Item Not Found',
                description: `Could not find any item matching **"${interaction.options.getString('item')}"** in the shop system.`,
                color: 'error'
            });
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        logger.debug(`[ECONOMY] Item gift transaction initialization: From ${senderId} to ${targetUser.id}`, { itemId: item.id, amount, guildId });

        // Load sender profile data
        const senderData = await getEconomyData(client, guildId, senderId);
        if (!senderData) {
            throw createError(
                "Failed to load sender economy data for transfer",
                ErrorTypes.DATABASE,
                "Failed to process your request. Please try again later.",
                { senderId, guildId }
            );
        }

        const senderInventory = senderData.inventory || {};
        const senderItemQuantity = senderInventory[item.id] || 0;

        // Validation: Verify the sender has enough inventory quantity
        if (senderItemQuantity < amount) {
            const embed = createEmbed({
                title: '❌ Insufficient Items',
                description: `You don't have enough **${item.name}** to give. You currently own **${senderItemQuantity}x**.`,
                color: 'warning'
            });
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        // Load target profile data
        const targetData = await getEconomyData(client, guildId, targetUser.id);
        if (!targetData) {
            throw createError(
                "Failed to load recipient economy data for transfer",
                ErrorTypes.DATABASE,
                "Failed to locate the recipient database profile.",
                { targetUserId: targetUser.id, guildId }
            );
        }

        const targetInventory = targetData.inventory || {};

        // --- PERFORM MUTATIONS ---
        // Deduct from sender
        senderInventory[item.id] = senderItemQuantity - amount;
        if (senderInventory[item.id] <= 0) {
            delete senderInventory[item.id]; // Keeps the database key cleaner
        }

        // Add to recipient
        targetInventory[item.id] = (targetInventory[item.id] || 0) + amount;

        // Update working structural models
        senderData.inventory = senderInventory;
        targetData.inventory = targetInventory;

        // Save modifications using your database abstraction layers
        await saveEconomyData(client, guildId, senderId, senderData);
        await saveEconomyData(client, guildId, targetUser.id, targetData);

        logger.info(`[ECONOMY] Gift transaction success`, { guildId, from: senderId, to: targetUser.id, itemId: item.id, amount });

        const successEmbedMessage = createEmbed({
            title: '🎁 Item Sent Successfully!',
            description: `You gave **${amount}x ${item.name}** to ${targetUser}.\n\n*Transaction logged.*`,
            color: 'success'
        }).setThumbnail(targetUser.displayAvatarURL());

        await InteractionHelper.safeEditReply(interaction, { embeds: [successEmbedMessage] });

    }, { command: 'giveitem' })
};
