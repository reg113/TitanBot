import { SlashCommandBuilder } from 'discord.js';
import { getItemById } from '../../shop/items.js'; // Double check this path matches your items.js location

export default {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an active item from your inventory')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The ID of the item (e.g., role_pinger)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const itemId = interaction.options.getString('item');
        const item = getItemById(itemId);

        if (!item) {
            return interaction.reply({ content: '❌ That item does not exist.', ephemeral: true });
        }

        // Get user data from TitanBot's database context
        const userData = await interaction.client.db.getUser(interaction.user.id);
        const inventory = userData?.inventory || {};

        // Verify ownership
        if (!inventory[itemId] || inventory[itemId] <= 0) {
            return interaction.reply({ content: `❌ You do not own any **${item.name}**!`, ephemeral: true });
        }

        // Handle the role ping logic
        if (item.effect.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({ content: '❌ Error: The target role could not be found.', ephemeral: true });
            }

            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention via shop item');
            }

            // Ping the role in the channel
            await interaction.channel.send({
                content: `📢 ${interaction.user} consumed a **${item.name}**!\nAttention: ${role}`
            });

            if (!originalMentionable) {
                await role.setMentionable(false, 'Reverting temporary mention');
            }

            // Deduct 1 item from inventory
            await interaction.client.db.updateInventory(interaction.user.id, itemId, -1);

            return interaction.reply({ content: `✅ Successfully used 1x **${item.name}**!`, ephemeral: true });
        }

        return interaction.reply({ 
            content: `ℹ️ **${item.name}** is a passive tool. You don't need to manually use it!`, 
            ephemeral: true 
        });
    }
};
