import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// --- VOTING SYSTEM CONFIGURATION ---
const VOTE_CHANNEL_ID = '1515683394690879548'; // The channel where the vote prompt will drop
const VOTER_ROLE_ID = '1515655155050086400';    // Only people with this role are allowed to vote
const TARGET_ROLE_ID = '1515655155050086400';   // The role given to the user if the vote passes
const REQUIRED_VOTES = 3;                        // The target amount of votes needed to pass
const VOTE_DURATION = 5 * 60 * 1000;             // How long the vote stays open (5 minutes)
// -----------------------------------

export default {
    data: new SlashCommandBuilder()
        .setName('nominate')
        .setDescription('Start a community vote to grant a role to a user')
        .addUserOption(option =>
            option
                .setName('target')
                .setDescription('The user you want to nominate for the role')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        // 1. Detect command source (Text message vs Slash command)
        const isMessage = !interaction.options;
        const user = isMessage ? interaction.author : interaction.user;
        const guild = interaction.guild;

        let targetUser;
        if (isMessage) {
            // Extract the first user mentioned in the text message
            targetUser = interaction.mentions.users.first();
            
            if (!targetUser) {
                throw createError(
                    "Missing argument",
                    ErrorTypes.VALIDATION,
                    "Please mention the user you want to nominate. Example: `!nominate @James`"
                );
            }
        } else {
            // Handle slash command deferral
            const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
            if (!deferred) return;
            targetUser = interaction.options.getUser('target');
        }

        // 2. Resolve the guild member target object
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            throw createError(
                "User not found",
                ErrorTypes.VALIDATION,
                "Could not find that user within this server."
            );
        }

        // 3. Make sure they don't already have the target role
        if (targetMember.roles.cache.has(TARGET_ROLE_ID)) {
            throw createError(
                "Already Has Role",
                ErrorTypes.VALIDATION,
                `${targetUser.toString()} already possesses that role.`
            );
        }

        // 4. Fetch the designated channel where voting occurs
        const voteChannel = await guild.channels.fetch(VOTE_CHANNEL_ID).catch(() => null);
        if (!voteChannel) {
            throw createError(
                "Configuration Error",
                ErrorTypes.SYSTEM,
                "The designated voting channel could not be found. Check your VOTE_CHANNEL_ID."
            );
        }

        // 5. Build components and embeds for the vote
        const voteButton = new ButtonBuilder()
            .setCustomId('vote_approve')
            .setLabel(`Vote Yes (0 / ${REQUIRED_VOTES})`)
            .setStyle(ButtonStyle.Success)
            .setEmoji('💀');

        const row = new ActionRowBuilder().addComponents(voteButton);

        const embed = new EmbedBuilder()
            .setTitle('🗳️ Role Nomination Started!')
            .setDescription(`A vote has been opened to grant the <@&${TARGET_ROLE_ID}> role to ${targetUser.toString()}.\n\n**Requirements:**\n• Requires **${REQUIRED_VOTES}** approval votes\n• Only members with the <@&${VOTER_ROLE_ID}> role can vote.`)
            .setColor(0x3498db)
            .setTimestamp()
            .setFooter({ text: `Nominated by ${user.username}`, iconURL: user.displayAvatarURL() });

        // Send the polling card to the specific channel
        const voteMessage = await voteChannel.send({ embeds: [embed], components: [row] });

        // Respond to the execution source
        if (isMessage) {
            await interaction.delete().catch(() => {});
        } else {
            await InteractionHelper.safeEditReply(interaction, { 
                content: `🗳️ Nomination successfully initialized in ${voteChannel.toString()}!` 
            });
        }

        // 6. Monitor interactions on the button components
        const votedUserIds = new Set();
        const collector = voteMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: VOTE_DURATION
        });

        collector.on('collect', async (btnInteraction) => {
            const voterMember = btnInteraction.member;

            // Enforce that the clicker has the mandatory voting role
            if (!voterMember.roles.cache.has(VOTER_ROLE_ID)) {
                await btnInteraction.reply({ 
                    content: `❌ Only users carrying the <@&${VOTER_ROLE_ID}> role are authorized to vote on this.`, 
                    ephemeral: true 
                });
                return;
            }

            // Block voters from multi-clicking the button
            if (votedUserIds.has(voterMember.id)) {
                await btnInteraction.reply({ 
                    content: `❌ You have already cast your vote for this nomination!`, 
                    ephemeral: true 
                });
                return;
            }

            // Save the vote state
            votedUserIds.add(voterMember.id);
            const currentVoteCount = votedUserIds.size;

            if (currentVoteCount >= REQUIRED_VOTES) {
                // Instantly declare a win condition and stop the collection timer
                collector.stop('passed');
                await btnInteraction.deferUpdate();
            } else {
                // Update button text labels in real-time with the current tally
                voteButton.setLabel(`Vote Yes (${currentVoteCount} / ${REQUIRED_VOTES})`);
                await btnInteraction.update({ components: [row] });
            }
        });

        collector.on('end', async (collected, reason) => {
            const totalVoters = votedUserIds.size;

            if (reason === 'passed' || totalVoters >= REQUIRED_VOTES) {
                // Success action: assign the role to the target user
                await targetMember.roles.add(TARGET_ROLE_ID).catch(() => {});

                embed.setTitle('✅ Nomination Approved!')
                     .setDescription(`🎉 The vote succeeded with **${totalVoters}** approvals!\n\n${targetUser.toString()} has officially been awarded the <@&${TARGET_ROLE_ID}> role.`)
                     .setColor(0x2ecc71);
            } else {
                // Timeout action: dynamic color changing to visually close the prompt
                embed.setTitle('❌ Nomination Expired')
                     .setDescription(`The voting timeframe concluded. Not enough votes were acquired to grant ${targetUser.toString()} the role.\n\n**Final Count:** ${totalVoters} / ${REQUIRED_VOTES}`)
                     .setColor(0xe74c3c);
            }

            // Strip the active buttons from the final message card layout
            await voteMessage.edit({ embeds: [embed], components: [] }).catch(() => {});
        });

    }, { command: 'nominate' })
};
