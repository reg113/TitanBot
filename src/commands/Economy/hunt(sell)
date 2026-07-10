import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Matches the exact same min and max price ranges as sellall.js
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
        .setName('sell')
        .setDescription('Sell a specific animal from your zoo')
        .addStringOption(option =>
            option.setName('animal')
                .setDescription('The type of animal to sell')
                .setRequired(true)
                .addChoices(
                    { name: 'Rabbit ($10 - $20)', value: 'rabbit' },
                    { name: 'Duck ($15 - $35)', value: 'duck' },
                    { name: 'Deer ($40 - $80)', value: 'deer' },
                    { name: 'Boar ($80 - $140)', value: 'boar' },
                    { name: 'Bear ($250 - $450)', value: 'bear' }
                )
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of this animal to sell')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        const animalChoice = interaction.options.getString('animal');
        const quantityToSell = interaction.options.getInteger('amount');

        const userData = await getEconomyData(client, guildId, userId);
        const userZoo = userData.zoo || {};
        const ownedQuantity = userZoo[animalChoice] || 0;

        if (ownedQuantity < quantityToSell) {
            throw createError(
                "Insufficient Stock",
                ErrorTypes.VALIDATION,
                `You tried to sell ${quantityToSell} ${animalChoice}s, but you only have **x${ownedQuantity}** in your zoo.`
            );
        }

        const range = ANIMAL_PRICE_RANGES[animalChoice];
        
        // Roll a random price per unit within the min/max range
        const rolledPrice = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
        const grossEarnings = rolledPrice * quantityToSell;

        userZoo[animalChoice] = ownedQuantity - quantityToSell;
        userData.zoo = userZoo;
        userData.wallet = (userData.wallet || 0) + grossEarnings;

        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(
                "💸 Market Sale",
                `Successfully sold **x${quantityToSell} ${animalChoice}** at **$${rolledPrice}** each for a total of **$${grossEarnings.toLocaleString()}**.`
            ).addFields({
                name: "Your New Wallet Balance",
                value: `$${userData.wallet.toLocaleString()}`
            })]
        });
    }, { command: 'sell' })
};
