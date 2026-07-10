import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { shopItems } from '../../shop/items.js'; 

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an active item from your inventory.')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item name, ID, or shortcut you want to use (e.g., ps)')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        console.log('--- [DEBUG: USE START] ---');
        console.log(`User: ${interaction.user.username} (${interaction.user.id})`);

        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) {
            console.log('❌ [DEBUG] Interaction deferral failed.');
            return;
        }

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const inputItem = interaction.options.getString('item').toLowerCase().trim();
        
        console.log(`[DEBUG] Input text parsed: "${inputItem}"`);
        console.log('[DEBUG] Registered shop item IDs:', shopItems.map(i => i.id));

        // Find match
        const item = shopItems.find(i => {
            const itemIdLower = i.id.toLowerCase();
            const itemNameLower = i.name.toLowerCase();
            
            return itemIdLower === inputItem || 
                   itemNameLower.includes(inputItem) || 
                   (inputItem === 'ps' && i.id === 'role_pinger');
        });

        if (!item) {
            console.log(`❌ [DEBUG] Match failed. No item config found for "${inputItem}"`);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Found", 
                    description: `Could not find an item config matching **"${interaction.options.getString('item')}"**.`, 
                    color: "danger" 
                })]
            });
        }

        console.log(`✅ [DEBUG] Linked input to item ID: ${item.id}`);

        const userData = await getEconomyData(client, guildId, userId);
        console.log('[DEBUG] Fetched User Inventory Data Structure:', userData?.inventory);

        if (!userData.inventory) userData.inventory = {};
        const currentQuantity = userData.inventory[item.id] || 0;

        if (currentQuantity <= 0) {
            console.log(`❌ [DEBUG] Quantity check failed. User owns: ${currentQuantity}`);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Owned", 
                    description: `You don't own any **${item.name}**! Buy it from the shop first.`, 
                    color: "warning" 
                })]
            });
        }

        if (item.effect?.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                console.log(`❌ [DEBUG] Server role target missing from cache for ID: ${roleId}`);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({ 
                        title: "❌ Server Role Missing", 
                        description: `The designated target role ID (\`${roleId}\`) could not be found in this server cache.`, 
                        color: "danger" 
                    })]
                });
            }

            console.log(`[DEBUG] Role found: "${role.name}". Toggling mention permissions...`);

            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary item use bypass').catch(err => {
                    console.log('❌ [DEBUG] Bot lacks "Manage Roles" permission to toggle mention settings:', err.message);
                });
            }

            await interaction.channel.send({
                content: `📢 **${interaction.user.username}** consumed a **${item.name}**!\nAttention: ${role}`
            }).catch(err => {
                console.log('❌ [DEBUG] Failed to send message to channel:', err.message);
            });

            if (!originalMentionable) {
                await role.setMentionable(false, 'Restoring server role protection policies').catch(() => null);
            }

            // Deduct and save
            userData.inventory[item.id] -= 1;
            await setEconomyData(client, guildId, userId, userData);
            console.log('[DEBUG] Inventory item deducted and profile saved successfully.');

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    "✨ Item Consumed",
                    `You successfully deployed 1x **${item.name}**.`
                )]
            });
        }

        console.log('[DEBUG] Item evaluated as passive tool utility.');
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({ 
                title: "ℹ️ Passive Utility", 
                description: `**${item.name}** is a **${item.type}**. It works automatically in the background and cannot be executed manually via \`/use\`.`, 
                color: "warning" 
            })]
        });

    }, { command: 'use' })
};
