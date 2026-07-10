import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMAL_LIST } from '../../utils/animals.js';

const cooldowns = new Map();
const COOLDOWN_TIME_MS = 2 * 60 * 1000; 

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('hunt')
        .setDescription('Hunt down animals to add to your zoo collection!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME_MS;
            if (now < expirationTime) {
                const timeLeft = ((expirationTime - now) /60 * 1000).toFixed(1);
                throw createError(
                    "On Cooldown",
                    ErrorTypes.RATE_LIMIT,
                    `🌲 The wilderness is resting. Wait **${timeLeft}s**.`
                );
            }
        }

        // 20% fail rate
        if (Math.random() < 0.20) {
            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME_MS);
            
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: "🏹 Hunt Failed", description: "The animal got away!", color: "warning" })]
            });
        }

        const roll = Math.random() * 100;
        let accumulatedChance = 0;
        let caught = ANIMAL_LIST[0];

        for (const prey of ANIMAL_LIST) {
            accumulatedChance += prey.chance;
            if (roll <= accumulatedChance) {
                caught = prey;
                break;
            }
        }

        const userData = await getEconomyData(client, guildId, userId);
        
        // Initialize structures if they don't exist
        if (!userData.zoo) userData.zoo = {};
        if (!userData.zoo_discovered) userData.zoo_discovered = {};

        // 1. Add to current sellable/battle inventory
        userData.zoo[caught.id] = (userData.zoo[caught.id] || 0) + 1;

        // 2. Add to permanent lifetime checklist log
        userData.zoo_discovered[caught.id] = true;

        await setEconomyData(client, guildId, userId, userData);

        cooldowns.set(userId, now);
        setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME_MS);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(
                "✨ Caught an Animal!",
                `You successfully caught a **${caught.emoji} ${caught.name}** and added it to your zoo!`
            )]
        });
    }, { command: 'hunt' })
};
