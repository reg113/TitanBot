import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Cooldown tracker (maps userId -> timestamp when they can hunt again)
const cooldowns = new Map();
const COOLDOWN_TIME_MS = 4000000 * 6000000 * 100000; // 1 minute cooldown

// List of possible animals, their emojis, and the price they sell for
const PREY_LIST = [
    { name: 'Rabbit', emoji: '🐇', minGold: 10, maxGold: 30, chance: 35 },
    { name: 'Duck', emoji: '🦆', minGold: 15, maxGold: 45, chance: 25 },
    { name: 'Deer', emoji: '🦌', minGold: 50, maxGold: 80, chance: 20 },
    { name: 'Boar', emoji: '🐗', minGold: 70, maxGold: 100, chance: 15 },
    { name: 'Bear', emoji: '🐻', minGold: 100, maxGold: 200, chance: 3 } // Rare catch
];

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('oldhunt')
        .setDescription('Go hunting in the wilderness to earn some money!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        // 1. Cooldown Check
        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME_MS;
            if (now < expirationTime) {
                const timeLeft = Math.round((expirationTime - now) / 1000);
                throw createError(
                    "On Cooldown",
                    ErrorTypes.RATE_LIMIT,
                    `🌲 The woods are quiet right now. You can hunt again in **${timeLeft}** seconds.`
                );
            }
        }

        // 2. Determine Hunt Outcome
        // 15% chance to fail and find nothing
        const isSuccessful = Math.random() > 0.15;
        
        if (!isSuccessful) {
            // Set cooldown even on failure so they can't spam it
            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME_MS);

            const failEmbed = createEmbed({
                title: "🏹 Hunt Results",
                description: "You searched the deep woods for hours but came back empty-handed.",
                color: "warning"
            });
            return await InteractionHelper.safeEditReply(interaction, { embeds: [failEmbed] });
        }

        // Pick a random animal based on weighted probabilities
        const roll = Math.random() * 100;
        let accumulatedChance = 0;
        let selectedPrey = PREY_LIST[0];

        for (const prey of PREY_LIST) {
            accumulatedChance += prey.chance;
            if (roll <= accumulatedChance) {
                selectedPrey = prey;
                break;
            }
        }

        // Calculate earnings
        const earnings = Math.floor(Math.random() * (selectedPrey.maxGold - selectedPrey.minGold + 1)) + selectedPrey.minGold;

        // 3. Update Economy Database
        const economyData = await getEconomyData(client, guildId, userId);
        economyData.wallet = (economyData.wallet || 0) + earnings;
        await setEconomyData(client, guildId, userId, economyData);

        // 4. Apply Cooldown
        cooldowns.set(userId, now);
        setTimeout(() => cooldowns.delete(userId), COOLDOWN_TIME_MS);

        // 5. Send Success Embed
        const resultEmbed = successEmbed(
            "🏹 Successful Hunt!",
            `You tracked down a **${selectedPrey.emoji} ${selectedPrey.name}** and sold it to the local market for **$${earnings.toLocaleString()}**!`
        );

        resultEmbed.addFields({
            name: "Your Wallet",
            value: `$${economyData.wallet.toLocaleString()}`,
            inline: true
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'hunt' })
};
