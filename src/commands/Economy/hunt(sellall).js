import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Min and Max price ranges for each animal
const ANIMAL_PRICE_RANGES = {
    rabbit: { min: 10, max: 20 },
    duck: { min: 15, max: 35 },
    deer: { min: 40, max: 80 },
    unicorn: { min: 150, max: 200 },
    bear: { min: 100, max: 150 }
};

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
                const range = ANIMAL_PRICE_RANGES[id];
                if (!range) continue;

                // Roll a random price per unit within the min/max range
                const rolledPrice = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
                
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
            embeds: [successEmbed(
                "💰 Zoo Liquidated",
                `Successfully sold **${totalAnimalsSold}** animals at fluctuating market rates, earning a total of **$${totalEarnings.toLocaleString()}**.`
            ).addFields({
                name: "Your New Wallet Balance",
                value: `$${userData.wallet.toLocaleString()}`
            })]
        });
    }, { command: 'sellall' })
};
