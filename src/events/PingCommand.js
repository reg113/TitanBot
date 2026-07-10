import { Events } from 'discord.js';
import { getItemById } from '../shop/items.js'; // Adjust path if your shop folder is located elsewhere

// 🛠️ CONFIGURATION
const PREFIX = '!'; // Change this to whatever prefix your server uses (e.g., !, $, ?)

export default {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignore other bots or webhooks
        if (message.author.bot) return;
        
        // Match your specific target format cleanly
        const targetCommand = `${PREFIX}ps`.toLowerCase();
        if (message.content.toLowerCase().trim() !== targetCommand) return;

        const itemId = 'role_pinger';
        const item = getItemById(itemId);

        if (!item) {
            return message.reply('❌ The role pinger item configuration was not found in items.js.')
                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
        }

        try {
            // Verify database context is available
            if (!message.client.db) {
                console.error("❌ TitanBot database wrapper object not found on message.client.db");
                return message.reply("❌ Database connection error. Check your bot logs.");
            }

            // 1. Fetch user profile data
            const userData = await message.client.db.getUser(message.author.id);
            const inventory = userData?.inventory || {};

            // 2. Verify ownership
            if (!inventory[itemId] || inventory[itemId] <= 0) {
                // Delete their command attempt anyway to keep the channel clean
                await message.delete().catch(() => {});
                return message.channel.send(`❌ ${message.author}, you do not own any **${item.name}**!`)
                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            }

            // 3. Find the role configuration
            const roleId = item.effect.roleId;
            const role = message.guild.roles.cache.get(roleId);

            if (!role) {
                return message.reply('❌ Configuration Error: The target role could not be found in this server.')
                    .then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
            }

            // 4. Success path: delete the user's trigger message immediately
            await message.delete().catch(() => {});

            // 5. Handle mention adjustments if the role isn't universally taggable
            const originalMentionable = role.mentionable;
            if (!originalMentionable) {
                await role.setMentionable(true, 'Temporary mention via shop item use');
            }

            // 6. Broadcast the ping while visibly logging the username and text tag
            await message.channel.send({
                content: `📢 **${message.author.username}** (${message.author}) consumed a **${item.name}**!\nAttention: ${role}`
            });

            // 7. Reset the role privacy state back to default
            if (!originalMentionable) {
                await role.setMentionable(false, 'Reverting temporary mention');
            }

            // 8. Deduct 1 copy from their database inventory tracker
            await message.client.db.updateInventory(message.author.id, itemId, -1);

        } catch (error) {
            console.error("An error occurred during text item execution:", error);
            
            // Helpful debug helper: If TitanBot uses different database schemas/methods on your branch,
            // this prints out your available options right in your console logs for you
            if (message.client.db) {
                console.log("Your bot instance's available database functions are:", Object.keys(message.client.db));
            }
            
            return message.channel.send(`❌ Failed to process inventory action. Please check your hosting terminal console.`);
        }
    }
};
