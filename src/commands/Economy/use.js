import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getItemById } from '../../config/shop/items.js';

// --- COOLDOWN CONFIGURATION ---
const COOLDOWN_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const cooldowns = new Map();

// Add the IDs that are allowed to ignore the cooldown completely
const BYPASS_USERS = ['1524988803507294238', '1524988803507294238']; 
const BYPASS_ROLES = ['1524994590036332638', '1524994590036332638'];
// ------------------------------

export default {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Use a consumable item from your inventory')
        .addStringOption(option =>
            option
                .setName('item_id')
                .setDescription('The ID of the item you want to use (e.g., skull)')
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
            // Parse item_id from text content (e.g., "!use skull" -> "skull")
            const args = interaction.content.trim().split(/ +/);
            itemId = args[1] ? args[1].toLowerCase() : '';
            
            if (!itemId) {
                throw createError(
                    "Missing argument",
                    ErrorTypes.VALIDATION,
                    "Please specify an item ID to use. Example: `use skull`"
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

        // 4.5. Cooldown Verification Logic
        const isBypassUser = BYPASS_USERS.includes(userId);
        const isBypassRole = interaction.member?.roles?.cache?.some(role => BYPASS_ROLES.includes(role.id)) || false;
        const hasBypass = isBypassUser || isBypassRole;

        if (!hasBypass && cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId);
            const now = Date.now();

            if (now < expirationTime) {
                const timeLeft = expirationTime - now;
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);

                throw createError(
                    "Command on Cooldown",
                    ErrorTypes.VALIDATION,
                    `Slow down! You can use this command again in **${minutes}m ${seconds}s**.`
                );
            }
        }

        // 5. Item execution logic
        if (itemId === 'skull') {
            // Deduct 1 item from inventory
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);

            // Apply the cooldown timestamp now that usage is verified and successful
            if (!hasBypass) {
                cooldowns.set(userId, Date.now() + COOLDOWN_DURATION);
            }

            const messageAlert = `💀 **AHLUL SKULL PING ACTIVATED!**`;
            const messageMain = `💀 <@&1515655155050086400> \n\n-# Activated by ${user.toString()} • ${userData.inventory[itemId]} remaining`;

            if (isMessage) {
                // Delete the user's triggering command message (e.g., "!use skull")
                await interaction.delete().catch(() => {});

                // Send the alert first, then follow it up with the main text body
                const temporaryMessage = await interaction.channel.send({ content: messageAlert });
                const mainMessage = await interaction.channel.send({ content: messageMain });
                
                // Add the skull reaction to the main ping message
                await mainMessage.react('💀').catch(() => {});

                // Delete the alert line after 10 seconds
                setTimeout(() => {
                    temporaryMessage.delete().catch(() => {});
                }, 10000);

            } else {
                // For slash commands: use the reply mechanism for the alert line so it shows up first
                await InteractionHelper.safeEditReply(interaction, { content: messageAlert });
                
                // Immediately drop the permanent main message beneath it
                const mainMessage = await interaction.channel.send({ content: messageMain });
                
                // Add the skull reaction to the main ping message
                await mainMessage.react('💀').catch(() => {});
                
                // Cleanly purge the interaction's alert response after 10 seconds
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {});
                }, 10000);
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
