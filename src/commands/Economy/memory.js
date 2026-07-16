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

const GAME_COOLDOWN = 30 * 1000; // 30 seconds between games
const GAME_TIMEOUT = 180000; // 3-minute hard limit for game completion

// Up to 10 pairs needed for the 4x5 Hard level grid
const EMOJI_POOL = ['🍎', '🦊', '🚀', '💎', '🍕', '🎸', '👾', '👑', '🐼', '🎈'];

const LEVELS = {
    easy: {
        name: 'Easy',
        rows: 3,
        cols: 4,
        pairs: 6,
        rewards: { fast: 150, mid: 100, slow: 50 },
        thresholds: { fast: 8, mid: 12 }
    },
    medium: {
        name: 'Medium',
        rows: 4,
        cols: 4,
        pairs: 8,
        rewards: { fast: 300, mid: 200, slow: 120 },
        thresholds: { fast: 12, mid: 16 }
    },
    hard: {
        name: 'Hard',
        rows: 4,
        cols: 5,
        pairs: 10,
        rewards: { fast: 500, mid: 350, slow: 200 },
        thresholds: { fast: 15, mid: 20 }
    }
};

export default {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Play a card matching memory game to win cash! (Free to play)')
        .addStringOption(option => 
            option.setName('difficulty')
                .setDescription('Select the grid size & difficulty level (defaults to Medium)')
                .setRequired(false)
                .addChoices(
                    { name: 'Easy (3x4 Grid - 6 Pairs)', value: 'easy' },
                    { name: 'Medium (4x4 Grid - 8 Pairs)', value: 'medium' },
                    { name: 'Hard (4x5 Grid - 10 Pairs)', value: 'hard' }
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const now = Date.now();

        // Determine level configuration
        const chosenDiff = interaction.options.getString('difficulty') || 'medium';
        const levelConfig = LEVELS[chosenDiff];

        logger.debug(`[ECONOMY] Memory game (${levelConfig.name}) started for ${userId}`, { userId, guildId });

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

        // 3. Set Cooldown immediately to protect write actions
        userData.lastMemoryGame = now;
        await setEconomyData(client, guildId, userId, userData);

        // 4. Initialize Shuffled Board based on difficulty level rules
        const activeEmojis = EMOJI_POOL.slice(0, levelConfig.pairs);
        const cards = [...activeEmojis, ...activeEmojis];
        
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        const totalButtonsCount = levelConfig.rows * levelConfig.cols;
        const revealed = Array(totalButtonsCount).fill(false); // Tracks successfully matched positions
        let firstSelectedIndex = null; 
        let moves = 0;
        let isProcessing = false; 

        // Generate native relative discord timestamp so client counts down live
        const expiryTimestamp = Math.floor((now + GAME_TIMEOUT) / 1000);

        // Helper: Build the custom layout dynamic grid + control row
        function buildGrid(disableAll = false, tempRevealIndex = null) {
            const rows = [];
            
            // Build card grid rows
            for (let r = 0; r < levelConfig.rows; r++) {
                const row = new ActionRowBuilder();
                for (let c = 0; c < levelConfig.cols; c++) {
                    const index = r * levelConfig.cols + c;
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

            // Append control row with the "Quit Game" option
            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('quit_game')
                    .setLabel('🏳️ Quit Game')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(disableAll || isProcessing) // Lock when matching fails are showcasing
            );
            rows.push(controlRow);

            return rows;
        }

        // Helper: Generate main interface embed
        function buildGameEmbed(statusMessage = "Find all matching pairs! Click any card to begin.") {
            const matchesLeft = revealed.filter(val => !val).length / 2;
            const rewards = levelConfig.rewards;
            const thresholds = levelConfig.thresholds;

            return infoEmbed(
                `🧠 Mind Match: Memory Pairs (${levelConfig.name})`,
                statusMessage
            )
            .addFields(
                { name: "📊 Game Stats", value: `Moves Made: **${moves}**\nPairs Left: **${matchesLeft}** / ${levelConfig.pairs}`, inline: true },
                { name: "⏳ Game Timer", value: `Expiring: <t:${expiryTimestamp}:R>`, inline: true },
                { name: "💰 Rewards Pool", value: `• Under ${thresholds.fast} moves: **$${rewards.fast}**\n• ${thresholds.fast}-${thresholds.mid} moves: **$${rewards.mid}**\n• ${thresholds.mid + 1}+ moves: **$${rewards.slow}**`, inline: false }
            )
            .setFooter({ text: "Incorrect pairs lock input for 1.5s so you can memorize them!" });
        }

        // Send initial game state
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

            // Handle immediate quit
            if (btnInteraction.customId === 'quit_game') {
                collector.stop('quit');
                return;
            }

            const clickedIndex = parseInt(btnInteraction.customId.split('_')[1]);

            // First card selection
            if (firstSelectedIndex === null) {
                firstSelectedIndex = clickedIndex;
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed(`You flipped a card! Now find its matching pair.`)],
                    components: buildGrid()
                });
                return;
            }

            // Second card selection
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

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [buildGameEmbed(`❌ **No match.** Memorize their positions before they flip back!`)],
                    components: buildGrid(true, clickedIndex)
                });

                // Hold state briefly to let the player memorize the board positions
                setTimeout(async () => {
                    firstSelectedIndex = null;
                    isProcessing = false;

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
                const elapsedSeconds = Math.floor((Date.now() - now) / 1000);
                const rewards = levelConfig.rewards;
                const thresholds = levelConfig.thresholds;

                let reward = rewards.slow;
                let rating = "Good Effort! ⭐";

                if (moves < thresholds.fast) {
                    reward = rewards.fast;
                    rating = "Grandmaster! 🏆🏆🏆";
                } else if (moves <= thresholds.mid) {
                    reward = rewards.mid;
                    rating = "Excellent Focus! 🌟";
                }

                // Load fresh DB entry
                const freshUserData = await getEconomyData(client, guildId, userId);
                if (freshUserData) {
                    freshUserData.wallet = (freshUserData.wallet || 0) + reward;
                    await setEconomyData(client, guildId, userId, freshUserData);
                }

                logger.info(`[ECONOMY_TRANSACTION] Memory game won on ${levelConfig.name}`, {
                    userId,
                    guildId,
                    moves,
                    elapsedSeconds,
                    reward,
                    newWallet: freshUserData ? freshUserData.wallet : 'Unknown'
                });

                const winEmbed = successEmbed(
                    `🧠 Match Grid Completed! (${levelConfig.name})`,
                    `Incredible! You cleared the board with great recall.`
                )
                .addFields(
                    { name: '🎖️ Rating', value: rating, inline: true },
                    { name: '🔄 Moves Taken', value: `**${moves} moves**`, inline: true },
                    { name: '⏱️ Time Elapsed', value: `**${elapsedSeconds} seconds**`, inline: true },
                    { name: '💰 Cash Reward', value: `**+$${reward.toLocaleString()}**`, inline: true },
                    { name: '💼 Wallet Balance', value: `$${freshUserData ? freshUserData.wallet.toLocaleString() : 'N/A'}`, inline: true }
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [winEmbed], components: disabledGrid });

            } else if (reason === 'quit') {
                logger.info(`[ECONOMY] Memory game forfeited early by user`, { userId, guildId });

                const quitEmbed = warningEmbed(
                    "🏳️ Game Forfeited",
                    `You chose to end the match early. Better luck next time!`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [quitEmbed], components: disabledGrid });

            } else {
                // Timeout / Aborted
                const timeoutEmbed = errorEmbed(
                    "⌛ Memory Game Ended",
                    `Your match session expired. You didn't complete the grid in time!`
                );

                await InteractionHelper.safeEditReply(interaction, { embeds: [timeoutEmbed], components: disabledGrid });
            }
        });
    }, { command: 'memory' })
};
