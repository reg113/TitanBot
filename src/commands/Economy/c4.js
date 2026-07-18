import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    StringSelectMenuBuilder, 
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
        .setDescription('Start an interactive multiplayer Connect 4 match!'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const host = interaction.user;
        const guildId = interaction.guildId;

        const PLAYER_CONFIGS = [
            { emoji: ':red_circle:', name: 'Red' },
            { emoji: ':yellow_circle:', name: 'Yellow' },
            { emoji: ':blue_circle:', name: 'Blue' },
            { emoji: ':green_circle:', name: 'Green' }
        ];

        let players = [
            { id: host.id, username: host.username, user: host, emoji: PLAYER_CONFIGS[0].emoji }
        ];

        logger.info(`[GAMES] Connect 4 interactive lobby initiated by ${host.id}`, { guildId });

        // --- PHASE 1: LOBBY MANAGING ---
        function getLobbyEmbed() {
            const playerList = players.map((p, index) => `${index + 1}. ${p.emoji} **${p.username}**`).join('\n');
            return infoEmbed(
                "🎮 Connect 4 Multiplayer Lobby",
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

            // Launch game engine
            await runActiveGame();
        });

        // --- PHASE 2: ACTIVE GAMEPLAY ENGINE ---
        async function runActiveGame() {
            const board = Array(6).fill(null).map(() => Array(7).fill(':white_circle:'));
            let turnIndex = 0;

            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            // Status message injection update map helper layout layer
            function getGameEmbed(statusOverlay = "") {
                const current = players[turnIndex];
                const keyMap = players.map(p => `${p.emoji} = ${p.username}`).join('  |  ');
                const mainPrompt = statusOverlay || `👉 **Turn:** ${current.user.toString()} ${current.emoji}\nSelect a column from the dropdown menu below to play!`;

                return infoEmbed(
                    `📊 Connect 4 Arena`,
                    `${renderBoardString()}\n\n🔹 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n\n**Key:** ${keyMap}\n\n${mainPrompt}`
                );
            }

            function getGameComponents() {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('c4_game_drop')
                    .setPlaceholder('Choose a column to drop your piece...')
                    .addOptions(
                        Array(7).fill(null).map((_, i) => ({
                            label: `Column ${i + 1}`,
                            value: `${i}`,
                            description: board[0][i] !== ':white_circle:' ? '🚫 FULL' : `Drop into column ${i + 1}`
                        }))
                    );

                const forfeitButton = new ButtonBuilder()
                    .setCustomId('c4_game_leave')
                    .setLabel('🏳️ Forfeit / Leave Match')
                    .setStyle(ButtonStyle.Danger);

                return [
                    new ActionRowBuilder().addComponents(selectMenu),
                    new ActionRowBuilder().addComponents(forfeitButton)
                ];
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [getGameEmbed()],
                components: getGameComponents()
            });

            const gameCollector = lobbyResponse.createMessageComponentCollector({
                time: 600000 
            });

            gameCollector.on('collect', async (compCtx) => {
                try {
                    const activePlayerIds = players.map(p => p.id);
                    
                    if (!activePlayerIds.includes(compCtx.user.id)) {
                        return compCtx.reply({ content: "❌ You are not a player in this active match!", ephemeral: true });
                    }

                    if (compCtx.customId === 'c4_game_leave') {
                        await compCtx.deferUpdate();

                        const leavingPlayer = players.find(p => p.id === compCtx.user.id);
                        const leavingIndex = players.findIndex(p => p.id === compCtx.user.id);

                        players.splice(leavingIndex, 1);
                        
                        if (players.length < 2) {
                            gameCollector.stop('forfeit_victory');
                            return;
                        }

                        if (turnIndex >= players.length) {
                            turnIndex = 0;
                        }

                        await compCtx.editReply({
                            embeds: [getGameEmbed(`🔔 **${leavingPlayer.username}** has abandoned the match.`)],
                            components: getGameComponents()
                        });
                        return;
                    }

                    if (compCtx.customId === 'c4_game_drop') {
                        const currentPlayer = players[turnIndex];

                        if (compCtx.user.id !== currentPlayer.id) {
                            return compCtx.reply({ content: `⏳ Hold on! It is currently ${currentPlayer.username}'s turn.`, ephemeral: true });
                        }

                        const colIndex = parseInt(compCtx.values[0]);

                        if (board[0][colIndex] !== ':white_circle:') {
                            return compCtx.reply({ content: "🚫 That column is completely full! Choose another column.", ephemeral: true });
                        }

                        await compCtx.deferUpdate();

                        for (let r = 5; r >= 0; r--) {
                            if (board[r][colIndex] === ':white_circle:') {
                                board[r][colIndex] = currentPlayer.emoji;
                                break;
                            }
                        }

                        // FIXED: Passing 'board' down explicitly into the evaluation matrix
                        if (checkWin(board, currentPlayer.emoji)) {
                            gameCollector.stop('win');
                            return;
                        }

                        if (board[0].every(cell => cell !== ':white_circle:')) {
                            gameCollector.stop('draw');
                            return;
                        }

                        turnIndex = (turnIndex + 1) % players.length;

                        await compCtx.editReply({
                            embeds: [getGameEmbed()],
                            components: getGameComponents()
                        });
                    }
                } catch (err) {
                    logger.error("[GAMES] Error encountered inside Connect 4 engine collector loop", err);
                }
            });

            gameCollector.on('end', async (_, endReason) => {
                try {
                    if (endReason === 'win') {
                        const winner = players[turnIndex];
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [successEmbed("🏆 Match Decided!", `${renderBoardString()}\n\n🎉 Congratulations **${winner.username}** (${winner.emoji}), you aligned 4 and claimed victory!`)],
                            components: []
                        });
                    } else if (endReason === 'forfeit_victory') {
                        const survivor = players[0];
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [successEmbed("🏆 Victory by Forfeit", `${renderBoardString()}\n\n🎉 Everyone else backed out! **${survivor.username}** (${survivor.emoji}) wins the game!`)],
                            components: []
                        });
                    } else if (endReason === 'draw') {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [infoEmbed("🤝 Game Over", `${renderBoardString()}\n\nThe grid is completely packed out. The match ends in a draw!`)],
                            components: []
                        });
                    } else {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [warningEmbed("⌛ Session Expired", "The match timed out due to total inactivity.")],
                            components: []
                        });
                    }
                } catch (err) {
                    logger.error("[GAMES] Error while rendering terminal Connect 4 scoreboard", err);
                }
            });
        }

        // --- PHASE 3: GRID EVALUATION MATRIX ---
        // FIXED: Added board parameter so it doesn't cause a ReferenceError scoping crash
        function checkWin(board, piece) {
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
