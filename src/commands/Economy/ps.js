import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getItemById } from '../../shop/items.js'; // Ensure this relative path reaches your items.js file

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an active item from your inventory.')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item name or shortcut you want to use (e.g., ps)')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        // Use your framework's safe wrapper to handle interaction deferrals
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        let inputItem = interaction.options.getString('item').toLowerCase().trim();
        
        // 🔄 SHORTCUT TRANSLATOR: Automatically turns "/use ps" into your item ID "role_pinger"
        if (inputItem === 'ps') {
            inputItem = 'role_pinger';
        }

        const item = getItemById(inputItem);

        // If item doesn't exist in items.js config file
        if (!item) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Found", 
                    description: `Could not find an item config matching **${inputItem}** inside items.js.`, 
                    color: "warning" 
                })]
            });
        }

        // Fetch profile data using your framework's native handler 
        const userData = await getEconomyData(client, guildId, userId);
        
        // Safety step to instantiate an empty collection if they haven't bought anything before
        if (!userData.inventory) {
            userData.inventory = {};
        }

        const currentQuantity = userData.inventory[item.id] || 0;

        // Check user ownership stock records
        if (currentQuantity <= 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Missing Item", 
                    description: `You do not own any **${item.name}**! Buy it from the shop first.`, 
                    color: "warning" 
                })]
            });
        }

        // ========================================================
        // EFFECT HANDLER: Role Pinger Logic
        // ========================================================
        if (item.effect?.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({ 
                        title: "❌ Configuration Error", 
                        description: "The targeted mention role assigned to this item could not be found in this server.", 
                        color: "warning" 
                    })]
                });
            }

            // Temporarily bypass permission locks if the role isn't universally taggable
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention override via item consumption').catch(() => null);
            }

            // Fire public mention message directly into the chat channel
            await interaction.channel.send({
                content: `📢 **${interaction.user.username}** used a **${item.name}**!\nAttention: ${role}`
            });

            // Restore secure server role settings defaults instantly 
            if (!originalMentionable) {
                await role.setMentionable(false, 'Restoring standard role isolation rule policies').catch(() => null);
            }

            // Deduct 1 item copy out of their economy data profile structures
            userData.inventory[item.id] -= 1;
            await setEconomyData(client, guildId, userId, userData);

            // Send custom frame success confirmation dispatch back to invoking user
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    "✨ Item Used Successfully",
                    `You consumed 1x **${item.name}**.`
                )]
            });
        }

        // Fallback catch notice for passive tools/upgrades that don't need manual activation
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({ 
                title: "ℹ️ Passive Item", 
                description: `**${item.name}** is a passive tool/upgrade. It functions automatically background contexts and doesn't need to be run via \`/use\`.`, 
                color: "warning" 
            })]
        });

    }, { command: 'use' })
};
