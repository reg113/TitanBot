import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Start an interactive multiplayer Connect 4 game!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const host = interaction.user;
        const guildId = interaction.guildId;
        const channel = interaction.channel;

        // Color configurations for up to 4 players
        const PLAYER_CONFIGS = [
            { emoji: ':red_circle:', name: 'Red' },
            { emoji: ':yellow_circle:', name: 'Yellow' },
            { emoji: ':blue_circle:', name: 'Blue' },
            { emoji: ':green_circle:', name: 'Green' }
        ];

        // Track active players (Host is locked in as Player 1)
        let players = [
            { id: host.id, username: host.username, user: host, emoji: PLAYER_CONFIGS[0].emoji }
        ];

        logger.info(`[GAMES] Connect 4 reaction-lobby initiated by ${host.id}`, { guildId });

        // --- PHASE 1: REACTION LOBBY ---
        function getLobbyEmbed() {
            const playerList = players.map((p, index) => `${index + 1}. ${p.emoji} **${p.username}**`).join('\n');
            return infoEmbed(
                "🎮 Connect 4 Multiplayer Lobby",
                `**Host:** ${host.toString()}\n\n` +
                `### Current Players (${players.length}/4):\n${playerList}\n\n` +
                `👉 React with 🎮 to **Join** or **Leave** the lobby!\n` +
                `👉 **${host.username}**, type **\`start\`** in chat to launch the match.`
            ).setFooter({ text: "Lobby expires in 60 seconds." });
        }

        // Send the lobby invitation frame
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [getLobbyEmbed()]
        });

        const replyMessage = await interaction.fetchReply();
        await replyMessage.react('🎮');

        // Listen for additions and removals of the lobby reaction
        const reactionCollector = replyMessage.createReactionCollector({
            filter: (reaction, user) => reaction.emoji.name === '🎮' && !user.bot,
            time: 60000,
            dispose: true // Required to fire the 'remove' event
        });

        const textCollector = channel.createMessageCollector({
            filter: m => m.author.id === host.id && m.content.toLowerCase().trim() === 'start',
            time: 60000
        });

        let gameStarted = false;

        reactionCollector.on('collect', async (reaction, user) => {
            if (user.id === host.id) return; // Host is automatically in
            if (players.some(p => p.id === user.id)) return;

            if (players.length >= 4) {
                // Remove extra reactions if lobby is full
                try { await reaction.users.remove(user.id); } catch (e) {}
                return;
            }

            players.push({
                id: user.id,
                username: user.username,
                user: user,
                emoji: PLAYER_CONFIGS[players.length].emoji
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [getLobbyEmbed()] });
        });

        reactionCollector.on('remove', async (reaction, user) => {
            if (user.id === host.id) return;
            
            const index = players.findIndex(p => p.id === user.id);
            if (index !== -1) {
                players.splice(index, 1);
                
                // Re-sync player color emojis based on new order positions
                players.forEach((p, idx) => {
                    p.emoji = PLAYER_CONFIGS[idx].emoji;
                });

                await InteractionHelper.safeEditReply(interaction, { embeds: [getLobbyEmbed()] });
            }
        });

        textCollector.on('collect', async (msg) => {
            if (players.length < 2) {
                const warn = await msg.reply("You need at least 2 players to start!");
                setTimeout(() => { warn.delete().catch(() => {}); msg.delete().catch(() => {}); }, 4000);
                return;
            }
            try { await msg.delete(); } catch (e) {}
            gameStarted = true;
            reactionCollector.stop();
            textCollector.stop();
        });

        textCollector.on('end', async () => {
            if (!gameStarted) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [warningEmbed("Lobby Closed", "The game timed out or lacked enough players to start.")]
                });
                return;
            }

            // Remove the layout invitation embed and transition completely to live message updates
            await interaction.deleteReply().catch(() => {});
            await runActiveGame();
        });

        // --- PHASE 2: ACTIVE GAME ENGINE ---
        async function runActiveGame() {
            const board = Array(6).fill(null).map(() => Array(7).fill(':white_circle:'));
            let turnIndex = 0;
            let lastGameMessage = null;

            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            function getGameEmbed(statusOverlay = "") {
                const current = players[turnIndex];
                const alignmentMap = players.map(p => `${p.emoji} = ${p.username}`).join('  |  ');
                const turnNotice = statusOverlay || `Current Turn: ${current.user.toString()} ${current.emoji}\n👉 Type a column (**1-7**) to drop, or type **\`leave\`** to forfeit.`;

                return infoEmbed(
                    `📊 Connect 4: Tactical Arena`,
                    `${renderBoardString()}\n\n🔹 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n\n**Key:** ${alignmentMap}\n\n${turnNotice}`
                );
            }

            // Centralized rendering utility to prevent text flood
            async function refreshGameBoard(statusText = "") {
                if (lastGameMessage) {
                    try { await lastGameMessage.delete(); } catch (e) {}
                }
                lastGameMessage = await channel.send({
                    embeds: [getGameEmbed(statusText)]
                });
            }

            // Initial frame deploy
            await refreshGameBoard();

            const gameCollector = channel.createMessageCollector({
                filter: m => {
                    const activeIds = players.map(p => p.id);
                    const validationRegex = /^[1-7]$/;
                    const isLeaveCommand = m.content.toLowerCase().trim() === 'leave';
                    return activeIds.includes(m.author.id) && (validationRegex.test(m.content.trim()) || isLeaveCommand);
                },
                time: 600000 // 10 minute total matching threshold
            });

            gameCollector.on('collect', async (msg) => {
                const input = msg.content.toLowerCase().trim();
                const currentPlayer = players[turnIndex];

                // 1. Handle Mid-game Forfeiting
                if (input === 'leave') {
                    try { await msg.delete(); } catch (e) {}
                    
                    const leavingPlayer = players.find(p => p.id === msg.author.id);
                    const leavingIndex = players.findIndex(p => p.id === msg.author.id);
                    
                    players.splice(leavingIndex, 1);
                    await channel.send(`👋 **${leavingPlayer.username}** has left the match.`);

                    // Terminate match if remaining players drop below minimum threshold
                    if (players.length < 2) {
                        gameCollector.stop('forfeit_victory');
                        return;
                    }

                    // Adjust index positions so turns don't break/skip
                    if (turnIndex >= players.length) {
                        turnIndex = 0;
                    }

                    await refreshGameBoard();
                    return;
                }

                // 2. Standard Column Action Turn Guard
                if (msg.author.id !== currentPlayer.id) return;

                const colIndex = parseInt(msg.content.trim()) - 1;
                try { await msg.delete(); } catch (e) {}

                // Column saturation check
                if (board[0][colIndex] !== ':white_circle:') {
                    await refreshGameBoard(`⚠️ **Column ${colIndex + 1} is full!** Choose another column, ${currentPlayer.user.toString()}.`);
                    return;
                }

                // Gravitational drop deployment logic
                for (let r = 5; r >= 0; r--) {
                    if (board[r][colIndex] === ':white_circle:') {
                        board[r][colIndex] = currentPlayer.emoji;
                        break;
                    }
                }

                // Validate endgame checks
                if (checkWin(currentPlayer.emoji)) {
                    gameCollector.stop('win');
                    return;
                }

                if (board[0].every(cell => cell !== ':white_circle:')) {
                    gameCollector.stop('draw');
                    return;
                }

                // Cycle turn wheel array pointers
                turnIndex = (turnIndex + 1) % players.length;
                await refreshGameBoard();
            });

            gameCollector.on('end', async (_, endReason) => {
                // Delete the last interactive tracking frame to leave a clean permanent result frame
                if (lastGameMessage) {
                    try { await lastGameMessage.delete(); } catch (e) {}
                }

                if (endReason === 'win') {
                    const winner = players[turnIndex];
                    await channel.send({
                        embeds: [successEmbed("🏆 Match Decided!", `${renderBoardString()}\n\n🎉 **${winner.username}** (${winner.emoji}) successfully aligned 4 and won the match!`)]
                    });
                } else if (endReason === 'forfeit_victory') {
                    const survivor = players[0];
                    await channel.send({
                        embeds: [successEmbed("🏆 Victory by Forfeit", `${renderBoardString()}\n\n🎉 Everyone else left the arena! **${survivor.username}** (${survivor.emoji}) is the last player standing!`)]
                    });
                } else if (endReason === 'draw') {
                    await channel.send({
                        embeds: [infoEmbed("🤝 Game Over", `${renderBoardString()}\n\nThe grid is completely jammed up. The match ends in a draw!`)]
                    });
                } else {
                    await channel.send({
                        embeds: [warningEmbed("⌛ Session Expired", `${renderBoardString()}\n\nThe match was terminated automatically due to excessive inactivity.`)]
                    });
                }
            });
        }

        // --- PHASE 3: GRID EVALUATION ALGORITHM ---
        function checkWin(piece) {
            for (let r = 0; r < 6; r++) { // Horizontal
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r][c+1] === piece && board[r][c+2] === piece && board[r][c+3] === piece) return true;
                }
            }
            for (let r = 0; r < 3; r++) { // Vertical
                for (let c = 0; c < 7; c++) {
                    if (board[r][c] === piece && board[r+1][c] === piece && board[r+2][c] === piece && board[r+3][c] === piece) return true;
                }
            }
            for (let r = 3; r < 6; r++) { // Positive Diagonal
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r-1][c+1] === piece && board[r-2][c+2] === piece && board[r-3][c+3] === piece) return true;
                }
            }
            for (let r = 0; r < 3; r++) { // Negative Diagonal
                for (let c = 0; c < 4; c++) {
                    if (board[r][c] === piece && board[r+1][c+1] === piece && board[r+2][c+2] === piece && board[r+3][c+3] === piece) return true;
                }
            }
            return false;
        }

    }, { command: 'connect4' })
};
