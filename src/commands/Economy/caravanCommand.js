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
        .setDescription('Manage your Silk Road trade caravans')
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Launch an interactive caravan expedition!')
        )
        .addSubcommand(sub =>
            sub
                .setName('rescue')
                .setDescription('Hire a Bedouin search party to rescue a stuck or lost caravan (Costs 100 Dirhams)')
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();

        // ---------------------------------------------------------
        // SUBCOMMAND: RESCUE
        // ---------------------------------------------------------
        if (subcommand === 'rescue') {
            const userData = await getEconomyData(client, guildId, userId);

            if (!userData.activeCaravan) {
                throw createError(
                    "No Caravan Lost",
                    ErrorTypes.GAME_RULE,
                    "You do not have any active expeditions lost in the desert right now!"
                );
            }

            const rescueCost = 100;
            if (userData.wallet < rescueCost) {
                throw createError(
                    "Insufficient Funds",
                    ErrorTypes.GAME_RULE,
                    `Hiring a search party costs **${rescueCost} Dirhams**. You only have **${userData.wallet.toLocaleString()} Dirhams**.`
                );
            }

            // Deduct cost and clear state
            userData.wallet -= rescueCost;
            userData.activeCaravan = null;
            await setEconomyData(client, guildId, userId, userData);

            const rescueEmbed = createEmbed({
                title: "🐪 Search Party Dispatched",
                description: `You pay **${rescueCost} Dirhams** to a local group of Bedouin scouts. \n\nThey ride deep into the dunes, locate your stranded merchants, and guide them safely back to Damascus. Your active caravan state has been cleared, and you are ready to set out again!`,
                color: '#2A9D8F'
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [rescueEmbed],
                components: []
            });
        }

        // ---------------------------------------------------------
        // SUBCOMMAND: START
        // ---------------------------------------------------------
        if (subcommand === 'start') {
            const userData = await getEconomyData(client, guildId, userId);
            const inventory = userData.inventory || {};
            const hasCamelArmor = inventory["camel_armor"] > 0;

            let lostCaravanNotice = ""; // Container for the sandstorm flavor text

            if (userData.activeCaravan) {
                const now = Date.now();
                if (userData.activeCaravan.expiresAt && now > userData.activeCaravan.expiresAt) {
                    // --- SELF-HEALING WITH FLAVOR ---
                    // Caravan timed out. Clear state and prepare the sandstorm story notification!
                    lostCaravanNotice = "🌪️ **Expedition Lost!**\n*It looks like your previous caravan got lost in a fierce sandstorm! Your merchants had to abandon their cargo in the dunes to survive, returning to the city empty-handed. But a new day dawns...*\n\n";
                    
                    userData.activeCaravan = null;
                    await setEconomyData(client, guildId, userId, userData);
                } else {
                    // --- LIVE COUNTDOWN TIMER ---
                    // Still active and fresh. Calculate the remaining time left on the clock.
                    const timeLeftMs = userData.activeCaravan.expiresAt - now;
                    const minutes = Math.floor(timeLeftMs / 60000);
                    const seconds = Math.floor((timeLeftMs % 60000) / 1000);
                    
                    const countdownString = minutes > 0 
                        ? `**${minutes}m ${seconds}s**` 
                        : `**${seconds}s**`;

                    throw createError(
                        "Expedition in Progress",
                        ErrorTypes.GAME_RULE,
                        `🐪 **Your caravan is already traveling out in the desert!**\n\nYour scouts estimate they will reach the oasis gates (or lose communication) in ${countdownString}.\n\nYou must complete your current journey, wait for them to return, or run \`/caravan rescue\` immediately.`
                    );
                }
            }

            const entryFee = 500;
            if (userData.wallet < entryFee) {
                throw createError(
                    "Insufficient Funds",
                    ErrorTypes.GAME_RULE,
                    `Preparing a caravan requires at least **${entryFee.toLocaleString()} Dirhams** for supplies. (Your wallet: ${userData.wallet.toLocaleString()} Dirhams)`
                );
            }

            // Initialize active caravan state with an expiration timestamp (5 minutes from now)
            userData.wallet -= entryFee;
            userData.activeCaravan = {
                step: 1, 
                cargoIntegrity: 100,
                goldSpent: entryFee,
                usedScenarios: [],
                currentScenario: null,
                expiresAt: Date.now() + 5 * 60 * 1000 // 5-minute self-heal limit
            };
            await setEconomyData(client, guildId, userId, userData);

            // Build Departure Screen (Incorporate the sandstorm notice if it happened)
            const embed = createEmbed({
                title: "🐫 Caravan Dispatch",
                description: `${lostCaravanNotice}*“We depart Damascus with 10 fine camels, loaded with spices and glass beads. The desert is unforgiving, but the fortune at the end of the road is legendary.”*\n\nYour cargo has been packed at **100% Integrity**. Let the journey begin.`,
                color: '#E0A96D'
            }).addFields(
                { name: '💰 Investment', value: `${entryFee} Dirhams`, inline: true },
                { name: '📦 Cargo Integrity', value: '100%', inline: true }
            );

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

                // Push expiration time forward with every active button press
                exp.expiresAt = Date.now() + 5 * 60 * 1000;

                if (i.customId === 'caravan_advance') {
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

                    // Apply Camel Armor reduction if applicable
                    let integrityDamage = chosenEffect.integrityChange;
                    if (hasCamelArmor && integrityDamage < 0) {
                        integrityDamage = Math.round(integrityDamage * 0.7); 
                    }

                    exp.cargoIntegrity = Math.max(0, exp.cargoIntegrity + integrityDamage);
                    exp.goldSpent -= chosenEffect.goldChange; 

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
                    const baseValue = 1800; 
                    const cargoValue = Math.floor(baseValue * (exp.cargoIntegrity / 100));
                    const totalInvested = exp.goldSpent;
                    const netProfit = cargoValue - totalInvested;

                    freshUser.wallet += cargoValue; 
                    freshUser.activeCaravan = null; // Clear active state successfully
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
                        components: [] 
                    });

                    collector.stop();
                }
            });

            // Handle Collector End
            collector.on('end', async (_, reason) => {
                if (reason !== 'user' && reason !== 'messageDelete') {
                    // Do not clear database lock here anymore.
                    // This allows Option 1 (self-healing timer) and Option 2 (rescue command) 
                    // to completely manage orphaned states!
                    try {
                        const disabledRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('disabled')
                                .setLabel('Caravan Expired')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        );
                        await interaction.editReply({ components: [disabledRow] });
                    } catch {
                        // Fail silently if message was deleted
                    }
                }
            });
        }
    }, { command: 'caravan' })
};
