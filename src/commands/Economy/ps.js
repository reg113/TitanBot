import { SlashCommandBuilder } from 'discord.js';
import { getItemById } from '../../shop/items.js'; // Double check this path matches your items.js location

export default {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an active item from your inventory')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The ID or shortcut of the item (e.g., ps, role_pinger)')
                .setRequired(true)
        ),

    async execute(interaction) {
        let itemId = interaction.options.getString('item').toLowerCase().trim();
        
        // 🔄 SHORTCUT TRANSLATOR: Maps "/use ps" to your actual "role_pinger" configuration
        if (itemId === 'ps') {
            itemId = 'role_pinger';
        }

        const item = getItemById(itemId);

        if (!item) {
            return interaction.reply({ content: '❌ That item does not exist.', ephemeral: true });
        }

        // Set the response to ephemeral right away so the command footprint is hidden from public view
        await interaction.deferReply({ ephemeral: true });

        try {
            const db = interaction.client.db;
            if (!db) {
                return interaction.editReply({ content: '❌ Database instance context not found.' });
            }

            // Get user data from TitanBot's native database context
            const userData = await db.getUser(interaction.user.id);
            const inventory = userData?.inventory || {};

            // Verify ownership
            if (!inventory[itemId] || inventory[itemId] <= 0) {
                return interaction.editReply({ content: `❌ You do not own any **${item.name}**! Buy it from the shop first.` });
            }

            // Handle the role ping logic
            if (item.effect && item.effect.type === 'ping_role') {
                const roleId = item.effect.roleId;
                const role = interaction.guild.roles.cache.get(roleId);

                if (!role) {
                    return interaction.editReply({ content: '❌ Error: The target role could not be found.' });
                }

                // Handle temporary mention permissions if the role is locked down
                const originalMentionable = role.mentionable;
                if (!originalMentionable) {
                    await role.setMentionable(true, 'Temporary mention via shop item');
                }

                // Broadcast the ping publicly into the channel (Includes both display name and global mention)
                await interaction.channel.send({
                    content: `📢 **${interaction.user.username}** (${interaction.user}) consumed a **${item.name}**!\nAttention: ${role}`
                });

                // Revert temporary mention permissions back to secure settings
                if (!originalMentionable) {
                    await role.setMentionable(false, 'Reverting temporary mention');
                }

                // Deduct 1 item from inventory via TitanBot's native method
                await db.updateInventory(interaction.user.id, itemId, -1);

                return interaction.editReply({ content: `✅ Successfully used 1x **${item.name}**!` });
            }

            return interaction.editReply({ 
                content: `ℹ️ **${item.name}** is a passive tool or upgrade. You don't need to manually use it!` 
            });

        } catch (error) {
            console.error("Error inside your use command handler:", error);
            return interaction.editReply({ content: '❌ An error occurred while attempting to process this item.' });
        }
    }
};
