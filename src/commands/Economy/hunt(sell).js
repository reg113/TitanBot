import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS, ANIMAL_LIST } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell a specific animal from your zoo')
        .addStringOption(option =>
            option.setName('animal')
                .setDescription('Type the name of the animal to sell')
                .setRequired(true)
                .setAutocomplete(true) 
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount of this animal to sell')
                .setRequired(true)
                .setMinValue(1)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        
        const filtered = ANIMAL_LIST.filter(animal => 
            animal.name.toLowerCase().includes(focusedValue)
        );

        await interaction.respond(
            filtered.slice(0, 25).map(choice => ({ 
                name: `${choice.emoji} ${choice.name} ($${choice.minPrice} - $${choice.maxPrice})`, 
                value: choice.id 
            }))
        );
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        const animalChoice = interaction.options.getString('animal');
        const quantityToSell = interaction.options.getInteger('amount');

        const animalDef = ANIMALS[animalChoice];
        if (!animalDef) {
            throw createError(
                "Invalid Animal",
                ErrorTypes.VALIDATION,
                `The animal "${animalChoice}" does not exist in the market.`
            );
        }

        const userData = await getEconomyData(client, guildId, userId);
        const userZoo = userData.zoo || {};
        const ownedQuantity = userZoo[animalChoice] || 0;

        if (ownedQuantity < quantityToSell) {
            throw createError(
                "Insufficient Stock",
                ErrorTypes.VALIDATION,
                `You tried to sell ${quantityToSell} ${animalDef.name}s, but you only have **x${ownedQuantity}** in your zoo.`
            );
        }

        const rolledPrice = Math.floor(Math.random() * (animalDef.maxPrice - animalDef.minPrice + 1)) + animalDef.minPrice;
        const grossEarnings = rolledPrice * quantityToSell;

        userZoo[animalChoice] = ownedQuantity - quantityToSell;
        userData.zoo = userZoo;
        userData.wallet = (userData.wallet || 0) + grossEarnings;

        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(
                "💸 Market Sale",
                `Successfully sold **x${quantityToSell} ${animalDef.name}** at **$${rolledPrice}** each for a total of **$${grossEarnings.toLocaleString()}**.`
            ).addFields({
                name: "Your New Wallet Balance",
                value: `$${userData.wallet.toLocaleString()}`
            })]
        });
    }, { command: 'sell' })
};
