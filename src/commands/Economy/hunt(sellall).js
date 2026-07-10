import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('sellall')
        .setDescription('Sell all your zoo animals at once for current market value'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const userData = await getEconomyData(client, guildId, userId);
        const userZoo = userData.zoo || {};

        let totalEarnings = 0;
        let totalAnimalsSold = 0;

        for (const [id, quantity] of Object.entries(userZoo)) {
            if (quantity > 0) {
                const animalDef = ANIMALS[id];
                if (!animalDef) continue;
                
                const rolledPrice = Math.floor(Math.random() * (animalDef.maxPrice - animalDef.minPrice + 1)) + animalDef.minPrice;
                
                totalEarnings += rolledPrice * quantity;
                totalAnimalsSold += quantity;
                userZoo[id] = 0; 
            }
        }

        if (totalAnimalsSold === 0) {
            throw createError(
                "Empty Zoo",
                ErrorTypes.VALIDATION,
                "You don't have any animals in your zoo to sell."
            );
        }

        userData.zoo = userZoo;
        userData.wallet = (userData.wallet || 0) + totalEarnings;

        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, {
            content: `💰 **Zoo Liquidated!** You sold **${totalAnimalsSold}** animals at fluctuating market rates and earned **$${totalEarnings.toLocaleString()}**.\nYour new cash balance is **$${userData.wallet.toLocaleString()}**.`
        });
    }, { command: 'sellall' })
};
