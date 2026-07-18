import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Start an interactive multiplayer Connect 4 match!')
        .addIntegerOption(option => 
            option.setName('rows')
                .setDescription('Number of vertical spaces (Default: 6, Min: 4, Max: 10)')
                .setMinValue(4)
                .setMaxValue(10)
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('columns')
                .setDescription('Number of horizontal spaces (Default: 7, Min: 4, Max: 10)')
                .setMinValue(4)
                .setMaxValue(10)
                .setRequired(false))
        .addIntegerOption(option => 
            option.setName('timer')
                .setDescription('Time limit per turn in seconds (Default: 45s)')
                .setMinValue(10)
                .setMaxValue(300)
                .setRequired(false)),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const host = interaction.user;
        const guildId = interaction.guildId;

        // Fetch custom options or apply defaults
        const rows = interaction.options.getInteger('rows') || 6;
        const columns = interaction.options.getInteger('columns') || 7;
        const turnTimer = interaction.options.getInteger('timer') || 45;

        const PLAYER_CONFIGS = [
            { emoji: ':red_circle:', name: 'Red' },
            { emoji: ':yellow_circle:', name: 'Yellow' },
            { emoji: ':blue_circle:', name: 'Blue' },
            { emoji: ':green_circle:', name: 'Green' }
        ];

        // Global native number emojis array to match grid aesthetics
        const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        let players = [
            { id: host.id, username: host.username, user: host, emoji: PLAYER_CONFIGS[0].emoji }
        ];

        logger.info(`[GAMES] Connect 4 interactive lobby initiated by ${host.id} [${rows}x${columns}]`, { guildId });

        // --- PHASE 1: LOBBY MANAGING ---
        function getLobbyEmbed() {
            const playerList = players.map((p, index) => `${index + 1}. ${p.emoji} **${p.username}**`).join('\n');
            return infoEmbed(
                "🎮 Connect 4 Multiplayer Lobby",
                `**Settings:** Grid Size: \`${rows}x${columns}\` | Turn Timer: \`${turnTimer}s\`\n` +
                `**Host:** ${host.toString()}\n\n` +
                `### Current Players (${players.length}/4):\n${playerList}\n\n` +
                `👉 Click the buttons below to join or manage the match.`
            ).setFooter({ text: "Lobby expires after 60 seconds of inactivity." });
        }

        function getLobbyControls() {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('c4_lobby_join').setLabel('Join').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('c4_lobby_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('c4_lobby_start').setLabel('Start Game').setStyle(ButtonStyle.Success)
            );
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [getLobbyEmbed()],
            components: [getLobbyControls()]
        });

        const lobbyResponse = await interaction.fetchReply();
        const lobbyCollector = lobbyResponse.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000
        });

        let gameStarted = false;

        lobbyCollector.on('collect', async (btnCtx) => {
            try {
                const customId = btnCtx.customId;

                if (customId === 'c4_lobby_join') {
                    if (players.some(p => p.id === btnCtx.user.id)) {
                        return btnCtx.reply({ content: "🧠 You are already in the lobby!", ephemeral: true });
                    }
                    if (players.length >= 4) {
                        return btnCtx.reply({ content: "❌ This lobby is full! Max 4 players.", ephemeral: true });
                    }

                    players.push({
                        id: btnCtx.user.id,
                        username: btnCtx.user.username,
                        user: btnCtx.user,
                        emoji: PLAYER_CONFIGS[players.length].emoji
                    });

                    await btnCtx.deferUpdate();
                    await btnCtx.editReply({ embeds: [getLobbyEmbed()] });
                }

                if (customId === 'c4_lobby_leave') {
                    if (btnCtx.user.id === host.id) {
                        return btnCtx.reply({ content: "👑 You are the host! Dismiss the interaction if you want to close the lobby completely.", ephemeral: true });
                    }
                    
                    const index = players.findIndex(p => p.id === btnCtx.user.id);
                    if (index === -1) {
                        return btnCtx.reply({ content: "You aren't in this lobby!", ephemeral: true });
                    }

                    players.splice(index, 1);
                    players.forEach((p, idx) => p.emoji = PLAYER_CONFIGS[idx].emoji);

                    await btnCtx.deferUpdate();
                    await btnCtx.editReply({ embeds: [getLobbyEmbed()] });
                }

                if (customId === 'c4_lobby_start') {
                    if (btnCtx.user.id !== host.id) {
                        return btnCtx.reply({ content: "🛡️ Only the host can start the match!", ephemeral: true });
                    }
                    if (players.length < 2) {
                        return btnCtx.reply({ content: "⚠️ You need at least 2 players to start a match!", ephemeral: true });
                    }

                    gameStarted = true;
                    await btnCtx.deferUpdate();
                    lobbyCollector.stop();
                }
            } catch (err) {
                logger.error("[GAMES] Error inside Connect 4 lobby collector processing layer", err);
            }
        });

        lobbyCollector.on('end', async () => {
            if (!gameStarted) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [warningEmbed("Lobby Closed", "The game session timed out or was abandoned.")],
                    components: []
                });
                return;
            }

            await runActiveGame();
        });

        // --- PHASE 2: ACTIVE GAMEPLAY ENGINE ---
        async function runActiveGame() {
            const board = Array(rows).fill(null).map(() => Array(columns).fill(':white_circle:'));
            let turnIndex = 0;
            let drawVotes = new Set();
            let statusOverlay = "";

            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            function getGameEmbed(extraInfo = "") {
                const current = players[turnIndex];
                const keyMap = players.map(p => `${p.emoji} = ${p.username}`).join('  |   ');
                
                // Formats native emoji indices dynamically cutting at configured layout boundary
                const columnIndicators = NUMBER_EMOJIS.slice(0, columns).join(' ');
                
                const mainPrompt = extraInfo || `👉 **Turn:** ${current.user.toString()} ${current.emoji}\n💡 **Type a column number (1-${columns})** directly in chat to make your move! You have **${turnTimer} seconds**.`;

                return infoEmbed(
                    `📊 Connect 4 Arena (\`${rows}x${columns}\`)`,
                    `${renderBoardString()}\n\n🔹 ${columnIndicators}\n\n**Key:** ${keyMap}\n\n${mainPrompt}`
                );
            }

            // Clean up lobby message context
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [infoEmbed("🎮 Connect 4 Match", "The match has officially begun! Check the active board below.")],
                components: []
            });

            // Master loop that handles game iterations sequentially
            while (players.length >= 2) {
                const currentPlayer = players[turnIndex];
                
                const drawLabel = `🤝 Vote Draw (${drawVotes.size}/${players.length})`;
                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('c4_btn_draw').setLabel(drawLabel).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('c4_btn_leave').setLabel('🏳️ Forfeit').setStyle(ButtonStyle.Danger)
                );

                const activeMessage = await interaction.channel.send({
                    embeds: [getGameEmbed(statusOverlay)],
                    components: [actionRow]
                });

                let nextAction = null; 

                const compCollector = activeMessage.createMessageComponentCollector({
                    time: turnTimer * 1000
                });

                const msgCollector = interaction.channel.createMessageCollector({
                    filter: (m) => !m.author.bot && players.some(p => p.id === m.author.id),
                    time: turnTimer * 1000
                });

                await new Promise((resolve) => {
                    // 1. Listen for utility context buttons (Forfeit/Draw)
                    compCollector.on('collect', async (i) => {
                        if (!players.some(p => p.id === i.user.id)) {
                            return i.reply({ content: "❌ You are not an active player in this match!", ephemeral: true });
                        }

                        if (i.customId === 'c4_btn_leave') {
                            await i.deferUpdate();
                            nextAction = { type: 'leave', userId: i.user.id };
                            resolve();
                        } else if (i.customId === 'c4_btn_draw') {
                            await i.deferUpdate();
                            drawVotes.add(i.user.id);

                            if (drawVotes.size === players.length) {
                                nextAction = { type: 'draw_agree' };
                                resolve();
                            } else {
                                const updatedDrawLabel = `🤝 Vote Draw (${drawVotes.size}/${players.length})`;
                                const updatedRow = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId('c4_btn_draw').setLabel(updatedDrawLabel).setStyle(ButtonStyle.Secondary),
                                    new ButtonBuilder().setCustomId('c4_btn_leave').setLabel('🏳️ Forfeit').setStyle(ButtonStyle.Danger)
                                );
                                await activeMessage.edit({ components: [updatedRow] }).catch(() => {});
                            }
                        }
                    });

                    // 2. Listen for text typed column numbers
                    msgCollector.on('collect', async (m) => {
                        if (m.author.id !== currentPlayer.id) return; 

                        const contentClean = m.content.trim();
                        if (!/^\d+$/.test(contentClean)) return; 

                        const colIdx = parseInt(contentClean) - 1;
                        
                        if (colIdx < 0 || colIdx >= columns) {
                            m.delete().catch(() => {});
                            return;
                        }

                        if (board[0][colIdx] !== ':white_circle:') {
                            m.delete().catch(() => {});
                            return; 
                        }

                        nextAction = { type: 'move', columnIndex: colIdx };
                        m.delete().catch(() => {});
                        resolve();
                    });

                    // 3. Handle Round Expiration
                    msgCollector.on('end', (collected, reason) => {
                        if (reason === 'time' && !nextAction) {
                            nextAction = { type: 'timeout', userId: currentPlayer.id };
                            resolve();
                        }
                    });
                });

                compCollector.stop();
                msgCollector.stop();
                await activeMessage.edit({ components: [] }).catch(() => {});

                // --- RESOLVE ACTIONS ---
                if (nextAction.type === 'move') {
                    const colIndex = nextAction.columnIndex;
                    for (let r = rows - 1; r >= 0; r--) {
                        if (board[r][colIndex] === ':white_circle:') {
                            board[r][colIndex] = currentPlayer.emoji;
                            break;
                        }
                    }

                    if (checkWin(board, currentPlayer.emoji, rows, columns)) {
                        await interaction.channel.send({
                            embeds: [successEmbed("🏆 Match Decided!", `${renderBoardString()}\n\n🎉 Congratulations **${currentPlayer.username}** (${currentPlayer.emoji}), you aligned 4 and claimed victory!`)],
                        });
                        return;
                    }

                    if (board[0].every(cell => cell !== ':white_circle:')) {
                        await interaction.channel.send({
                            embeds: [infoEmbed("🤝 Game Over", `${renderBoardString()}\n\nThe grid is completely packed out. The match ends in a draw!`)],
                        });
                        return;
                    }

                    turnIndex = (turnIndex + 1) % players.length;
                    statusOverlay = "";
                    drawVotes.clear(); 
                } 
                
                else if (nextAction.type === 'leave') {
                    const leavingPlayer = players.find(p => p.id === nextAction.userId);
                    const leavingIndex = players.findIndex(p => p.id === nextAction.userId);
                    players.splice(leavingIndex, 1);

                    if (players.length < 2) {
                        const survivor = players[0];
                        await interaction.channel.send({
                            embeds: [successEmbed("🏆 Victory by Forfeit", `${renderBoardString()}\n\n🎉 Everyone else backed out! **${survivor.username}** (${survivor.emoji}) wins the game!`)],
                        });
                        return;
                    }

                    if (turnIndex >= players.length) turnIndex = 0;
                    statusOverlay = `\n🔔 **${leavingPlayer.username}** has abandoned the match.`;
                    drawVotes.clear();
                } 
                
                else if (nextAction.type === 'timeout') {
                    const timedOutPlayer = players.find(p => p.id === nextAction.userId);
                    const timedOutIndex = players.findIndex(p => p.id === nextAction.userId);
                    players.splice(timedOutIndex, 1);

                    if (players.length < 2) {
                        const survivor = players[0];
                        await interaction.channel.send({
                            embeds: [warningEmbed("🏆 Victory by Timeout", `${renderBoardString()}\n\n⏳ **${timedOutPlayer.username}** ran out of time! **${survivor.username}** (${survivor.emoji}) wins!`)],
                        });
                        return;
                    }

                    if (turnIndex >= players.length) turnIndex = 0;
                    statusOverlay = `\n⏳ **${timedOutPlayer.username}** failed to move within the time limit and was disqualified!`;
                    drawVotes.clear();
                } 
                
                else if (nextAction.type === 'draw_agree') {
                    await interaction.channel.send({
                        embeds: [infoEmbed("🤝 Mutual Draw Agreed", `${renderBoardString()}\n\nAll participants have mutually voted to end the match in a draw!`)],
                    });
                    return;
                }
            }
        }

        // --- PHASE 3: DYNAMIC GRID EVALUATION MATRIX ---
        function checkWin(board, piece, rMax, cMax) {
            // Horizontal check
            for (let r = 0; r < rMax; r++) {
                for (let c = 0; c < cMax - 3; c++) {
                    if (board[r][c] === piece && board[r][c+1] === piece && board[r][c+2] === piece && board[r][c+3] === piece) return true;
                }
            }
            // Vertical check
            for (let r = 0; r < rMax - 3; r++) {
                for (let c = 0; c < cMax; c++) {
                    if (board[r][c] === piece && board[r+1][c] === piece && board[r+2][c] === piece && board[r+3][c] === piece) return true;
                }
            }
            // Positive Diagonal check
            for (let r = 3; r < rMax; r++) {
                for (let c = 0; c < cMax - 3; c++) {
                    if (board[r][c] === piece && board[r-1][c+1] === piece && board[r-2][c+2] === piece && board[r-3][c+3] === piece) return true;
                }
            }
            // Negative Diagonal check
            for (let r = 0; r < rMax - 3; r++) {
                for (let c = 0; c < cMax - 3; c++) {
                    if (board[r][c] === piece && board[r+1][c+1] === piece && board[r+2][c+2] === piece && board[r+3][c+3] === piece) return true;
                }
            }
            return false;
        }

    }, { command: 'connect4' })
};
