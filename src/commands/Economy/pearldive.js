const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} = require('discord.js');

// =========================================================================
// MOCK DATABASE FUNCTIONS - Replace these with your actual database logic!
// =========================================================================
async function getUserBalance(userId) {
    // e.g., return await db.get(`money_${userId}`) || 0;
    return 1000; // Mocking 1,000 Dirhams for testing
}

async function updateBalance(userId, amount) {
    // e.g., await db.add(`money_${userId}`, amount);
    console.log(`Updated user ${userId} balance by ${amount} Dirhams.`);
}
// =========================================================================

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pearldive')
        .setDescription('Rent a dhow boat and dive the Persian Gulf reef for legendary pearls!'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const entryFee = 150;

        // 1. Check if the player has enough money to rent the boat
        const balance = await getUserBalance(userId);
        if (balance < entryFee) {
            const noCashEmbed = new EmbedBuilder()
                .setColor('#E06666')
                .setTitle('❌ Expedition Denied')
                .setDescription(`You don't have enough money to rent a *dhow* boat! Renting a boat and hiring divers costs **${entryFee} Dirhams**.\n\nYour Current Balance: **${balance} Dirhams**`);
            return interaction.reply({ embeds: [noCashEmbed], ephemeral: true });
        }

        // 2. Deduct the entry fee
        await updateBalance(userId, -entryFee);

        // 3. Initialize Game State
        const state = {
            oxygen: 100,
            standardOysters: 0,
            rareOysters: 0,
            consecutiveHits: 0,
            lastActionLog: '🚢 You sailed out of port and dropped anchor over the pearl beds. Take your first dive!',
            trackDisplay: '',
            targetSlot: 1
        };

        // Helper to generate a new tide track
        function generateTideTrack() {
            const target = Math.floor(Math.random() * 5) + 1; // Target slot 1 to 5
            let track = ['🟥', '🟥', '🟥', '🟥', '🟥'];
            
            track[target - 1] = '🟩'; // Sweet spot
            
            // Generate yellow warning slots adjacent to the sweet spot
            if (target - 2 >= 0) track[target - 2] = '🟨';
            if (target < 5) track[target] = '🟨';

            state.targetSlot = target;
            state.trackDisplay = `[ ${track.join(' ')} ]`;
        }

        // Helper to build the visual oxygen bar
        function getOxygenBar(oxygen) {
            const totalBars = 10;
            const filledBars = Math.max(0, Math.min(totalBars, Math.round(oxygen / 10)));
            const emptyBars = totalBars - filledBars;
            return `[${'█'.repeat(filledBars)}${'░'.repeat(emptyBars)}] **${oxygen}%**`;
        }

        // Helper to render the primary gameplay Embed
        function buildGameEmbed() {
            return new EmbedBuilder()
                .setColor('#2C5E8A')
                .setTitle('⚓ Deep Sea Pearl Dive')
                .setDescription(state.lastActionLog)
                .addFields(
                    { name: '🌊 Current Tide Drift', value: `\`\`\`\n${state.trackDisplay}\n   1   2   3   4   5\n\`\`\`` },
                    { name: '🔋 Oxygen Reserves', value: getOxygenBar(state.oxygen) },
                    { name: '🎒 Dive Bag', value: `🦪 **${state.standardOysters}** Standard Oysters\n✨ **${state.rareOysters}** Rare Black Pearls` }
                )
                .setFooter({ text: 'The deeper you go, the higher the risk. Surface before your oxygen runs dry!' });
        }

        // Helper to generate control buttons
        function buildGameControls(disabled = false) {
            const row1 = new ActionRowBuilder();
            // Numbers 1-5 buttons
            for (let i = 1; i <= 5; i++) {
                row1.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`grab_${i}`)
                        .setLabel(`${i}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(disabled)
                );
            }

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('surface')
                    .setLabel('⛵ Return to Surface & Sell')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(disabled),
                new ButtonBuilder()
                    .setCustomId('abort')
                    .setLabel('🚨 Panic Surface (No Loot)')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(disabled)
            );

            return [row1, row2];
        }

        // 4. Send Initial Game Embed
        generateTideTrack();
        const response = await interaction.reply({
            embeds: [buildGameEmbed()],
            components: buildGameControls(),
            fetchReply: true
        });

        // 5. Create Component Collector
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000 // 3-minute timeout limit per game
        });

        collector.on('collect', async (btnInteraction) => {
            if (btnInteraction.user.id !== userId) {
                return btnInteraction.reply({ content: "This is not your expedition! Use /pearldive to start your own.", ephemeral: true });
            }

            // Defer update so we don't lag Discord's UI
            await btnInteraction.deferUpdate();

            if (btnInteraction.customId.startsWith('grab_')) {
                const clickedNum = parseInt(btnInteraction.customId.split('_')[1]);
                const distance = Math.abs(clickedNum - state.targetSlot);

                if (distance === 0) {
                    // Perfect hit (Green)
                    state.rareOysters += 1;
                    state.oxygen -= 8;
                    state.consecutiveHits += 1;
                    state.lastActionLog = `🎯 **Perfect grab!** You cleanly snatched a rare oyster housing a **Rare Black Pearl**! (-8% Oxygen)`;
                } else if (distance === 1) {
                    // Near miss (Yellow)
                    state.standardOysters += 1;
                    state.oxygen -= 15;
                    state.consecutiveHits = 0;
                    state.lastActionLog = `🦪 **Decent grab.** You fought the currents and gathered a standard oyster. (-15% Oxygen)`;
                } else {
                    // Total miss (Red)
                    state.oxygen -= 30;
                    state.consecutiveHits = 0;
                    state.lastActionLog = `💥 **Missed!** You slammed your hand against sharp coral trying to reach the oysters. (-30% Oxygen)`;
                }

                // Check for Drowning/Blackout
                if (state.oxygen <= 0) {
                    collector.stop('drowned');
                    return;
                }

                // Generate new track for the next round
                generateTideTrack();
                await interaction.editReply({
                    embeds: [buildGameEmbed()],
                    components: buildGameControls()
                });

            } else if (btnInteraction.customId === 'surface') {
                collector.stop('surfaced');
            } else if (btnInteraction.customId === 'abort') {
                collector.stop('aborted');
            }
        });

        collector.on('end', async (collected, reason) => {
            // Disable all inputs at the end of the game state
            const disabledControls = buildGameControls(true);

            if (reason === 'surfaced') {
                // Calculate Payouts
                const standardVal = 80;  // Dirhams per standard oyster
                const rareVal = 300;    // Dirhams per black pearl
                const totalGoldEarned = (state.standardOysters * standardVal) + (state.rareOysters * rareVal);
                const netProfit = totalGoldEarned - entryFee;

                await updateBalance(userId, totalGoldEarned);

                const winEmbed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('⛵ Safe Return to Bahrain Coast')
                    .setDescription(`Your crew hauled you back onto the deck of your *dhow* boat. You safely cracked open your oysters on the way back to port!`)
                    .addFields(
                        { name: '📦 Haul Sold', value: `🦪 **${state.standardOysters}** Standard Oysters × ${standardVal} Dirhams\n✨ **${state.rareOysters}** Rare Pearls × ${rareVal} Dirhams` },
                        { name: '💰 Total Revenue', value: `**${totalGoldEarned} Dirhams**`, inline: true },
                        { name: '📈 Net Profit', value: `${netProfit >= 0 ? '🟢 +' : '🔴 '}${netProfit} Dirhams`, inline: true }
                    );

                await interaction.editReply({ embeds: [winEmbed], components: disabledControls });

            } else if (reason === 'drowned') {
                const loseEmbed = new EmbedBuilder()
                    .setColor('#C0392B')
                    .setTitle('🦈 Blackout in the Deep!')
                    .setDescription(`Your oxygen tank ran completely empty! Your vision faded to black under the waves. Your crew managed to pull you back up just in time, but **your dive bag was swept away by the deep currents**.\n\nLoss: **-${entryFee} Dirhams** (Rent & Medical Fees)`);

                await interaction.editReply({ embeds: [loseEmbed], components: disabledControls });

            } else if (reason === 'aborted') {
                const abortEmbed = new EmbedBuilder()
                    .setColor('#E67E22')
                    .setTitle('🚨 Panic Ascent')
                    .setDescription(`You panicked and pulled your emergency anchor rope to float straight back to the surface. You dropped your dive bag to ascend faster.\n\nLoss: **-${entryFee} Dirhams** (Rent Fees)`);

                await interaction.editReply({ embeds: [abortEmbed], components: disabledControls });

            } else {
                // Timeout
                const timeoutEmbed = new EmbedBuilder()
                    .setColor('#7F8C8D')
                    .setTitle('⌛ Expedition Abandoned')
                    .setDescription(`You waited too long to make your next move, and your dhow captain returned to the harbor without you.`);

                await interaction.editReply({ embeds: [timeoutEmbed], components: disabledControls });
            }
        });
    }
};
