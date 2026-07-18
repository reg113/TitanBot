import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getItemById } from '../../config/shop/items.js';

// --- COOLDOWN TRACKING ---
const cooldowns = new Map();

// Add the IDs that are allowed to ignore cooldowns completely
const BYPASS_USERS = ['1524978803854540842', '1524978803854540842']; 
const BYPASS_ROLES = ['1524982677810184223', '1524982677810184223'];
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

        // 4.5. Dynamic Cooldown Verification Logic
        const cooldownKey = `${userId}_${itemId}`; 
        const isBypassUser = BYPASS_USERS.includes(userId);
        const isBypassRole = interaction.member?.roles?.cache?.some(role => BYPASS_ROLES.includes(role.id)) || false;
        const hasBypass = isBypassUser || isBypassRole;

        // Pull the custom cooldown duration from the item's config (default to 0 if not set)
        const cooldownDuration = item.cooldown || 0;

        if (cooldownDuration > 0 && !hasBypass && cooldowns.has(cooldownKey)) {
            const expirationTime = cooldowns.get(cooldownKey);
            const now = Date.now();

            if (now < expirationTime) {
                const timeLeft = expirationTime - now;
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);

                throw createError(
                    "Item on Cooldown",
                    ErrorTypes.VALIDATION,
                    `Slow down! You can use **${item.name}** again in **${minutes}m ${seconds}s**.`
                );
            }
        }

        // ==========================================
        // 5. Item Execution Logic
        // ==========================================
        if (itemId === 'skull') { //SKULL
            // Deduct 1 item from inventory
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);

            const messageAlert = `💀 **AHLUL SKULL PING ACTIVATED!**`;
            const messageMain = `<@&1515655155050086400> \n\n-# Activated by ${user.toString()} • ${userData.inventory[itemId]} remaining`;

            if (isMessage) {
                await interaction.delete().catch(() => {});
                const temporaryMessage = await interaction.channel.send({ content: messageAlert });
                const mainMessage = await interaction.channel.send({ content: messageMain });
                await mainMessage.react('💀').catch(() => {});

                setTimeout(() => {
                    temporaryMessage.delete().catch(() => {});
                }, 5000);

            } else {
                await InteractionHelper.safeEditReply(interaction, { content: messageAlert });
                const mainMessage = await interaction.channel.send({ content: messageMain });
                await mainMessage.react('💀').catch(() => {});
                
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {});
                }, 10000);
            }

        } else if (itemId === 'fake_id') { //FAKE ID
            const BANKROB_COOLDOWN = 8 * 60 * 60 * 1000;
            const lastBankrob = userData.lastBankrob || 0;
            const now = Date.now();

            if (now >= lastBankrob + BANKROB_COOLDOWN) {
                throw createError(
                    "No Active Cooldown",
                    ErrorTypes.VALIDATION,
                    "Your legal record is already clean! You don't have an active bankrob cooldown right now, so there's no need to use this."
                );
            }

            userData.inventory[itemId] = currentQuantity - 1;
            userData.lastBankrob = 0;
            await setEconomyData(client, guildId, userId, userData);

            const activationMessage = `🪪 **Fake ID Scanned!** Your files have been scrubbed from the police database. Your \`/bankrob\` cooldown has been **completely reset**!`;

            if (isMessage) {
                await interaction.delete().catch(() => {});
                await interaction.channel.send({ content: activationMessage });
            } else {
                await InteractionHelper.safeEditReply(interaction, { content: activationMessage });
            }

            // ======================

                } else if (itemId === 'skull_react') { // SKULL REACT
        // 1. Extract the Message ID based on the input type
        let targetMessageId;
        if (isMessage) {
            // Assuming your format is: !use skull <message_id>
            const args = interaction.content.split(/ +/).slice(2); 
            targetMessageId = args[0];
        } else {
            // For slash commands, ensure you add a 'target' string option to your command builder
            targetMessageId = interaction.options.getString('target');
        }
    
        // 2. Validate that an ID was actually provided
        if (!targetMessageId) {
            throw createError(
                "Missing Argument",
                ErrorTypes.VALIDATION,
                "❌ You need to provide the **Message ID** of the message you want to react to."
            );
        }
    
        try {
            // 3. Attempt to fetch the message from the current channel
            const targetMessage = await interaction.channel.messages.fetch(targetMessageId);
            
            // 4. React with the skull emoji
            await targetMessage.react('💀');
            
            // 5. Consume 1 skull from the inventory and save
            userData.inventory[itemId] = currentQuantity - 1;
            await setEconomyData(client, guildId, userId, userData);
    
            // 6. Send success confirmation
            const successMessage = `💀 **Spooked!** You used 1x **${item.name}** to react to that message.`;
    
            if (isMessage) {
                await interaction.delete().catch(() => {});
                await interaction.channel.send({ content: successMessage });
            } else {
                await InteractionHelper.safeEditReply(interaction, { content: successMessage });
            }
    
        } catch (error) {
            // Catch block handles missing permissions, invalid IDs, or messages in other channels
            throw createError(
                "Execution Failure",
                ErrorTypes.EXECUTION,
                "❌ I couldn't find or react to that message. Double-check the Message ID and make sure it's in this channel!"
            );
        }
    }
// ================
        } else if (itemId === 'vault_lock') { //VAULT LOCK
            if (userData.vaultProtected === true) {
                throw createError(
                    "Already Protected",
                    ErrorTypes.VALIDATION,
                    "Your bank vault is already armed with an active Vault Lock! Save this one for when that one breaks."
                );
            }

            userData.inventory[itemId] = currentQuantity - 1;
            userData.vaultProtected = true; 
            await setEconomyData(client, guildId, userId, userData);

            const activationMessage = `🔒 **Vault Lock Fully Activated!** Your bank account is now heavily fortified. The lock will remain active until it successfully absorbs and breaks a \`/bankrob\` attempt.`;

            if (isMessage) {
                await interaction.delete().catch(() => {});
                await interaction.channel.send({ content: activationMessage });
            } else {
                await InteractionHelper.safeEditReply(interaction, { content: activationMessage });
            }

        } else {
            throw createError(
                "Item not functional",
                ErrorTypes.VALIDATION,
                `The item **${item.name}** is a consumable but does not have a functional use routine set up yet.`,
                { itemId }
            );
        }

        // ==========================================
        // 6. Post-Execution Cooldown Application
        // ==========================================
        // If the execution succeeded and the item has a custom cooldown defined, apply it now
        if (!hasBypass && cooldownDuration > 0) {
            cooldowns.set(cooldownKey, Date.now() + cooldownDuration);
        }

    }, { command: 'use' })
};
