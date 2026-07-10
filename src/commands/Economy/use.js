import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { shopItems } from '../../shop/items.js'; // Adjust this relative path if your items.js folder setup is different

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an active item from your inventory.')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item name or shortcut you want to use (e.g., ps, pinger)')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        // Use your framework's native wrapper to defer safely
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        // Clean up the user input text
        const inputItem = interaction.options.getString('item').toLowerCase().trim();
        
        // 🔍 FLEXIBLE LOOKUP: Finds the item by ID, shortcut 'ps', or any partial name match
        const item = shopItems.find(i => {
            const itemIdLower = i.id.toLowerCase();
            const itemNameLower = i.name.toLowerCase();
            
            return itemIdLower === inputItem || 
                   itemNameLower.includes(inputItem) || 
                   (inputItem === 'ps' && i.id === 'role_pinger');
        });

        // 1. Check if the item actually exists in config
        if (!item) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Found", 
                    description: `Could not find an item matching **"${interaction.options.getString('item')}"** in the shop registry.`, 
                    color: "danger" 
                })]
            });
        }

        // 2. Fetch the user's data record using your framework method
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData.inventory) userData.inventory = {};

        const currentQuantity = userData.inventory[item.id] || 0;

        // 3. Verify they actually own the item
        if (currentQuantity <= 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Owned", 
                    description: `You don't have any **${item.name}** in your inventory! Buy one from the shop first.`, 
                    color: "warning" 
                })]
            });
        }

        // ========================================================
        // EFFECT TRACKER: Role Pinger Logic
        // ========================================================
        if (item.effect?.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({ 
                        title: "❌ Role Error", 
                        description: `The role setup for this item (${roleId}) could not be found in this server.`, 
                        color: "danger" 
                    })]
                });
            }

            // Temporarily lift mention restrictions if the role is locked down
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention bypass via /use item command').catch(() => null);
            }

            // Broadcast the ping directly into the text channel publicly
            await interaction.channel.send({
                content: `📢 **${interaction.user.username}** used a **${item.name}**!\nAttention: ${role}`
            }).catch(() => null);

            // Revert permissions back to normal safely
            if (!originalMentionable) {
                await role.setMentionable(false, 'Restoring original server role mention locks').catch(() => null);
            }

            // Deduct 1 item out of their save data structure
            userData.inventory[item.id] -= 1;
            await setEconomyData(client, guildId, userId, userData);

            // Success feedback message
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    "✨ Item Used",
                    `You successfully consumed 1x **${item.name}**.`
                )]
            });
        }

        // ========================================================
        // FALLBACK: For items that shouldn't be used manually
        // ========================================================
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({ 
                title: "ℹ️ Passive Item", 
                description: `**${item.name}** is an item type (**${item.type}**) that works automatically in the background. You don't need to manually activate it!`, 
                color: "warning" 
            })]
        });

    }, { command: 'use' })
};
