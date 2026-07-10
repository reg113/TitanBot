import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('sellall')
        .setDescription('Sell all unprotected zoo animals at once for market value'),

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
                // Check if this animal is starred/locked
                if (starredAnimals[id] === true) {
                    skippedStarredCount += quantity;
                    continue; 
                }

                const animalDef = ANIMALS[id];
                if (!animalDef) continue;
                
                const rolledPrice = Math.floor(Math.random() * (animalDef.maxPrice - animalDef.minPrice + 1)) + animalDef.minPrice;
                
                totalEarnings += rolledPrice * quantity;
                totalAnimalsSold += quantity;
                userZoo[id] = 0; 
            }
        }

        if (totalAnimalsSold === 0) {
            const extraTip = skippedStarredCount > 0 
                ? "\n*(Note: Your current animals are starred and protected from liquidation)*" 
                : "";
            throw createError(
                "No Liquidatable Animals",
                ErrorTypes.VALIDATION,
                `You don't have any tradeable animals in your zoo to sell.${extraTip}`
            );
        }

        userData.zoo = userZoo;
        userData.wallet = (userData.wallet || 0) + totalEarnings;

        await setEconomyData(client, guildId, userId, userData);

        let summaryText = `💰 **Zoo Liquidated!** You sold **${totalAnimalsSold}** animals for **$${totalEarnings.toLocaleString()}**.`;
        if (skippedStarredCount > 0) {
            summaryText += `\n🛡️ Safely retained **${skippedStarredCount}** protected/starred animals.`;
        }
        summaryText += `\nYour new cash balance is **$${userData.wallet.toLocaleString()}**.`;

        await InteractionHelper.safeEditReply(interaction, { content: summaryText });
    }, { command: 'sellall' })
};
