import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// --- VOTING SYSTEM CONFIGURATION ---
const VOTE_CHANNEL_ID = '1515683394690879548'; 
const VOTER_ROLE_ID = '1515678213265686528';    
const TARGET_ROLE_ID = '1515678232140054579';   
const REQUIRED_VOTES = 5;                        
const VOTE_DURATION = 5 * 60 * 1000;             
// -----------------------------------

export default {
    data: new SlashCommandBuilder()
        .setName('nominate2')
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
            const deferred = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
            if (!deferred) return;
            targetUser = interaction.options.getUser('target');
        }

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
            return `A vote has been opened to grant the <@&${TARGET_ROLE_ID}> role to ${targetUser.toString()}.\n\n` +
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

        const voteMessage = await voteChannel.send({ embeds: [embed], components: [row] });

        if (isMessage) {
            await interaction.delete().catch(() => {});
        } else {
            await InteractionHelper.safeEditReply(interaction, { 
                content: `🗳️ Nomination successfully initialized in ${voteChannel.toString()}!` 
            });
        }

        const votedUserIds = new Set();
        const collector = voteMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: VOTE_DURATION
        });

        collector.on('collect', async (btnInteraction) => {
            const voterMember = btnInteraction.member;

            if (!voterMember.roles.cache.has(VOTER_ROLE_ID)) {
                await btnInteraction.reply({ 
                    content: `❌ Only users carrying the <@&${VOTER_ROLE_ID}> role are authorized to vote on this.`, 
                    ephemeral: true 
                });
                return;
            }

            if (votedUserIds.has(voterMember.id)) {
                await btnInteraction.reply({ 
                    content: `❌ You have already cast your vote for this nomination!`, 
                    ephemeral: true 
                });
                return;
            }

            // Register the new voter
            votedUserIds.add(voterMember.id);
            const currentVoteCount = votedUserIds.size;

            // Turn the Set of IDs into a string list of clickable user mentions
            const votersMarkdown = Array.from(votedUserIds).map(id => `<@${id}>`).join(', ');

            if (currentVoteCount >= REQUIRED_VOTES) {
                collector.stop('passed');
                await btnInteraction.deferUpdate();
            } else {
                voteButton.setLabel(`Vote Yes (${currentVoteCount} / ${REQUIRED_VOTES})`);
                
                // Live update the embed with the list of voters
                embed.setDescription(makeDescription(votersMarkdown));
                
                await btnInteraction.update({ embeds: [embed], components: [row] });
            }
        });

        collector.on('end', async (collected, reason) => {
            const totalVoters = votedUserIds.size;
            const finalVotersMarkdown = totalVoters > 0 
                ? Array.from(votedUserIds).map(id => `<@${id}>`).join(', ') 
                : '*No one voted*';

            if (reason === 'passed' || totalVoters >= REQUIRED_VOTES) {
                await targetMember.roles.add(TARGET_ROLE_ID).catch(() => {});

                embed.setTitle('✅ Nomination Approved!')
                     .setDescription(`🎉 The vote succeeded with **${totalVoters}** approvals!\n\n${targetUser.toString()} has officially been awarded the <@&${TARGET_ROLE_ID}> role.\n\n**Final Voters:**\n${finalVotersMarkdown}`)
                     .setColor(0x2ecc71);
            } else {
                embed.setTitle('❌ Nomination Expired')
                     .setDescription(`The voting timeframe concluded. Not enough votes were acquired to grant ${targetUser.toString()} the role.\n\n**Final Count:** ${totalVoters} / ${REQUIRED_VOTES}\n\n**Voters:**\n${finalVotersMarkdown}`)
                     .setColor(0xe74c3c);
            }

            await voteMessage.edit({ embeds: [embed], components: [] }).catch(() => {});
        });

    }, { command: 'nominate2' })
};
