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
        .setDescription('Challenge another member to a game of Connect 4!')
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

        // 1. Validation Checks
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
                "Bots haven't learned how to play Connect 4 here yet. Challenge a human!",
                { userId: challenger.id, targetBotId: opponent.id }
            );
        }

        logger.info(`[GAMES] Connect 4 challenge issued by ${challenger.id} to ${opponent.id}`, { guildId });

        // 2. Phase 1: The Invitation Menu
        const inviteEmbed = infoEmbed(
            "🔴 Connect 4 Challenge! 🟡",
            `**${challenger.username}** has challenged **${opponent.toString()}** to a match of Connect 4!\n\nDo you accept the challenge?`
        ).setFooter({ text: "Invitation expires in 60 seconds." });

        const inviteRows = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('c4_accept').setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('c4_decline').setLabel('Decline').setStyle(ButtonStyle.Danger)
        );

        await InteractionHelper.safeEditReply(interaction, {
            content: opponent.toString(),
            embeds: [inviteEmbed],
            components: [inviteRows]
        });

        const inviteResponse = await interaction.fetchReply();
        const inviteCollector = inviteResponse.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000
        });

        // Game State Variables shared across execution scope
        let gameActive = false;
        let player1 = challenger;
        let player2 = opponent;
        let currentTurn = player1; 
        
        // 6 rows x 7 columns board representation
        const board = Array(6).fill(null).map(() => Array(7).fill('⚪'));
        const P1_EMOJI = '🔴';
        const P2_EMOJI = '🟡';

        inviteCollector.on('collect', async (btnCtx) => {
            if (btnCtx.user.id !== opponent.id) {
                return btnCtx.reply({ content: "Only the challenged opponent can respond to this invite!", ephemeral: true });
            }

            await btnCtx.deferUpdate();

            if (btnCtx.customId === 'c4_accept') {
                gameActive = true;
                inviteCollector.stop('accepted');
            } else {
                inviteCollector.stop('declined');
            }
        });

        inviteCollector.on('end', async (_, reason) => {
            if (reason === 'declined') {
                await InteractionHelper.safeEditReply(interaction, {
                    content: ' ',
                    embeds: [warningEmbed("Challenge Declined", `${opponent.username} decided not to play this time.`)],
                    components: []
                });
                return;
            }

            if (reason === 'time' && !gameActive) {
                await InteractionHelper.safeEditReply(interaction, {
                    content: ' ',
                    embeds: [warningEmbed("Challenge Expired", `${opponent.username} didn't respond to the invitation in time.`)],
                    components: []
                });
                return;
            }

            if (reason === 'accepted' && gameActive) {
                // Begin Phase 2: Active Gameplay Loop
                await runGameLoop();
            }
        });

        // 3. Phase 2: Gameplay Mechanics Framework
        async function runGameLoop() {
            const gameCollector = inviteResponse.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300000 // 5-minute maximum match duration
            });

            // Renders the board to visual strings
            function renderBoardString() {
                return board.map(row => row.join(' ')).join('\n');
            }

            function getGameEmbed(statusText = "") {
                const turnStatus = statusText || `Current Turn: ${currentTurn.toString()} ${currentTurn.id === player1.id ? P1_EMOJI : P2_EMOJI}`;
                return infoEmbed(
                    `📊 Connect 4: ${player1.username} vs ${player2.username}`,
                    `${renderBoardString()}\n\n🔹 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n\n${turnStatus}`
                );
            }

            function getGameControls(disabled = false) {
                const row1 = new ActionRowBuilder();
                const row2 = new ActionRowBuilder();

                // Columns 1 to 5
                for (let i = 0; i < 5; i++) {
                    row1.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`c4_drop_${i}`)
                            .setLabel(`${i + 1}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(disabled || board[0][i] !== '⚪')
                    );
                }

                // Columns 6 and 7
                for (let i = 5; i < 7; i++) {
                    row2.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`c4_drop_${i}`)
                            .setLabel(`${i + 1}`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(disabled || board[0][i] !== '⚪')
                    );
                }

                return [row1, row2];
            }

            // Push initial board viewport layout
            await InteractionHelper.safeEditReply(interaction, {
                content: `🎮 Match Started! Turn: ${currentTurn.toString()}`,
                embeds: [getGameEmbed()],
                components: getGameControls()
            });

            gameCollector.on('collect', async (gameBtnCtx) => {
                if (gameBtnCtx.user.id !== currentTurn.id) {
                    return gameBtnCtx.reply({ content: `It's not your turn! Wait for ${currentTurn.username} to move.`, ephemeral: true });
                }

                await gameBtnCtx.deferUpdate();
                
                const colIndex = parseInt(gameBtnCtx.customId.split('_')[2]);
                const currentEmoji = currentTurn.id === player1.id ? P1_EMOJI : P2_EMOJI;

                // Drop piece to the lowest index row available in the target column
                let piecePlaced = false;
                for (let r = 5; r >= 0; r--) {
                    if (board[r][colIndex] === '⚪') {
                        board[r][colIndex] = currentEmoji;
                        piecePlaced = true;
                        break;
                    }
                }

                if (!piecePlaced) {
                    return; // Fail-safe fallback if column button state fails validation
                }

                // Check for terminal win states
                if (checkWin(currentEmoji)) {
                    gameCollector.stop('win');
                    return;
                }

                // Check for draw states (top row completely saturated)
                if (board[0].every(cell => cell !== '⚪')) {
                    gameCollector.stop('draw');
                    return;
                }

                // Swap turns seamlessly
                currentTurn = currentTurn.id === player1.id ? player2 : player1;

                await InteractionHelper.safeEditReply(interaction, {
                    content: `Turn: ${currentTurn.toString()}`,
                    embeds: [getGameEmbed()],
                    components: getGameControls()
                });
            });

            gameCollector.on('end', async (_, endReason) => {
                const finalControls = getGameControls(true);

                if (endReason === 'win') {
                    const winEmbed = successEmbed(
                        "🏆 Connect 4 Victory!",
                        `${renderBoardString()}\n\n🎉 **${currentTurn.username}** has aligned 4 and won the match!`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [winEmbed], components: finalControls });
                    logger.info(`[GAMES] Connect 4 match finished. Winner: ${currentTurn.id}`, { guildId });
                } else if (endReason === 'draw') {
                    const drawEmbed = infoEmbed(
                        "🤝 Stalemate!",
                        `${renderBoardString()}\n\nThe board is completely full! The game ends in a tie.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [drawEmbed], components: finalControls });
                } else {
                    // Timeout fallback handler
                    const timeoutEmbed = warningEmbed(
                        "⌛ Match Abandoned",
                        `${renderBoardString()}\n\nThe game timed out because a player took longer than 5 minutes to complete their turn.`
                    );
                    await InteractionHelper.safeEditReply(interaction, { content: ' ', embeds: [timeoutEmbed], components: finalControls });
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
