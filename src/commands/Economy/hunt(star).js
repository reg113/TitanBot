import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('star')
        .setDescription('Toggle favorite lock on an animal to protect it from mass selling')
        .addStringOption(option =>
            option.setName('animal')
                .setDescription('The ID of the animal (e.g., mouse, dragon)')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const animalInput = interaction.options.getString('animal').toLowerCase();
        const animalDef = ANIMALS[animalInput];

        if (!animalDef) {
            throw createError(
                "Invalid Animal",
                ErrorTypes.VALIDATION,
                `Could not find an animal matching "${animalInput}". Check spelling configuration.`
            );
        }

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const userData = await getEconomyData(client, guildId, userId);
        
        if (!userData.zoo_starred) userData.zoo_starred = {};
        
        // Toggle action
        const isCurrentlyStarred = !!userData.zoo_starred[animalDef.id];
        userData.zoo_starred[animalDef.id] = !isCurrentlyStarred;

        await setEconomyData(client, guildId, userId, userData);

        const statusMessage = !isCurrentlyStarred 
            ? `⭐ **${animalDef.name}** is now locked! It will be skipped during \`/sellall\`.`
            : `🔓 **${animalDef.name}** unlocked. It can now be sold normally.`;

        await InteractionHelper.safeEditReply(interaction, { content: statusMessage });
    }, { command: 'star' })
};
