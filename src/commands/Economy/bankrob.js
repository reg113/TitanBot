import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType, 
    EmbedBuilder,
    MessageFlags 
} from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getItemById } from '../../config/shop/items.js'; // Helper to dynamically get item info

// ==========================================
//          --- CONFIGURABLE VALUES ---
// ==========================================
const MIN_VICTIM_BANK = 1500;         // Min bank balance target must have to allow a heist
const MIN_STAKES = 500;              // Min wallet cash required to participate (for host & crew)
const BANKROB_COOLDOWN = 8 * 60 * 60 * 1000; // Cooldown duration in milliseconds (8 Hours)
const PROTECTION_ITEM_ID = 'vault_lock'; // The item ID from items.js that blocks bank robberies

// --- HEIST BALANCING MECHANICS ---
const BASE_SUCCESS_CHANCE = 0.15;     // 15% base success rate for 1 player (the host)
const BONUS_SUCCESS_PER_CREW = 0.10;  // +10% success rate per extra crew member who joins
const MAX_SUCCESS_CHANCE = 0.55;      // Capped at 55% max success rate
const STEAL_PERCENTAGE = 0.20;        // 20% of victim's bank balance is stolen on success
const FINE_PERCENTAGE = 0.10;         // Failure fine: 10% of a participant's wallet cash
// ==========================================

export default {
    data: new SlashCommandBuilder()
        .setName('bankrob')
        .setDescription('Organize a high-stakes cooperative bank heist on a user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user whose bank accounts you want to target')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const hostId = interaction.user.id;
        const victimUser = interaction.options.getUser("user");
        const guildId = interaction.guildId;
        const now = Date.now();

        // 1. Host & Target Validations
        if (hostId === victimUser.id) {
            throw createError(
                "Cannot rob self",
                ErrorTypes.VALIDATION,
                "You cannot plan a bank heist against your own accounts."
            );
        }

        if (victimUser.bot) {
            throw createError(
                "Cannot rob bot",
                ErrorTypes.VALIDATION,
                "The banking systems of bots are too heavily encrypted to break into."
            );
        }

        const hostData = await getEconomyData(client, guildId, hostId);
        const victimData = await getEconomyData(client, guildId, victimUser.id);

        if (!hostData || !victimData) {
            throw createError(
                "Failed to load economy data",
                ErrorTypes.DATABASE,
                "Failed to load economy data. Please try again later."
            );
        }

        // Host Cooldown Check
        const lastBankrob = hostData.lastBankrob || 0;
        if (now < lastBankrob + BANKROB_COOLDOWN) {
            const remaining = lastBankrob + BANKROB_COOLDOWN - now;
            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

            throw createError(
                "Heist cooldown active",
                ErrorTypes.RATE_LIMIT,
                `The feds are watching you. Wait **${hours}h ${minutes}m** before organizing another heist.`
            );
        }

        // Host Buy-in Wallet Check
        const hostWallet = typeof hostData.wallet === 'number' ? hostData.wallet : 0;
        if (hostWallet < MIN_STAKES) {
            throw createError(
                "Insufficient Funds",
                ErrorTypes.VALIDATION,
                `You need at least **$${MIN_STAKES.toLocaleString()}** in your wallet to fund the basic gear for this heist.`
            );
        }

        // Victim Bank Balance Validation
        const victimBank = typeof victimData.bank === 'number' ? victimData.bank : 0;
        if (victimBank < MIN_VICTIM_BANK) {
            throw createError(
                "Victim too poor",
                ErrorTypes.VALIDATION,
                `${victimUser.username} does not have enough funds in their bank to make a heist worthwhile. (Minimum: $${MIN_VICTIM_BANK.toLocaleString()})`
            );
        }

        // Check if the victim has the designated protection item
        const hasProtectionItem = victimData.inventory?.[PROTECTION_ITEM_ID] || 0;
        if (hasProtectionItem > 0) {
            // Find the item details to show a nice name
            const itemDetails = getItemById(PROTECTION_ITEM_ID);
            const itemName = itemDetails ? itemDetails.name : 'Vault Lock';

            // Apply cooldown to host even for scouting a locked vault
            hostData.lastBankrob = now;
            await setEconomyData(client, guildId, hostId, hostData);

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    warningEmbed(
                        'Heist Aborted!',
                        `🚨 Your crew scouted out ${victimUser.username}'s bank, but discovered they have a high-tech **${itemName}** active on their accounts. You had to call off the operation to avoid alarm triggers!`
                    )
                ]
            });
        }

        // 2. Initialize Heist Lobby Setup
        const crewIds = [hostId]; // Host starts as first crew member

        const buildLobbyPayload = (timeRemaining = 30) => {
            const currentChance = Math.min(
                BASE_SUCCESS_CHANCE + (crewIds.length - 1) * BONUS_SUCCESS_PER_CREW,
                MAX_SUCCESS_CHANCE
            );

            const lobbyEmbed = new EmbedBuilder()
                .setTitle('🚨 Bank Heist In Progress!')
                .setDescription(`⚡ **${interaction.user.username}** is putting together a crew to clean out **${victimUser.username}**'s bank vault!\n\nClick the button below to join the crew. Be fast—the vault cracking begins soon!`)
                .addFields(
                    { name: '💰 Target Value', value: `$${victimBank.toLocaleString()}`, inline: true },
                    { name: '⏱️ Commencing In', value: `\`${timeRemaining}s\``, inline: true },
                    { name: '🎯 Success Rate', value: `\`${(currentChance * 100).toFixed(0)}%\` (scales with crew size)`, inline: true },
                    { name: '🎒 Active Crew', value: crewIds.map(id => `<@${id}>`).join('\n') }
                )
                .setColor(0xe74c3c)
                .setFooter({ text: `Minimum wallet requirement to join: $${MIN_STAKES}` });

            const joinButton = new ButtonBuilder()
                .setCustomId('heist_join')
                .setLabel(`Join Crew (${crewIds.length})`)
                .setEmoji('🎒')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(joinButton);

            return { embeds: [lobbyEmbed], components: [row] };
        };

        // Render Initial Lobby
        await InteractionHelper.safeEditReply(interaction, buildLobbyPayload(30));

        const replyMessage = await interaction.fetchReply();
        const collector = replyMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30000 // Lobby active duration (30 seconds)
        });

        // 3. Crew Registrations Collector
        collector.on('collect', async (btnInteraction) => {
            const joinerId = btnInteraction.user.id;

            if (crewIds.includes(joinerId)) {
                await btnInteraction.reply({
                    content: '❌ You are already registered as part of this heist crew!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            if (joinerId === victimUser.id) {
                await btnInteraction.reply({
                    content: '❌ You cannot help rob your own bank account!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            const joinerData = await getEconomyData(client, guildId, joinerId);
            if (!joinerData) {
                await btnInteraction.reply({
                    content: '❌ Error loading your server profile details.',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Cooldown check for crew members
            const joinerLastBankrob = joinerData.lastBankrob || 0;
            if (now < joinerLastBankrob + BANKROB_COOLDOWN) {
                const remaining = joinerLastBankrob + BANKROB_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

                await btnInteraction.reply({
                    content: `❌ You need to lay low. You have **${hours}h ${minutes}m** remaining on your bankrob cooldown.`,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Wallet buy-in check for joining crew members
            const joinerWallet = typeof joinerData.wallet === 'number' ? joinerData.wallet : 0;
            if (joinerWallet < MIN_STAKES) {
                await btnInteraction.reply({
                    content: `❌ You do not have enough equipment cash. You need at least **$${MIN_STAKES}** in your wallet to absorb failure risk!`,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Accept player to the crew list
            crewIds.push(joinerId);
            await btnInteraction.deferUpdate().catch(() => {});
            
            // Re-render lobby with updated crew stats
            const timeElapsed = Date.now() - collector.startTime;
            const remainingSecs = Math.max(0, Math.round((collector.options.time - timeElapsed) / 1000));
            await InteractionHelper.safeEditReply(interaction, buildLobbyPayload(remainingSecs));
        });

        // 4. Heist Final Resolution Phase
        collector.on('end', async () => {
            try {
                const freshVictimData = await getEconomyData(client, guildId, victimUser.id);
                if (!freshVictimData) return;

                const finalVictimBank = typeof freshVictimData.bank === 'number' ? freshVictimData.bank : 0;

                // Ensure balance requirements are still met at runtime
                if (finalVictimBank < MIN_VICTIM_BANK) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            warningEmbed(
                                'Heist Cancelled',
                                `The heist was cancelled because ${victimUser.username}'s bank balance fell below the required $${MIN_VICTIM_BANK.toLocaleString()} threshold during the planning phase.`
                            )
                        ],
                        components: []
                    });
                    return;
                }

                // Double check target protection items again before running success chance
                if ((freshVictimData.inventory?.[PROTECTION_ITEM_ID] || 0) > 0) {
                    const itemDetails = getItemById(PROTECTION_ITEM_ID);
                    const itemName = itemDetails ? itemDetails.name : 'Vault Lock';

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            warningEmbed(
                                'Heist Tripped',
                                `🔒 **Heist Blocked!** The crew broke in, but ${victimUser.username} has a **${itemName}** active! The alarms sounded and everyone fled empty-handed.`
                            )
                        ],
                        components: []
                    });
                    return;
                }

                // Determine Success Rate
                const finalSuccessChance = Math.min(
                    BASE_SUCCESS_CHANCE + (crewIds.length - 1) * BONUS_SUCCESS_PER_CREW,
                    MAX_SUCCESS_CHANCE
                );

                const isSuccessful = Math.random() < finalSuccessChance;
                const resultEmbed = new EmbedBuilder();

                if (isSuccessful) {
                    const totalStolen = Math.floor(finalVictimBank * STEAL_PERCENTAGE);
                    const splitAmount = Math.floor(totalStolen / crewIds.length);

                    // Deduct from target's bank account
                    freshVictimData.bank = Math.max(0, finalVictimBank - totalStolen);
                    await setEconomyData(client, guildId, victimUser.id, freshVictimData);

                    // Payout all crew members
                    for (const memberId of crewIds) {
                        const memberData = await getEconomyData(client, guildId, memberId);
                        if (memberData) {
                            memberData.wallet = (memberData.wallet || 0) + splitAmount;
                            memberData.lastBankrob = Date.now();
                            await setEconomyData(client, guildId, memberId, memberData);
                        }
                    }

                    resultEmbed
                        .setTitle('🎉 HEIST SUCCESSFUL! 🎉')
                        .setDescription(`💰 The heist was an absolute masterclass! Your crew successfully compromised the security vaults of **${victimUser.username}**!`)
                        .addFields(
                            { name: '💵 Total Vault Looted', value: `$${totalStolen.toLocaleString()}`, inline: true },
                            { name: '👥 Split Per Member', value: `$${splitAmount.toLocaleString()}`, inline: true },
                            { name: '🎒 Winning Crew', value: crewIds.map(id => `<@${id}>`).join(', ') }
                        )
                        .setColor(0x2ecc71);

                } else {
                    // Fail State: Fine every single crew member 
                    const fineLogs = [];

                    for (const memberId of crewIds) {
                        const memberData = await getEconomyData(client, guildId, memberId);
                        if (memberData) {
                            const currentWallet = typeof memberData.wallet === 'number' ? memberData.wallet : 0;
                            const fine = Math.floor(currentWallet * FINE_PERCENTAGE);

                            memberData.wallet = Math.max(0, currentWallet - fine);
                            memberData.lastBankrob = Date.now();
                            await setEconomyData(client, guildId, memberId, memberData);

                            fineLogs.push(`<@${memberId}>: fined **$${fine.toLocaleString()}**`);
                        }
                    }

                    resultEmbed
                        .setTitle('👮 HEIST FAILED! 👮')
                        .setDescription(`🚨 **The silent alarm was tripped!** High-speed patrol cruisers cut off your escape routes. The entire heist crew was arrested and fined!`)
                        .addFields(
                            { name: '⛓️ Legal Penalties Applied', value: fineLogs.join('\n') }
                        )
                        .setColor(0xe74c3c);
                }

                const hoursLeft = Math.floor(BANKROB_COOLDOWN / (1000 * 60 * 60));
                resultEmbed.setTimestamp().setFooter({ text: `All participating crew members have been put on an ${hoursLeft}-hour cooldown.` });

                // Remove components & display final status card
                await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed], components: [] });

            } catch (err) {
                console.error('[Bankrob Execution Lifecycle Critical Crash]:', err);
            }
        });

    }, { command: 'bankrob' })
};
