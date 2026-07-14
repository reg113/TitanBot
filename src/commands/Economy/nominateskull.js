import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// --- VOTING SYSTEM CONFIGURATION ---
const VOTE_CHANNEL_ID = '1526684676587261983'; 
const WELCOME_CHANNEL_ID = '1526684676587261983'; // If empty/invalid, defaults to the voting channel
const VOTER_ROLE_ID = '1515655155050086400';    
const TARGET_ROLE_ID = '1515655155050086400';   
const REQUIRED_VOTES = 3;                        
const VOTE_DURATION = 5 * 60 * 1000;             
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
        const isMessage = !interaction.options;
        const user = isMessage ? interaction.author : interaction.user;
        const guild = interaction.guild;
        
        // Capture the raw channel ID immediately to prevent stale channel cache loops
        const commandChannelId = interaction.channelId;

        // 1. Parse the target user IMMEDIATELY
        let targetUser;
        if (isMessage) {
            targetUser = interaction.mentions.users.first();
            if (!targetUser) {
                throw createError(
                    "Missing argument",
                    ErrorTypes.VALIDATION,
                    "Please mention the user you want to nominate. Example: `!nominate @James`"
                );
            }
        } else {
            targetUser = interaction.options.getUser('target');
        }

        // 2. If it's a slash command, defer instantly before doing ANY network/API fetches
        if (!isMessage) {
            const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
            if (!deferred) return;
        }

        // 3. Wrap all API fetches and checks in a protected block to prevent "Interaction Failed" errors
        try {
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) {
                throw createError(
                    "User not found",
                    ErrorTypes.VALIDATION,
                    "Could not find that user within this server."
                );
            }

            if (targetMember.roles.cache.has(TARGET_ROLE_ID)) {
                throw createError(
                    "Already Has Role",
                    ErrorTypes.VALIDATION,
                    `${targetUser.toString()} already possesses that role.`
                );
            }

            const voteChannel = await guild.channels.fetch(VOTE_CHANNEL_ID).catch(() => null);
            if (!voteChannel) {
                throw createError(
                    "Configuration Error",
                    ErrorTypes.SYSTEM,
                    "The designated voting channel could not be found. Check your VOTE_CHANNEL_ID."
                );
            }

            // Helper function to build the base description layout
            const makeDescription = (votersMarkdown = '*None yet*') => {
                return `A vote has been opened to grant the <@&${TARGET_ROLE_ID}> role to ${targetUser.toString()} by ${user.toString()}.\n\n` +
                       `**Requirements:**\n` +
                       `• Requires **${REQUIRED_VOTES}** approval votes\n` +
                       `• Only members with the <@&${VOTER_ROLE_ID}> role can vote.\n\n` +
                       `**Current Voters:**\n${votersMarkdown}`;
            };

            const voteButton = new ButtonBuilder()
                .setCustomId('vote_approve')
                .setLabel(`Vote Yes (0 / ${REQUIRED_VOTES})`)
                .setStyle(ButtonStyle.Success)
                .setEmoji('💀');

            const row = new ActionRowBuilder().addComponents(voteButton);

            const embed = new EmbedBuilder()
                .setTitle('🗳️ Role Nomination Started!')
                .setDescription(makeDescription())
                .setColor(0x3498db)
                .setTimestamp()
                .setFooter({ text: `Nominated by ${user.username}`, iconURL: user.displayAvatarURL() });

            // Post the voting ticket to the target channel
            const voteMessage = await voteChannel.send({ embeds: [embed], components: [row] });

            // Clean up the command execution response
            if (isMessage) {
                await interaction.delete().catch(() => {});
            } else {
                await InteractionHelper.safeEditReply(interaction, { 
                    content: `🗳️ Nomination successfully initialized in ${voteChannel.toString()}!` 
                });
            }

            // 4. Set up the component collector for the buttons
            const votedUserIds = new Set();
            const collector = voteMessage.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: VOTE_DURATION
            });

            collector.on('collect', async (btnInteraction) => {
                const voterMember = btnInteraction.member;

                // Role check validation
                if (!voterMember.roles.cache.has(VOTER_ROLE_ID)) {
                    await btnInteraction.reply({ 
                        content: `❌ Only users carrying the <@&${VOTER_ROLE_ID}> role are authorized to vote on this.`, 
                        ephemeral: true 
                    });
                    return;
                }

                // Acknowledge the click immediately to prevent button lag/errors
                await btnInteraction.deferUpdate().catch(() => {});

                // TOGGLE LOGIC: If they already voted, delete them. Otherwise, add them.
                if (votedUserIds.has(voterMember.id)) {
                    votedUserIds.delete(voterMember.id);
                } else {
                    votedUserIds.add(voterMember.id);
                }

                const currentVoteCount = votedUserIds.size;
                
                // Construct the markdown list of voters dynamically
                const votersMarkdown = currentVoteCount > 0 
                    ? Array.from(votedUserIds).map(id => `<@${id}>`).join(', ') 
                    : '*None yet*';

                // Check if threshold is met
                if (currentVoteCount >= REQUIRED_VOTES) {
                    collector.stop('passed');
                } else {
                    // Update layout seamlessly to match current vote count shifts
                    voteButton.setLabel(`Vote Yes (${currentVoteCount} / ${REQUIRED_VOTES})`);
                    embed.setDescription(makeDescription(votersMarkdown));
                    await voteMessage.edit({ embeds: [embed], components: [row] }).catch(() => {});
                }
            });

            // 5. End Lifecycle Execution
            collector.on('end', async (collected, reason) => {
                try {
                    const totalVoters = votedUserIds.size;
                    const finalVotersMarkdown = totalVoters > 0 
                        ? Array.from(votedUserIds).map(id => `<@${id}>`).join(', ') 
                        : '*No one voted*';

                    const isSuccess = reason === 'passed' || totalVoters >= REQUIRED_VOTES;
                    let notificationContent = '';

                    const freshVoteChannel = await guild.channels.fetch(VOTE_CHANNEL_ID).catch(() => null);
                    const freshCommandChannel = await guild.channels.fetch(commandChannelId).catch(() => null);

                    if (isSuccess) {
                        const freshTargetMember = await guild.members.fetch(targetUser.id).catch(() => null);
                        if (freshTargetMember) {
                            await freshTargetMember.roles.add(TARGET_ROLE_ID).catch(err => {
                                console.error('[Nominate Role Error] Bot lacks permissions or role hierarchy issue:', err);
                            });
                        }

                        embed.setTitle('✅ Nomination Approved!')
                             .setDescription(`🎉 The vote succeeded with **${totalVoters}** approvals!\n\n${targetUser.toString()} has officially been awarded the <@&${TARGET_ROLE_ID}> role.\n\n**Final Voters:**\n${finalVotersMarkdown}`)
                             .setColor(0x2ecc71);

                        notificationContent = `🎉 **Nomination Passed!** ${targetUser.toString()}, the nomination started by ${user.toString()} has succeeded with **${totalVoters}/${REQUIRED_VOTES}** votes! You have been granted the <@&${TARGET_ROLE_ID}> role.`;
                    } else {
                        embed.setTitle('❌ Nomination Expired')
                             .setDescription(`The voting timeframe concluded. Not enough votes were acquired to grant ${targetUser.toString()} the role.\n\n**Final Count:** ${totalVoters} / ${REQUIRED_VOTES}\n\n**Voters:**\n${finalVotersMarkdown}`)
                             .setColor(0xe74c3c);

                        notificationContent = `❌ **Nomination Failed.** ${targetUser.toString()}, the nomination started by ${user.toString()} did not get enough votes (**${totalVoters}/${REQUIRED_VOTES}**).`;
                    }

                    // 1. Remove active button control interface entirely from the original post
                    if (freshVoteChannel) {
                        const freshMessage = await freshVoteChannel.messages.fetch(voteMessage.id).catch(() => null);
                        if (freshMessage) {
                            await freshMessage.edit({ embeds: [embed], components: [] }).catch(err => {
                                console.error('[Nominate Layout Error] Failed editing voting card:', err);
                            });
                        }
                    }

                    // 2. Send Message 1 into the original execution channel tracking data parameters
                    if (freshCommandChannel) {
                        await freshCommandChannel.send({ content: notificationContent }).catch(err => {
                            console.error('[Nominate Route Error] Bot lacks Send Messages permission in command channel:', err);
                        });
                    }

                    // 3. Send Message 2 (Celebration) to Welcome/Voting Channel
                    if (isSuccess) {
                        const welcomeChannel = await guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
                        const finalWelcomeDestination = welcomeChannel || freshVoteChannel;

                        if (finalWelcomeDestination) {
                            const welcomeMessageContent = `**Welcome!** ${targetUser.toString()} has officially received the <@&${TARGET_ROLE_ID}> role! Let's give them a massive welcome! 🎉`;
                            await finalWelcomeDestination.send({ content: welcomeMessageContent }).catch(err => {
                                console.error('[Nominate Welcome Error] Bot failed sending welcome announcement:', err);
                            });
                        }
                    }
                } catch (internalEventError) {
                    console.error('[Nominate End Lifecycle Critical Crash]:', internalEventError);
                }
            });

        } catch (error) {
            // Safe Error Handling: If a slash command has been deferred, safely edit the response 
            if (!isMessage) {
                await InteractionHelper.safeEditReply(interaction, {
                    content: `❌ **${error.name || 'Error'}:** ${error.message || 'An unexpected error occurred.'}`
                });
                return;
            }
            throw error;
        }
    }, { command: 'nominate' })
};
