import { SlashCommandBuilder } from 'discord.js';
import { getItemById } from '../../shop/items.js'; // Adjust this relative path to point to your items.js file

export default {
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Consume an item from your inventory')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The ID of the item you want to use')
                .setRequired(true)
        ),

    async execute(interaction) {
        const itemId = interaction.options.getString('item');
        const item = getItemById(itemId);

        // 1. Check if the item exists in the database/config
        if (!item) {
            return interaction.reply({ content: '❌ That item does not exist.', ephemeral: true });
        }

        // 2. Fetch the user data from TitanBot's database context
        // TitanBot typically attaches db models or wrappers to the interaction/client object
        const userData = await interaction.client.db.getUser(interaction.user.id); 
        const inventory = userData?.inventory || {};

        // 3. Verify the user actually owns the item
        if (!inventory[itemId] || inventory[itemId] <= 0) {
            return interaction.reply({ content: `❌ You don't have any **${item.name}** in your inventory!`, ephemeral: true });
        }

        // 4. Handle our custom role ping logic
        if (item.effect.type === 'ping_role') {
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({ 
                    content: '❌ Configuration Error: The target role could not be found.', 
                    ephemeral: true 
                });
            }

            // Save the role's original state, toggle it to mentionable, ping, then revert it
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention via shop item');
            }

            await interaction.channel.send({
                content: `📢 ${interaction.user} consumed a **${item.name}**!\nAttention: ${role}`
            });

            if (!originalMentionable) {
                await role.setMentionable(false, 'Reverting temporary mention');
            }

            // 5. Deduct 1 item from the database inventory setup
            await interaction.client.db.updateInventory(interaction.user.id, itemId, -1);

            return interaction.reply({ content: `✅ Used 1x **${item.name}**!`, ephemeral: true });
        }

        // Fallback for items that aren't actively consumable
        return interaction.reply({ 
            content: `ℹ️ **${item.name}** is a passive item. You don't need to use it manually!`, 
            ephemeral: true 
        });
    }
};
