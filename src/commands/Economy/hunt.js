import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const cooldowns = new Map();
const COOLDOWN_TIME_MS = 15 * 1000; // 15 seconds (OwO bot style fast pacing)

const PREY_LIST = [
    { id: 'rabbit', name: 'Rabbit', emoji: '🐇', chance: 30 },
    { id: 'duck', name: 'Duck', emoji: '🦆', chance: 25 },
    { id: 'deer', name: 'Deer', emoji: '🦌', chance: 15 },
    { id: 'unicorn', name: 'unicorn', emoji: '🦄', chance: 1 },
    { id: 'bear', name: 'Bear', emoji: '🐻', chance: 3 } // Rare
];

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
                const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
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

        // Weighted random selection
        const roll = Math.random() * 100;
        let accumulatedChance = 0;
        let caught = PREY_LIST[0];

        for (const prey of PREY_LIST) {
            accumulatedChance += prey.chance;
            if (roll <= accumulatedChance) {
                caught = prey;
                break;
            }
        }

        const userData = await getEconomyData(client, guildId, userId);
        
        // Ensure the zoo collection object exists in the DB profile
        if (!userData.zoo) userData.zoo = {};
        userData.zoo[caught.id] = (userData.zoo[caught.id] || 0) + 1;

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
