import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('star')
        .setDescription('Lock a specific quantity of an animal to protect them from being sold')
        .addStringOption(option =>
            option.setName('animal')
                .setDescription('The ID of the animal (e.g., mouse, dragon)')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('quantity')
                .setDescription('How many copies to keep locked (set to 0 to unlock all)')
                .setRequired(true)
                .setMinValue(0)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const animalInput = interaction.options.getString('animal').toLowerCase();
        const targetQuantity = interaction.options.getInteger('quantity');
        const animalDef = ANIMALS[animalInput];

        if (!animalDef) {
            throw createError(
                "Invalid Animal",
                ErrorTypes.VALIDATION,
                `Could not find an animal matching "${animalInput}".`
            );
        }

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const userData = await getEconomyData(client, guildId, userId);
        const userZoo = userData.zoo || {};
        const currentOwned = userZoo[animalDef.id] || 0;

        if (targetQuantity > currentOwned && targetQuantity > 0) {
            throw createError(
                "Insufficient Animals",
                ErrorTypes.VALIDATION,
                `You only have **${currentOwned}** ${animalDef.name}(s) in your zoo. You cannot lock ${targetQuantity}.`
            );
        }

        if (!userData.zoo_starred) userData.zoo_starred = {};
        
        // Update the locked quantity map
        userData.zoo_starred[animalDef.id] = targetQuantity;

        // Clean up database if they set it to 0
        if (targetQuantity === 0) {
            delete userData.zoo_starred[animalDef.id];
        }

        await setEconomyData(client, guildId, userId, userData);

        const statusMessage = targetQuantity > 0
            ? `⭐ Protected **${targetQuantity}x** ${animalDef.emoji} **${animalDef.name}** from being sold! (Total owned: ${currentOwned})`
            : `🔓 Unlocked all ${animalDef.emoji} **${animalDef.name}** profiles. They can now be fully sold.`;

        await InteractionHelper.safeEditReply(interaction, { content: statusMessage });
    }, { command: 'star' })
};
