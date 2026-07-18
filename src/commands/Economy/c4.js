import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Start a multiplayer Connect 4 lobby for up to 4 players!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const host = interaction.user;
        const guildId = interaction.guildId;
        const channel = interaction.channel;

        // Player configuration mapping
        const PLAYER_CONFIGS = [
            { emoji: ':red_circle:', name: 'Red' },
            { emoji: ':yellow_circle:', name: 'Yellow' },
            { emoji: ':blue_circle:', name: 'Blue' },
            { emoji: ':green_circle:', name: 'Green' }
        ];

        // Track active players in the lobby
        let players = [
            { id: host.id, username: host.username, user: host, emoji: PLAYER_CONFIGS[0].emoji }
        ];

        logger.info(`[GAMES] Multiplayer Connect 4 lobby created by ${host.id}`, { guildId });

        // 1. Phase 1: The Open Lobby Phase
        function getLobbyEmbed() {
            const playerList = players.map((p, index) => `${index + 1}. ${p.emoji} **${p.username}**`).join('\n');
            return infoEmbed(
                "🎮 Connect 4 Multiplayer Lobby",
                `**Host:** ${host.toString()}\n\n` +
                `### Current Players (${players.length}/4):\n${playerList}\n\n` +
                `👉 Other players, type **\`join\`** in chat to secure a spot!\n` +
                `👉 **${host.username}**, type **\`start\`** to launch the match early.`
            ).setFooter({ text: "Lobby closes automatically in 45 seconds if not started." });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [getLobbyEmbed()]
        });

        const lobbyCollector = channel.createMessageCollector({
            filter: m => !m.author.bot && ['join', 'start'].includes(m.content.toLowerCase().trim()),
            time: 45000
        });

        let gameStarted = false;

        lobbyCollector.on('collect', async (msg) => {
            const input = msg.content.toLowerCase().trim();

            // Handle joining players
            if (input === 'join') {
                if (players.some(p => p.id === msg.author.id)) {
                    return; // Player is already in the lobby
                }
                if (players.length >= 4) {
                    try { await msg.reply({ content: "Sorry, this game lobby is completely full!", ephemeral: true }); } catch (e) {}
                    return;
                }

                // Add player with next available color layout config
                players.push({
                    id: msg.author.id,
                    username: msg.author.username,
                    user: msg.author,
                    emoji: PLAYER_CONFIGS[players.length].emoji
                });

                try { await msg.delete(); } catch (e) {}
                
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [getLobbyEmbed()]
                });

                // Auto-start game if max capacity is filled
                if (players.length === 4) {
                    gameStarted = true;
                    lobbyCollector.stop('filled');
                }
            }

            // Handle host starting early
            if (input === 'start') {
                if (msg.author.id !== host.id) {
                    return; // Ignore start command if not sent by host
                }
                if (players.length < 2) {
                    try { 
                        const failMsg = await msg.reply("You need at least 2 players to start the game!");
                        setTimeout(() => failMsg.delete().catch(() => {}), 4000);
                    } catch (e) {}
                    return;
                }

                try { await msg.delete(); } catch (e) {}
                gameStarted = true;
                lobbyCollector.stop('host_start');
            }
        });

        lobbyCollector.on('end', async () => {
            if (!gameStarted) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [warningEmbed("Lobby Cancelled", "The Connect 4 game timed out or lacked enough players to start.")]
                });
                return;
            }

            // Move cleanly to Phase 2: Active Gameplay
            await runMultiplayerGame();
        });

        // 2. Phase 2: Active Game Loop Engine
        async function runMultiplayerGame() {
            const board = Array(6).fill(null).map(() => Array(7).fill(':white_circle:'));
            let turnIndex = 0;
            
            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            function getGameEmbed(statusOverlay = "") {
                const current = players[turnIndex];
                const alignmentMap = players.map(p => `${p.emoji} = ${p.username}`).join('  |  ');
                
                const turnNotice = statusOverlay || `Current Turn: ${current.user.toString()} ${current.emoji}\n👉 Type a column number (**1-7**) to drop your token!`;
                
                return infoEmbed(
                    `📊 Connect 4: Multiplayer Showdown`,
                    `${renderBoardString()}\n\n🔹 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n\n` +
                    `**Key:** ${alignmentMap}\n\n${turnNotice}`
                );
            }

            await InteractionHelper.safeEditReply(interaction, {
                content: `🎮 The match has officially started! Order: ${players.map(p => p.username).join(' ➔ ')}`,
                embeds: [getGameEmbed()]
            });

            // Listen only to active players entering digits 1-7
            const activePlayerIds = players.map(p => p.id);
            const gameCollector = channel.createMessageCollector({
                filter: m => activePlayerIds.includes(m.author.id) && /^[1-7]$/.test(m.content.trim()),
                time: 600000 // 10-minute maximum entire game lifecycle buffer
            });

            gameCollector.on('collect', async (msg) => {
                const currentPlayer = players[turnIndex];

                // Guard check: Ensure it is actually this user's turn
                if (msg.author.id !== currentPlayer.id) {
                    return; 
                }

                const colIndex = parseInt(msg.content.trim()) - 1;
                try { await msg.delete(); } catch (e) {}

                // Column saturation check
                if (board[0][colIndex] !== ':white_circle:') {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [getGameEmbed(`⚠️ **Column ${colIndex + 1} is full!** Try a different slot, ${currentPlayer.user.toString()}.`)]
                    });
                    return;
                }

                // Place the token in the lowest free index point
                for (let r = 5; r >= 0; r--) {
                    if (board[r][colIndex] === ':white_circle:') {
                        board[r][colIndex] = currentPlayer.emoji;
                        break;
                    }
                }

                // Win conditions validation
                if (checkWin(currentPlayer.emoji)) {
                    gameCollector.stop('win');
                    return;
                }

                // Draw conditions validation (board full)
                if (board[0].every(cell => cell !== ':white_circle:')) {
                    gameCollector.stop('draw');
                    return;
                }

                // Move turn index to the next player down the line
                turnIndex = (turnIndex + 1) % players.length;

                await InteractionHelper.safeEditReply(interaction, {
                    content: ' ',
                    embeds: [getGameEmbed()]
                });
            });

            gameCollector.on('end', async (_, endReason) => {
                const finalActivePlayer = players[turnIndex];

                if (endReason === 'win') {
                    const winEmbed = successEmbed(
                        "🏆 Connect 4 Victory!",
                        `${renderBoardString()}\n\n🎉 **${finalActivePlayer.username}** (${finalActivePlayer.emoji}) managed to line up 4 and won the match!`
                    );
                    await InteractionHelper.safeEditReply(interaction, { embeds: [winEmbed] });
                    logger.info(`[GAMES] Multiplayer Connect 4 won by ${finalActivePlayer.id}`, { guildId });
                } else if (endReason === 'draw') {
                    const drawEmbed = infoEmbed(
                        "🤝 Stagnant Grid!",
                        `${renderBoardString()}\n\nThe grid is completely packed out with tokens! The game ends in a multi-way tie.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { embeds: [drawEmbed] });
                } else {
                    const timeoutEmbed = warningEmbed(
                        "⌛ Match Disbanded",
                        `${renderBoardString()}\n\nThe session timed out due to total player inactivity.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { embeds: [timeoutEmbed] });
                }
            });
        }

        // 3. Matrix Verification Evaluation
        function checkWin(piece) {
            // Horizontal rows evaluation
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r][c+1] === piece && board[r][c+2] === piece && board[r][c+3] === piece) return true;
                }
            }
            // Vertical columns evaluation
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 7; c++) {
                    if (board[r][c] === piece && board[r+1][c] === piece && board[r+2][c] === piece && board[r+3][c] === piece) return true;
                }
            }
            // Positive diagonal evaluation
            for (let r = 3; r < 6; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r-1][c+1] === piece && board[r-2][c+2] === piece && board[r-3][c+3] === piece) return true;
                }
            }
            // Negative diagonal evaluation
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r+1][c+1] === piece && board[r+2][c+2] === piece && board[r+3][c+3] === piece) return true;
                }
            }
            return false;
        }

    }, { command: 'connect4' })
};
