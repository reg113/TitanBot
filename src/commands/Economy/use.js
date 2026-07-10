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
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        const inputItem = interaction.options.getString('item').toLowerCase().trim();
        
        // Dynamic search looks for an item ID match, a name match, or our custom shortcut 'ps'
        const item = shopItems.find(i => {
            const itemIdLower = i.id.toLowerCase();
            const itemNameLower = i.name.toLowerCase();
            
            return itemIdLower === inputItem || 
                   itemNameLower.includes(inputItem) || 
                   (inputItem === 'ps' && i.id === 'role_pinger');
        });

        if (!item) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Found", 
                    description: `Could not find an item matching **"${interaction.options.getString('item')}"**.`, 
                    color: "danger" 
                })]
            });
        }

        const userData = await getEconomyData(client, guildId, userId);
        if (!userData.inventory) userData.inventory = {};

        const currentQuantity = userData.inventory[item.id] || 0;

        if (currentQuantity <= 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ 
                    title: "❌ Item Not Owned", 
                    description: `You don't own any **${item.name}**! Buy it from the shop first.`, 
                    color: "warning" 
                })]
            });
        }

        // Handle Role Pinger Effect Logic
        if (item.effect?.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({ 
                        title: "❌ Server Role Missing", 
                        description: `The designated target role ID (\`${roleId}\`) could not be found in this server cache.`, 
                        color: "danger" 
                    })]
                });
            }

            // Temporarily bypass role settings if it's set to unmentionable
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary item use bypass').catch(() => null);
            }

            // Public channel ping message broadcast
            await interaction.channel.send({
                content: `📢 **${interaction.user.username}** consumed a **${item.name}**!\nAttention: ${role}`
            }).catch(() => null);

            // Revert configuration settings back immediately
            if (!originalMentionable) {
                await role.setMentionable(false, 'Restoring server role protection policies').catch(() => null);
            }

            // Deduct 1 item and update state
            userData.inventory[item.id] -= 1;
            await setEconomyData(client, guildId, userId, userData);

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    "✨ Item Consumed",
                    `You successfully deployed 1x **${item.name}**.`
                )]
            });
        }

        // Handle passive item fallbacks
        return await InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({ 
                title: "ℹ️ Passive Utility", 
                description: `**${item.name}** is a **${item.type}**. It works automatically in the background and cannot be executed manually via \`/use\`.`, 
                color: "warning" 
            })]
        });

    }, { command: 'use' })
};
