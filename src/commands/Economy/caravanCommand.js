// /caravanCommand.js

import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getRandomCaravanScenario } from '../utils/caravanScenarios.js';

/* 
================================================================================
caravanCommand.js
================================================================================
*/
import { getEconomyData, setEconomyData } from '../utils/economy.js';

export default {
    data: new SlashCommandBuilder()
        .setName('caravan')
        .setDescription('Launch an interactive Silk Road caravan expedition!'),
    
    async execute(interaction) {
        const userId = interaction.user.id;
        
        // 1. Fetch player profile from your actual database setup
        const userData = await getEconomyData(userId);

        // State Check: Prevent starting multiple runs simultaneously
        if (userData.status === 'on_expedition') {
            return interaction.reply({
                content: "⚠️ **Your caravan is already out in the desert!** Complete your active expedition before starting a new one.",
                ephemeral: true
            });
        }

        const entryFee = 500;
        if (userData.gold < entryFee) {
            return interaction.reply({
                content: `❌ **You do not have enough Gold!** Preparing a caravan requires at least **${entryFee} Gold** for supplies. (You have: ${userData.gold} Gold)`,
                ephemeral: true
            });
        }

        // Initialize Caravan Journey State
        userData.gold -= entryFee;
        userData.status = 'on_expedition';
        userData.expedition = {
            step: 1, // Steps: 1 (Start) -> 2 (Encounter 1) -> 3 (Encounter 2) -> 4 (Market)
            cargoIntegrity: 100,
            goldSpent: entryFee,
            usedScenarios: [],
            currentScenario: null
        };
        
        // Save state changes back to database
        await setEconomyData(userId, userData);

        // Build Departure Screen
        const embed = new EmbedBuilder()
            .setColor('#E0A96D')
            .setTitle('🐫 Caravan Dispatch')
            .setDescription(`*“We depart Damascus with 10 fine camels, loaded with spices and glass beads. The desert is unforgiving, but the fortune at the end of the road is legendary.”*\n\nYour cargo has been packed at **100% Integrity**. Let the journey begin.`)
            .addFields(
                { name: '💰 Investment', value: `${entryFee} Gold`, inline: true },
                { name: '📦 Cargo Integrity', value: '100%', inline: true }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('caravan_advance')
                .setLabel('Begin Journey')
                .setStyle(ButtonStyle.Primary)
        );

        const response = await interaction.reply({
            embeds: [embed],
            components: [row]
        });

        // Set up button collector (Ends if player is inactive for 60 seconds)
        const collector = response.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60000 
        });

        collector.on('collect', async i => {
            collector.resetTimer(); // Reset inactivity timer on click

            // Re-fetch profile to keep calculations secure & accurate
            const freshUser = await getEconomyData(userId);
            const exp = freshUser.expedition;

            if (i.customId === 'caravan_advance') {
                // Fetch next unique scenario
                const scenario = getRandomCaravanScenario(exp.usedScenarios);
                exp.currentScenario = scenario;
                exp.usedScenarios.push(scenario.id);
                exp.step += 1;

                await setEconomyData(userId, freshUser);

                const encounterEmbed = new EmbedBuilder()
                    .setColor('#D4A373')
                    .setTitle(`🧭 Day ${exp.step * 10}: ${scenario.title}`)
                    .setDescription(scenario.description)
                    .addFields(
                        { name: '📦 Cargo Integrity', value: `${exp.cargoIntegrity}%`, inline: true },
                        { name: '💰 Gold Spent So Far', value: `${exp.goldSpent} Gold`, inline: true }
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

                // Process consequences
                exp.cargoIntegrity = Math.max(0, exp.cargoIntegrity + chosenEffect.integrityChange);
                exp.goldSpent -= chosenEffect.goldChange; // Modifies total expenditure debt

                await setEconomyData(userId, freshUser);

                const resultEmbed = new EmbedBuilder()
                    .setColor(exp.cargoIntegrity > 30 ? '#CCD5AE' : '#E63946')
                    .setTitle(`📝 Journal Entry: Day ${exp.step * 10}`)
                    .setDescription(`${chosenEffect.text}\n\nYour cargo integrity is now sitting at **${exp.cargoIntegrity}%**.`);

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
                // Final payout calculations based on integrity
                const baseValue = 1800; 
                const cargoValue = Math.floor(baseValue * (exp.cargoIntegrity / 100));
                const totalInvested = exp.goldSpent;
                const netProfit = cargoValue - totalInvested;

                // Credit the user's account and reset active status
                freshUser.gold += cargoValue; 
                freshUser.status = 'idle';
                freshUser.expedition = null;
                await setEconomyData(userId, freshUser);

                const marketEmbed = new EmbedBuilder()
                    .setColor('#2A9D8F')
                    .setTitle('🕌 The Souk of Baghdad')
                    .setDescription(`Your caravan passes through the heavy copper gates of Baghdad! Merchants immediately gather to inspect your goods.`)
                    .addFields(
                        { name: '📦 Remaining Cargo Integrity', value: `${exp.cargoIntegrity}%`, inline: false },
                        { name: '📈 Market Sale Price', value: `+${cargoValue} Gold`, inline: true },
                        { name: '📉 Total Expenses', value: `-${totalInvested} Gold`, inline: true },
                        { name: '⚖️ Net Return', value: `${netProfit >= 0 ? '🟢' : '🔴'} ${netProfit} Gold`, inline: false },
                        { name: '💰 New Gold Balance', value: `${freshUser.gold} Gold`, inline: false }
                    );

                await i.update({
                    embeds: [marketEmbed],
                    components: [] // Clears buttons to lock the finished state
                });

                collector.stop();
            }
        });

        // Safety: If the user leaves the game or goes AFK mid-journey
        collector.on('end', async (_, reason) => {
            if (reason !== 'user' && reason !== 'messageDelete') {
                const freshUser = await getEconomyData(userId);
                
                // Release player lock so they aren't stuck on "on_expedition" forever
                if (freshUser.status === 'on_expedition') {
                    freshUser.status = 'idle';
                    freshUser.expedition = null;
                    await setEconomyData(userId, freshUser);
                }

                // Disable UI buttons on the message
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
                    // Ignore errors if message was deleted
                }
            }
        });
    }
};
