import { SlashCommandBuilder } from 'discord.js';
import { getItemById } from '../../shop/items.js'; // Double-check this relative path matches your directory structure

export default {
    data: new SlashCommandBuilder()
        .setName('ps')
        .setDescription('Consume a Role Pinger item to mention the designated server role.'),

    async execute(interaction) {
        const itemId = 'role_pinger';
        const item = getItemById(itemId);

        if (!item) {
            return interaction.reply({ 
                content: '❌ The role pinger item configuration was not found in items.js.', 
                ephemeral: true 
            });
        }

        // Access the database wrapper attached to the client
        const db = interaction.client.db;
        if (!db) {
            console.error("❌ TitanBot database wrapper object not found on interaction.client.db");
            return interaction.reply({ 
                content: "❌ Database connection error. Check your bot logs.", 
                ephemeral: true 
            });
        }

        try {
            // Defer the reply to give the bot time to run database checks and update roles
            await interaction.deferReply({ ephemeral: true });

            // 1. Fetch user profile data
            // ⚠️ NOTE: Replace 'getUser' with whatever method your specific TitanBot fork uses to pull user profiles (e.g., db.users.find)
            const userData = await db.getUser(interaction.user.id);
            const inventory = userData?.inventory || {};

            // 2. Verify item ownership
            if (!inventory[itemId] || inventory[itemId] <= 0) {
                return interaction.editReply({ 
                    content: `❌ You do not own any **${item.name}**!` 
                });
            }

            // 3. Find the target role configuration
            const roleId = item.effect.roleId;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.editReply({ 
                    content: '❌ Configuration Error: The target role could not be found in this server.' 
                });
            }

            // 4. Handle mention adjustments if the role isn't universally taggable
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention via shop item use');
            }

            // 5. Broadcast the ping publicly into the channel
            await interaction.channel.send({
                content: `📢 **${interaction.user.username}** (${interaction.user}) consumed a **${item.name}**!\nAttention: ${role}`
            });

            // 6. Reset the role privacy state back to its original setting
            if (!originalMentionable) {
                await role.setMentionable(false, 'Reverting temporary mention');
            }

            // 7. Deduct 1 copy from their database inventory tracker
            // ⚠️ NOTE: Replace 'updateInventory' with your branch's exact inventory modification function
            await db.updateInventory(interaction.user.id, itemId, -1);

            // Confirm success cleanly to the user who ran it
            return interaction.editReply({ 
                content: `✅ Successfully consumed 1 **${item.name}**.` 
            });

        } catch (error) {
            console.error("An error occurred during item execution:", error);
            
            // Helpful debug assistant if your terminal runs into method errors
            console.log("Your bot instance's available database functions are:", Object.keys(db));
            
            return interaction.editReply({ 
                content: `❌ Failed to process inventory action. Check your hosting terminal console for database method names.` 
            });
        }
    }
};
