// commands/caravanCommand.js

import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getRandomCaravanScenario } from '../../utils/caravanScenarios.js';

export default {
    data: new SlashCommandBuilder()
        .setName('caravan')
        .setDescription('Launch an interactive Silk Road caravan expedition!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        // Safe Defer standard used across your commands
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // Retrieve existing user profile
        const userData = await getEconomyData(client, guildId, userId);
        const inventory = userData.inventory || {};
        const hasCamelArmor = inventory["camel_armor"] > 0;

        // Prevent overlapping active caravans
        if (userData.activeCaravan) {
            throw createError(
                "Expedition in Progress",
                ErrorTypes.GAME_RULE,
                "Your caravan is already traveling out in the desert! You must resolve your current journey before dispatching another."
            );
        }

        const entryFee = 500;
        if (userData.wallet < entryFee) {
            throw createError(
                "Insufficient Funds",
                ErrorTypes.GAME_RULE,
                `Preparing a caravan requires at least **${entryFee.toLocaleString()} Dirhams** for supplies and camel teams. (Your wallet: ${userData.wallet.toLocaleString()} Dirhams)`
            );
        }

        // Initialize active caravan state
        userData.wallet -= entryFee;
        userData.activeCaravan = {
            step: 1, // Progressing: 1 (Departure) -> 2 (Encounter 1) -> 3 (Encounter 2) -> 4 (Market Gates)
            cargoIntegrity: 100,
            goldSpent: entryFee,
            usedScenarios: [],
            currentScenario: null
        };
        await setEconomyData(client, guildId, userId, userData);

        // Build Departure Screen
        const embed = createEmbed({
            title: "🐫 Caravan Dispatch",
            description: `*“We depart Damascus with 10 fine camels, loaded with spices and glass beads. The desert is unforgiving, but the fortune at the end of the road is legendary.”*\n\nYour cargo has been packed at **100% Integrity**. Let the journey begin.`,
            color: '#E0A96D'
        }).addFields(
            { name: '💰 Investment', value: `${entryFee} Dirhams`, inline: true },
            { name: '📦 Cargo Integrity', value: '100%', inline: true }
        );

        // Render Camel Armor warning details if owned
        if (hasCamelArmor) {
            embed.setFooter({ text: "🛡️ Camel Armor is equipped: Integrity damage is reduced by 30%!" });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('caravan_advance')
                .setLabel('Begin Journey')
                .setStyle(ButtonStyle.Primary)
        );

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: [row]
        });

        // Set up the interactive Button Collector directly tied to this message instance
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60000 // 60 seconds inactivity timeout
        });

        collector.on('collect', async i => {
            collector.resetTimer(); // Reset safety timeout on click

            // Re-fetch economy profile to ensure data consistency
            const freshUser = await getEconomyData(client, guildId, userId);
            const exp = freshUser.activeCaravan;

            if (!exp) {
                return i.reply({ content: "⚠️ This caravan session has expired or was already closed.", ephemeral: true });
            }

            if (i.customId === 'caravan_advance') {
                // Determine next unique scenario from our scenario database
                const scenario = getRandomCaravanScenario(exp.usedScenarios);
                exp.currentScenario = scenario;
                exp.usedScenarios.push(scenario.id);
                exp.step += 1;

                await setEconomyData(client, guildId, userId, freshUser);

                const encounterEmbed = createEmbed({
                    title: `🧭 Day ${exp.step * 10}: ${scenario.title}`,
                    description: scenario.description,
                    color: '#D4A373'
                }).addFields(
                    { name: '📦 Cargo Integrity', value: `${exp.cargoIntegrity}%`, inline: true },
                    { name: '💰 Expenses Accrued', value: `${exp.goldSpent} Dirhams`, inline: true }
                );

                const choiceRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('option_a')
                        .setLabel(scenario.optionALabel)
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('option_b')
                        .setLabel(scenario.optionBLabel)
                        .setStyle(ButtonStyle.Danger)
                );

                await i.update({
                    embeds: [encounterEmbed],
                    components: [choiceRow]
                });

            } else if (i.customId === 'option_a' || i.customId === 'option_b') {
                const scenario = exp.currentScenario;
                const chosenEffect = i.customId === 'option_a' ? scenario.optionAEffect : scenario.optionBEffect;

                // Process integrity effects (Apply Camel Armor damage reduction helper)
                let integrityDamage = chosenEffect.integrityChange;
                if (hasCamelArmor && integrityDamage < 0) {
                    integrityDamage = Math.round(integrityDamage * 0.7); // 30% damage reduction
                }

                exp.cargoIntegrity = Math.max(0, exp.cargoIntegrity + integrityDamage);
                exp.goldSpent -= chosenEffect.goldChange; // Adjust tracked debt / costs

                await setEconomyData(client, guildId, userId, freshUser);

                const resultEmbed = createEmbed({
                    title: `📝 Journal Entry: Day ${exp.step * 10}`,
                    description: `${chosenEffect.text}\n\nYour cargo integrity is now sitting at **${exp.cargoIntegrity}%**.`,
                    color: exp.cargoIntegrity > 30 ? '#CCD5AE' : '#E63946'
                });

                const nextStep = exp.step >= 3 ? 'caravan_market' : 'caravan_advance';
                const nextLabel = exp.step >= 3 ? 'Enter Market Gates' : 'Advance Caravan';
                const nextStyle = exp.step >= 3 ? ButtonStyle.Success : ButtonStyle.Primary;

                const nextRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(nextStep)
                        .setLabel(nextLabel)
                        .setStyle(nextStyle)
                );

                await i.update({
                    embeds: [resultEmbed],
                    components: [nextRow]
                });

            } else if (i.customId === 'caravan_market') {
                // Final payout calculations relative to remaining integrity
                const baseValue = 1800; 
                const cargoValue = Math.floor(baseValue * (exp.cargoIntegrity / 100));
                const totalInvested = exp.goldSpent;
                const netProfit = cargoValue - totalInvested;

                // Credit player and clear active expedition lock
                freshUser.wallet += cargoValue; 
                freshUser.activeCaravan = null;
                await setEconomyData(client, guildId, userId, freshUser);

                const marketEmbed = createEmbed({
                    title: '🕌 The Souk of Baghdad',
                    description: `Your caravan passes through the heavy copper gates of Baghdad! Merchants immediately gather to inspect your goods.`,
                    color: '#2A9D8F'
                }).addFields(
                    { name: '📦 Remaining Cargo Integrity', value: `${exp.cargoIntegrity}%`, inline: false },
                    { name: '📈 Market Sale Price', value: `+${cargoValue.toLocaleString()} Dirhams`, inline: true },
                    { name: '📉 Total Expenses', value: `-${totalInvested.toLocaleString()} Dirhams`, inline: true },
                    { name: '⚖️ Net Return', value: `${netProfit >= 0 ? '🟢' : '🔴'} ${netProfit.toLocaleString()} Dirhams`, inline: false },
                    { name: '💰 New Wallet Balance', value: `${freshUser.wallet.toLocaleString()} Dirhams`, inline: false }
                );

                await i.update({
                    embeds: [marketEmbed],
                    components: [] // Safely lock interactive elements
                });

                collector.stop();
            }
        });

        // Safe Reset on AFK
        collector.on('end', async (_, reason) => {
            if (reason !== 'user' && reason !== 'messageDelete') {
                const freshUser = await getEconomyData(client, guildId, userId);
                
                // Unlock player's state if they vanished mid-game
                if (freshUser.activeCaravan) {
                    freshUser.activeCaravan = null;
                    await setEconomyData(client, guildId, userId, freshUser);
                }

                try {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('disabled')
                            .setLabel('Caravan Abandoned')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                    await interaction.editReply({ components: [disabledRow] });
                } catch {
                    // Fail silently if message deleted
                }
            }
        });
    }, { command: 'caravan' })
};
