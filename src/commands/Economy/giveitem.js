import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { shopItems } from '../../config/shop/items.js';
import { getEconomyData, saveEconomyData } from '../../utils/economy.js';
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
                .setDescription('The amount of items to give')
                .setMinValue(1)
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const targetUser = interaction.options.getUser('target');
        const itemInput = interaction.options.getString('item').toLowerCase().trim();
        const amount = interaction.options.getInteger('amount') || 1;

        // Validation: Prevent self-gifting
        if (targetUser.id === userId) {
            throw createError(
                "Sender attempted self-gift",
                ErrorTypes.VALIDATION,
                "You cannot give items to yourself!",
                { userId }
            );
        }

        // Validation: Prevent gifting to bots
        if (targetUser.bot) {
            throw createError(
                "Sender attempted bot-gift",
                ErrorTypes.VALIDATION,
                "Bots do not have inventories. You cannot give items to them.",
                { targetId: targetUser.id }
            );
        }

        // Validation: Verify item exists within application configuration
        const item = SHOP_ITEMS.find(i => i.id.toLowerCase() === itemInput || i.name.toLowerCase() === itemInput);
        if (!item) {
            throw createError(
                "Requested item not found in shop config",
                ErrorTypes.VALIDATION,
                `Could not find an item matching **"${interaction.options.getString('item')}"** in the shop database.`,
                { itemInput }
            );
        }

        logger.debug(`[ECONOMY] Give item requested by ${userId} for ${targetUser.id}`, { userId, targetId: targetUser.id, itemId: item.id, amount, guildId });

        // Retrieve sender data profiles
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData) {
            throw createError(
                "Failed to load economy data for inventory transfer",
                ErrorTypes.DATABASE,
                "Failed to load your economy data. Please try again later.",
                { userId, guildId }
            );
        }

        // Retrieve target data profiles
        const targetData = await getEconomyData(client, guildId, targetUser.id);
        if (!targetData) {
            throw createError(
                "Failed to load target economy data for inventory transfer",
                ErrorTypes.DATABASE,
                "Failed to load the recipient's profile data. Please try again later.",
                { targetId: targetUser.id, guildId }
            );
        }

        const inventory = userData.inventory || {};
        const currentQuantity = inventory[item.id] || 0;

        // Validation: Verify ownership status and quantities
        if (currentQuantity < amount) {
            throw createError(
                "Insufficient item quantity for transfer",
                ErrorTypes.VALIDATION,
                `You do not have enough **${item.name}** to give. You currently own **${currentQuantity}x**.`,
                { itemId: item.id, currentQuantity, amount }
            );
        }

        // --- DATABASE MUTATIONS ---
        // Deduct items from sender profile
        inventory[item.id] = currentQuantity - amount;
        if (inventory[item.id] <= 0) {
            delete inventory[item.id];
        }
        userData.inventory = inventory;

        // Append items to target profile
        const targetInventory = targetData.inventory || {};
        targetInventory[item.id] = (targetInventory[item.id] || 0) + amount;
        targetData.inventory = targetInventory;

        // Commit modifications to state persistence layers
        await saveEconomyData(client, guildId, userId, userData);
        await saveEconomyData(client, guildId, targetUser.id, targetData);

        logger.info(`[ECONOMY] Item transfer complete`, { 
            from: userId, 
            to: targetUser.id, 
            itemId: item.id, 
            amount, 
            guildId 
        });

        // Render response adhering strictly to positional arguments found in successEmbed helper
        const embed = successEmbed(
            '🎁 Item Sent Successfully!',
            `You gave **${amount}x ${item.name}** to ${targetUser}.`
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        
    }, { command: 'giveitem' })
};
