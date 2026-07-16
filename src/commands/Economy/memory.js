import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ENTRY_FEE = 100;
const GAME_COOLDOWN = 30 * 1000; // 30 seconds between games
const GAME_TIMEOUT = 180000; // 3-minute game limit

// Emojis used for the matching pairs
const EMOJI_POOL = ['🍎', '🦊', '🚀', '💎', '🍕', '🎸', '👾', '👑'];

export default {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Play a 4x4 card matching memory game to win cash!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        logger.debug(`[ECONOMY] Memory game request started for ${userId}`, { userId, guildId });

        // 1. Fetch User Profile
        const userData = await getEconomyData(client, guildId, userId);
        if (!userData) {
            throw createError(
                "Failed to load economy data for memory game",
                ErrorTypes.DATABASE,
                "Failed to load your economy data. Please try again later.",
                { userId, guildId }
            );
        }

        // 2. Cooldown Verification
        const lastMemoryGame = userData.lastMemoryGame || 0;
        if (now < lastMemoryGame + GAME_COOLDOWN) {
            const timeRemaining = lastMemoryGame + GAME_COOLDOWN - now;
            throw createError(
                "Memory game cooldown active",
                ErrorTypes.RATE_LIMIT,
                `Your brain needs a rest! Please wait **${formatDuration(timeRemaining)}** before playing again.`,
                { timeRemaining, cooldownType: 'memory' }
            );
        }

        // 3. Balance Check
        const currentBalance = userData.wallet || 0;
        if (currentBalance < ENTRY_FEE) {
            throw createError(
                "Insufficient funds for memory game",
                ErrorTypes.VALIDATION,
                `It costs **$${ENTRY_FEE}** to play Memory. You currently have **$${currentBalance.toLocaleString()}**.`,
                { userId, guildId, balance: currentBalance }
            );
        }

        // 4. Deduct Entry Fee & Set Cooldown
        userData.wallet = currentBalance - ENTRY_FEE;
        userData.lastMemoryGame = now;
        await setEconomyData(client, guildId, userId, userData);

        logger.info(`[ECONOMY_TRANSACTION] Memory entry fee deducted`, {
            userId,
            guildId,
            amount: -ENTRY_FEE,
            newWallet: userData.wallet,
            timestamp: new Date().toISOString()
        });

        // 5. Initialize Shuffled Board (8 pairs = 16 cards)
        const cards = [...EMOJI_POOL, ...EMOJI_POOL];
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        const revealed = Array(16).fill(false); // Keeps track of matched pairs
        let firstSelectedIndex = null; // Index of the first card flipped in a turn
        let moves = 0;
        let isProcessing = false; // Blocks input while showing mismatched pairs

        // Helper: Build the 4x4 grid representation using Action Rows
        function buildGrid(disableAll = false, tempRevealIndex = null) {
            const rows = [];
            for (let r = 0; r < 4; r++) {
                const row = new ActionRowBuilder();
                for (let c = 0; c < 4; c++) {
                    const index = r * 4 + c;
                    const isMatched = revealed[index];
                    const isSelected = index === firstSelectedIndex;
                    const isTempFlipped = index === tempRevealIndex;

                    const button = new ButtonBuilder()
                        .setCustomId(`mem_${index}`);

                    if (isMatched) {
                        button.setLabel(cards[index]);
                        button.setStyle(ButtonStyle.Success);
                        button.setDisabled(true);
                    } else if (isSelected || isTempFlipped) {
                        button.setLabel(cards[index]);
                        button.setStyle(ButtonStyle.Primary);
                        button.setDisabled(true);
                    } else {
                        button.setLabel('❓');
                        button.setStyle(ButtonStyle.Secondary);
                        button.setDisabled(disableAll || isProcessing);
                    }
                    row.addComponents(button);
                }
                rows.push(row);
            }
            return rows;
        }

        // Helper: Generate main interface embed
        function buildGameEmbed(statusMessage = "Find all matching pairs! Click any card to begin.") {
            const matchesLeft = revealed.filter(val => !val).length / 2;
            return infoEmbed(
                "🧠 Mind Match: Memory Pairs",
                statusMessage
            )
            .addFields(
                { name: "📊 Game Stats", value: `Moves Made: **${moves}**\nPairs Left: **${matchesLeft}** / 8`, inline: true },
                { name: "💰 Prize Pool", value: `• Under 12 moves: **$300**\n• 12-16 moves: **$200**\n• 17+ moves: **$120**`, inline: true }
            )
            .setFooter({ text: "Incorrect pairs lock input for 1.5s so you can memorize them!" });
        }

        // Send the initial clean game state
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [buildGameEmbed()],
            components: buildGrid()
        });

        // Create the active button collector
        const response = await interaction.fetchReply();
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: GAME_TIMEOUT
        });

        collector.on('collect', async (btnInteraction) => {
            if (btnInteraction.user.id !== userId) {
                return btnInteraction.reply({ 
                    content: "This is not your match! Run `/memory` to start a new game.", 
                    ephemeral: true 
                });
            }

            if (isProcessing) {
                return btnInteraction.deferUpdate();
            }

            await btnInteraction.deferUpdate();
            const clickedIndex = parseInt(btnInteraction.customId.split('_')[1]);

            // First card choice in a matching round
            if (firstSelectedIndex === null) {
                firstSelectedIndex = clickedIndex;
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed(`You flipped a card! Now find its matching pair.`)],
                    components: buildGrid()
                });
                return;
            }

            // Second card choice
            const cardOne = cards[firstSelectedIndex];
            const cardTwo = cards[clickedIndex];
            moves++;

            if (cardOne === cardTwo) {
                // SUCCESS MATCH
                revealed[firstSelectedIndex] = true;
                revealed[clickedIndex] = true;
                firstSelectedIndex = null;

                const isGameOver = revealed.every(card => card === true);
                if (isGameOver) {
                    collector.stop('won');
                    return;
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed(`✨ **Match found!** You paired up the ${cardOne}!`)],
                    components: buildGrid()
                });
            } else {
                // MISMATCH
                isProcessing = true;

                // Temporarily show both flipped cards so the user can look and memorize
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed(`❌ **No match.** Memorize their positions before they flip back!`)],
                    components: buildGrid(true, clickedIndex)
                });

                // Hold screen state for 1.5 seconds, then flip cards back face down
                setTimeout(async () => {
                    firstSelectedIndex = null;
                    isProcessing = false;

                    // Ensure the interaction wasn't deleted during the sleep interval
                    try {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [buildGameEmbed("Keep hunting! Try to remember where the shapes are located.")],
                            components: buildGrid()
                        });
                    } catch (err) {
                        logger.error("[ECONOMY] Failed to edit reply after memory sleep mismatch", err);
                    }
                }, 1500);
            }
        });

        collector.on('end', async (collected, reason) => {
            const disabledGrid = buildGrid(true);

            if (reason === 'won') {
                let reward = 120;
                let rating = "Good Effort! ⭐";

                if (moves < 12) {
                    reward = 300;
                    rating = "Grandmaster! 🏆🏆🏆";
                } else if (moves <= 16) {
                    reward = 200;
                    rating = "Excellent Focus! 🌟";
                }

                const netProfit = reward - ENTRY_FEE;

                // Load database transaction freshly to protect data scaling
                const freshUserData = await getEconomyData(client, guildId, userId);
                if (freshUserData) {
                    freshUserData.wallet = (freshUserData.wallet || 0) + reward;
                    await setEconomyData(client, guildId, userId, freshUserData);
                }

                logger.info(`[ECONOMY_TRANSACTION] Memory game won`, {
                    userId,
                    guildId,
                    moves,
                    reward,
                    netProfit,
                    newWallet: freshUserData ? freshUserData.wallet : 'Unknown'
                });

                const winEmbed = successEmbed(
                    "🧠 Match Grid Completed!",
                    `Incredible! You cleared the board with perfect recall.`
                )
                .addFields(
                    { name: '🎖️ Rating', value: rating, inline: true },
                    { name: '🔄 Moves Taken', value: `**${moves} total moves**`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true }, // Empty field separator
                    { name: '💰 Total Earnings', value: `**$${reward.toLocaleString()}**`, inline: true },
                    { name: '📈 Net Yield', value: `+$${netProfit.toLocaleString()}`, inline: true },
                    { name: '💼 Wallet Balance', value: `$${freshUserData ? freshUserData.wallet.toLocaleString() : 'N/A'}`, inline: true }
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [winEmbed], components: disabledGrid });

            } else {
                // Timeout / Aborted Game state
                const timeoutEmbed = errorEmbed(
                    "⌛ Memory Game Aborted",
                    `The game took too long to complete or was interrupted. Your **$${ENTRY_FEE}** entry fee was consumed by the dealer.`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [timeoutEmbed], components: disabledGrid });
            }
        });
    }, { command: 'memory' })
};
