import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('sellall')
        .setDescription('Sell all unprotected zoo animals, keeping your starred combat counts safe'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const userData = await getEconomyData(client, guildId, userId);
        const userZoo = userData.zoo || {};
        const starredAnimals = userData.zoo_starred || {};

        let totalEarnings = 0;
        let totalAnimalsSold = 0;
        let skippedStarredCount = 0;

        for (const [id, quantity] of Object.entries(userZoo)) {
            if (quantity > 0) {
                const lockedQuantity = starredAnimals[id] || 0;
                
                // Calculate how many can actually be sold
                const sellableQuantity = Math.max(0, quantity - lockedQuantity);
                const keptQuantity = quantity - sellableQuantity;

                skippedStarredCount += keptQuantity;

                if (sellableQuantity > 0) {
                    const animalDef = ANIMALS[id];
                    if (!animalDef) continue;
                    
                    // Generate prices for the items sold
                    let animalEarnings = 0;
                    for (let i = 0; i < sellableQuantity; i++) {
                        animalEarnings += Math.floor(Math.random() * (animalDef.maxPrice - animalDef.minPrice + 1)) + animalDef.minPrice;
                    }
                    
                    totalEarnings += animalEarnings;
                    totalAnimalsSold += sellableQuantity;
                    
                    // Update inventory to only retain what was locked
                    userZoo[id] = keptQuantity; 
                }
            }
        }

        if (totalAnimalsSold === 0) {
            const extraTip = skippedStarredCount > 0 
                ? "\n*(Note: Your remaining inventory matches or is lower than your starred allocations for combat.)*" 
                : "";
            throw createError(
                "No Surplus Animals",
                ErrorTypes.VALIDATION,
                `You don't have any unprotected animals to sell right now.${extraTip}`
            );
        }

        userData.zoo = userZoo;
        userData.wallet = (userData.wallet || 0) + totalEarnings;

        await setEconomyData(client, guildId, userId, userData);

        let summaryText = `💰 **Surplus Liquidated!** You sold **${totalAnimalsSold}** excess animals for **$${totalEarnings.toLocaleString()}**.`;
        if (skippedStarredCount > 0) {
            summaryText += `\n🛡️ Safely protected **${skippedStarredCount}** battle-starred animals.`;
        }
        summaryText += `\nYour new cash balance is **$${userData.wallet.toLocaleString()}**.`;

        await InteractionHelper.safeEditReply(interaction, { content: summaryText });
    }, { command: 'sellall' })
};
