import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Challenge another member to a game of Connect 4 using text inputs!')
        .addUserOption(option =>
            option.setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const challenger = interaction.user;
        const opponent = interaction.options.getUser('opponent');
        const guildId = interaction.guildId;

        // 1. Core Validations
        if (opponent.id === challenger.id) {
            throw createError(
                "Self challenge restriction",
                ErrorTypes.VALIDATION,
                "You cannot play Connect 4 against yourself! Tag a friend instead.",
                { userId: challenger.id }
            );
        }

        if (opponent.bot) {
            throw createError(
                "Bot challenge restriction",
                ErrorTypes.VALIDATION,
                "Bots cannot play Connect 4. Challenge a human!",
                { userId: challenger.id, targetBotId: opponent.id }
            );
        }

        logger.info(`[GAMES] Connect 4 text-challenge issued by ${challenger.id} to ${opponent.id}`, { guildId });

        // 2. Invitation Phase via Text Reactions / Text Confirmation
        const inviteEmbed = infoEmbed(
            "🔴 Connect 4 Challenge! 🟡",
            `**${challenger.username}** has challenged **${opponent.toString()}** to a match of Connect 4!\n\n👉 **${opponent.username}**, type **\`accept\`** in chat to play, or **\`decline\`** to refuse.`
        ).setFooter({ text: "Invitation expires in 60 seconds." });

        await InteractionHelper.safeEditReply(interaction, {
            content: opponent.toString(),
            embeds: [inviteEmbed],
            components: [] // Explicitly stripped of buttons
        });

        // Set up a collector in the channel to watch for the invite response
        const channel = interaction.channel;
        const inviteCollector = channel.createMessageCollector({
            filter: m => m.author.id === opponent.id && ['accept', 'decline'].includes(m.content.toLowerCase()),
            time: 60000,
            max: 1
        });

        let gameActive = false;
        const board = Array(6).fill(null).map(() => Array(7).fill('⚪'));
        const P1_EMOJI = '🔴';
        const P2_EMOJI = '🟡';
        let currentTurn = challenger;

        inviteCollector.on('collect', async (msg) => {
            if (msg.content.toLowerCase() === 'accept') {
                gameActive = true;
                try { await msg.delete(); } catch (e) { /* Ignore if missing permissions */ }
            }
        });

        inviteCollector.on('end', async (collected) => {
            const firstMsg = collected.first();
            
            if (!gameActive || (firstMsg && firstMsg.content.toLowerCase() === 'decline')) {
                await InteractionHelper.safeEditReply(interaction, {
                    content: ' ',
                    embeds: [warningEmbed("Challenge Declined", `${opponent.username} decided not to play this time.`)],
                    components: []
                });
                return;
            }

            // Run the active game loop if accepted
            await runGameLoop();
        });

        // 3. Active Gameplay Loop via Text Inputs
        async function runGameLoop() {
            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            function getGameEmbed(extraText = "") {
                const turnStatus = `Current Turn: ${currentTurn.toString()} ${currentTurn.id === challenger.id ? P1_EMOJI : P2_EMOJI}\n👉 Type a column number (**1-7**) to drop your piece!`;
                return infoEmbed(
                    `📊 Connect 4: ${challenger.username} vs ${opponent.username}`,
                    `${renderBoardString()}\n\n🔹 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n\n${extraText || turnStatus}`
                );
            }

            // Send initial board
            await InteractionHelper.safeEditReply(interaction, {
                content: `🎮 Match Started!`,
                embeds: [getGameEmbed()]
            });

            // Collect messages that are numbers 1-7 from either active player
            const gameCollector = channel.createMessageCollector({
                filter: m => [challenger.id, opponent.id].includes(m.author.id) && /^[1-7]$/.test(m.content.trim()),
                time: 300000 // 5-minute hard limit total match time
            });

            gameCollector.on('collect', async (msg) => {
                // Ensure it's the correct user's turn
                if (msg.author.id !== currentTurn.id) {
                    return; // Ignore inputs out of turn silently, or you can send a brief warning
                }

                const colIndex = parseInt(msg.content.trim()) - 1;
                const currentEmoji = currentTurn.id === challenger.id ? P1_EMOJI : P2_EMOJI;

                // Attempt to clean up the player's text entry to keep chat neat
                try { await msg.delete(); } catch (e) {}

                // Check if column is full
                if (board[0][colIndex] !== '⚪') {
                    // Re-render with a quick warning embedded
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [getGameEmbed(`⚠️ **Column ${colIndex + 1} is full!** Choose another column, ${currentTurn.toString()}.`)]
                    });
                    return;
                }

                // Drop piece into the lowest open row index
                for (let r = 5; r >= 0; r--) {
                    if (board[r][colIndex] === '⚪') {
                        board[r][colIndex] = currentEmoji;
                        break;
                    }
                }

                // Check for wins
                if (checkWin(currentEmoji)) {
                    gameCollector.stop('win');
                    return;
                }

                // Check for a tie match
                if (board[0].every(cell => cell !== '⚪')) {
                    gameCollector.stop('draw');
                    return;
                }

                // Flip turn state
                currentTurn = currentTurn.id === challenger.id ? opponent : challenger;

                // Update viewport message
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [getGameEmbed()]
                });
            });

            gameCollector.on('end', async (_, endReason) => {
                if (endReason === 'win') {
                    const winEmbed = successEmbed(
                        "🏆 Connect 4 Victory!",
                        `${renderBoardString()}\n\n🎉 **${currentTurn.username}** aligned 4 pieces and won the match!`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [winEmbed] });
                    logger.info(`[GAMES] Connect 4 text-match finished. Winner: ${currentTurn.id}`, { guildId });
                } else if (endReason === 'draw') {
                    const drawEmbed = infoEmbed(
                        "🤝 Stalemate!",
                        `${renderBoardString()}\n\nThe board is full! The game ends in a tie.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [drawEmbed] });
                } else {
                    const timeoutEmbed = warningEmbed(
                        "⌛ Match Abandoned",
                        `${renderBoardString()}\n\nThe game timed out because players stopped typing columns.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [timeoutEmbed] });
                }
            });
        }

        // 4. Matrix Evaluation (Win Scan Algorithm)
        function checkWin(piece) {
            // Horizontal checking
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r][c+1] === piece && board[r][c+2] === piece && board[r][c+3] === piece) return true;
                }
            }
            // Vertical checking
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 7; c++) {
                    if (board[r][c] === piece && board[r+1][c] === piece && board[r+2][c] === piece && board[r+3][c] === piece) return true;
                }
            }
            // Positive diagonal checking (bottom-left to top-right)
            for (let r = 3; r < 6; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r-1][c+1] === piece && board[r-2][c+2] === piece && board[r-3][c+3] === piece) return true;
                }
            }
            // Negative diagonal checking (top-left to bottom-right)
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r+1][c+1] === piece && board[r+2][c+2] === piece && board[r+3][c+3] === piece) return true;
                }
            }
            return false;
        }

    }, { command: 'connect4' })
};
