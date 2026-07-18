import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { shopItems } from '../../config/shop/items.js';
import { getEconomyData } from '../../utils/economy.js'; // Sticking strictly to your exact imports
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
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const targetUser = interaction.options.getUser('target');
        const itemInput = interaction.options.getString('item').toLowerCase().trim();
        let amount = interaction.options.getInteger('amount');
        
        // Default to 1 if no amount is specified
        if (amount === null || amount === undefined) amount = 1;

        // Validation: Ensure amount is a positive number
        if (amount <= 0) {
            throw createError(
                "Invalid item amount requested",
                ErrorTypes.VALIDATION || "VALIDATION",
                "You must specify a valid amount greater than 0.",
                { userId, amount }
            );
        }

        // Validation: Prevent giving items to yourself
        if (targetUser.id === userId) {
            throw createError(
                "Sender attempted self-gift",
                ErrorTypes.VALIDATION || "VALIDATION",
                "You cannot give items to yourself!",
                { userId }
            );
        }

        // Validation: Prevent giving items to bots
        if (targetUser.bot) {
            throw createError(
                "Sender attempted bot-gift",
                ErrorTypes.VALIDATION || "VALIDATION",
                "Bots do not have inventories. You cannot give items to them.",
                { targetId: targetUser.id }
            );
        }

        // Validation: Find item matches using your exact configuration structure
        const item = SHOP_ITEMS.find(i => i.id.toLowerCase() === itemInput || i.name.toLowerCase() === itemInput);
        if (!item) {
            throw createError(
                "Requested item not found in shop config",
                ErrorTypes.VALIDATION || "VALIDATION",
                `Could not find an item matching **"${interaction.options.getString('item')}"** in the shop system.`,
                { itemInput }
            );
        }

        logger.debug(`[ECONOMY] Give item requested by ${userId} for ${targetUser.id}`, { userId, targetId: targetUser.id, itemId: item.id, amount, guildId });

        // Load sender profile data
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData) {
            throw createError(
                "Failed to load economy data for inventory transfer",
                ErrorTypes.DATABASE,
                "Failed to load your economy data. Please try again later.",
                { userId, guildId }
            );
        }

        // Load target profile data
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

        // Validation: Verify the sender actually owns enough copies of the item
        if (currentQuantity < amount) {
            throw createError(
                "Insufficient item quantity for transfer",
                ErrorTypes.VALIDATION || "VALIDATION",
                `You do not have enough **${item.name}** to give. You currently own **${currentQuantity}x**.`,
                { itemId: item.id, currentQuantity, amount }
            );
        }

        // --- INVENTORY MUTATIONS ---
        inventory[item.id] = currentQuantity - amount;
        if (inventory[item.id] <= 0) {
            delete inventory[item.id];
        }
        userData.inventory = inventory;

        const targetInventory = targetData.inventory || {};
        targetInventory[item.id] = (targetInventory[item.id] || 0) + amount;
        targetData.inventory = targetInventory;

        // --- PERSISTENCE LAYER ---
        // If your framework saves data via a direct method on the retrieved object (like Mongoose documents):
        if (typeof userData.save === 'function') {
            await userData.save();
            await targetData.save();
        } else {
            // Fallback: If your project uses an un-imported save utility from economy.js, 
            // dynamically pull it so it doesn't break the top-level file imports if missing.
            const economyUtils = await import('../../utils/economy.js');
            const saveFn = economyUtils.saveEconomyData || economyUtils.updateEconomyData || economyUtils.setEconomyData;
            
            if (saveFn) {
                await saveFn(client, guildId, userId, userData);
                await saveFn(client, guildId, targetUser.id, targetData);
            } else {
                logger.error("[ECONOMY] Could not locate a valid data saving method in economy utils.");
            }
        }

        logger.info(`[ECONOMY] Item transfer complete`, { from: userId, to: targetUser.id, itemId: item.id, amount, guildId });

        // Uses your standard success layout
        const embed = successEmbed(
            '🎁 Item Sent Successfully!',
            `You gave **${amount}x ${item.name}** to ${targetUser}.`
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

    }, { command: 'giveitem' })
};
