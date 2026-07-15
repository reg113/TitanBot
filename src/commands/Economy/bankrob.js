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
import { getItemById } from '../../config/shop/items.js';

// ==========================================
//          --- CONFIGURABLE VALUES ---
// ==========================================
const MIN_VICTIM_BANK = 1500;         
const MIN_STAKES = 500;              
const BANKROB_COOLDOWN = 8 * 60 * 60 * 1000; 

// --- PROTECTION & BYPASS CONFIG ---
const PROTECTION_ITEM_ID = 'vault_lock'; 
const LOCKPICK_ITEM_ID = 'lockpick';
const LOCKPICK_BYPASS_CHANCE = 0.35;  // 35% chance to successfully bypass the lock

// --- HEIST BALANCING MECHANICS ---
const BASE_SUCCESS_CHANCE = 0.15;     
const BONUS_SUCCESS_PER_CREW = 0.10;  
const MAX_SUCCESS_CHANCE = 0.55;      
const STEAL_PERCENTAGE = 0.20;        
const FINE_PERCENTAGE = 0.10;         
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

        if (hostId === victimUser.id) {
            throw createError("Cannot rob self", ErrorTypes.VALIDATION, "You cannot plan a bank heist against your own accounts.");
        }
        if (victimUser.bot) {
            throw createError("Cannot rob bot", ErrorTypes.VALIDATION, "The banking systems of bots are too heavily encrypted.");
        }

        const hostData = await getEconomyData(client, guildId, hostId);
        const victimData = await getEconomyData(client, guildId, victimUser.id);

        if (!hostData || !victimData) {
            throw createError("Failed to load economy data", ErrorTypes.DATABASE, "Failed to load profile details.");
        }

        // Host Cooldown Check
        const lastBankrob = hostData.lastBankrob || 0;
        if (now < lastBankrob + BANKROB_COOLDOWN) {
            const remaining = lastBankrob + BANKROB_COOLDOWN - now;
            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
            throw createError("Heist cooldown active", ErrorTypes.RATE_LIMIT, `Wait **${hours}h ${minutes}m** before organizing another heist.`);
        }

        // Host Buy-in Wallet Check
        const hostWallet = typeof hostData.wallet === 'number' ? hostData.wallet : 0;
        if (hostWallet < MIN_STAKES) {
            throw createError("Insufficient Funds", ErrorTypes.VALIDATION, `You need at least **$${MIN_STAKES.toLocaleString()}** in your wallet to fund baseline gear.`);
        }

        // Victim Bank Balance Validation
        const victimBank = typeof victimData.bank === 'number' ? victimData.bank : 0;
        if (victimBank < MIN_VICTIM_BANK) {
            throw createError("Victim too poor", ErrorTypes.VALIDATION, `${victimUser.username} does not have enough bank funds to target. (Minimum: $${MIN_VICTIM_BANK.toLocaleString()})`);
        }

        // PRE-HEIST INITIAL CHECK: If target has a lock, host MUST have a lockpick to even start the lobby
        if (victimData.vaultProtected === true) {
            const hasLockpick = (hostData.inventory?.[LOCKPICK_ITEM_ID] || 0) > 0;
            if (!hasLockpick) {
                hostData.lastBankrob = now;
                await setEconomyData(client, guildId, hostId, hostData);

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            'Heist Aborted!',
                            `🚨 Your crew scouted out ${victimUser.username}'s bank accounts but found a highly secure vault array active. You need to buy a **🕵️‍♂️ Lockpick** from the shop to attempt this breach!`
                        )
                    ]
                });
            }
        }

        // Initialize Heist Lobby Setup
        const crewIds = [hostId];

        const buildLobbyPayload = (timeRemaining = 30) => {
            const currentChance = Math.min(BASE_SUCCESS_CHANCE + (crewIds.length - 1) * BONUS_SUCCESS_PER_CREW, MAX_SUCCESS_CHANCE);
            const isTargetLocked = victimData.vaultProtected === true;

            const lobbyEmbed = new EmbedBuilder()
                .setTitle('🚨 Bank Heist In Progress!')
                .setDescription(`⚡ **${interaction.user.username}** is gathering a crew to clean out **${victimUser.username}**'s vaults!\n\n${isTargetLocked ? '⚠️ **SECURITY WARNING:** The target has a Vault Lock active. The host will attempt a bypass break when the timer hits zero!' : 'Click the button below to join the crew.'}`)
                .addFields(
                    { name: '💰 Target Value', value: `$${victimBank.toLocaleString()}`, inline: true },
                    { name: '⏱️ Commencing In', value: `\`${timeRemaining}s\``, inline: true },
                    { name: '🎯 Success Rate', value: `\`${(currentChance * 100).toFixed(0)}%\` ${isTargetLocked ? '(Pending Lockpick)' : ''}`, inline: true },
                    { name: '🎒 Active Crew', value: crewIds.map(id => `<@${id}>`).join('\n') }
                )
                .setColor(0xe74c3c);

            const joinButton = new ButtonBuilder()
                .setCustomId('heist_join')
                .setLabel(`Join Crew (${crewIds.length})`)
                .setEmoji('🎒')
                .setStyle(ButtonStyle.Danger);

            return { embeds: [lobbyEmbed], components: [new ActionRowBuilder().addComponents(joinButton)] };
        };

        await InteractionHelper.safeEditReply(interaction, buildLobbyPayload(30));
        const replyMessage = await interaction.fetchReply();
        const collector = replyMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

        collector.on('collect', async (btnInteraction) => {
            const joinerId = btnInteraction.user.id;

            if (crewIds.includes(joinerId)) {
                return await btnInteraction.reply({ content: '❌ You are already in this crew!', flags: [MessageFlags.Ephemeral] });
            }
            if (joinerId === victimUser.id) {
                return await btnInteraction.reply({ content: '❌ You cannot help rob your own accounts!', flags: [MessageFlags.Ephemeral] });
            }

            const joinerData = await getEconomyData(client, guildId, joinerId);
            if (!joinerData) {
                return await btnInteraction.reply({ content: '❌ Error loading profile.', flags: [MessageFlags.Ephemeral] });
            }

            if (now < (joinerData.lastBankrob || 0) + BANKROB_COOLDOWN) {
                return await btnInteraction.reply({ content: '❌ You are currently on a heist cooldown.', flags: [MessageFlags.Ephemeral] });
            }

            if ((typeof joinerData.wallet === 'number' ? joinerData.wallet : 0) < MIN_STAKES) {
                return await btnInteraction.reply({ content: `❌ You need at least **$${MIN_STAKES}** in your wallet to join.`, flags: [MessageFlags.Ephemeral] });
            }

            crewIds.push(joinerId);
            await btnInteraction.deferUpdate().catch(() => {});
            
            const timeElapsed = Date.now() - collector.startTime;
            const remainingSecs = Math.max(0, Math.round((collector.options.time - timeElapsed) / 1000));
            await InteractionHelper.safeEditReply(interaction, buildLobbyPayload(remainingSecs));
        });

        // Heist Final Resolution Phase
        collector.on('end', async () => {
            try {
                const freshVictimData = await getEconomyData(client, guildId, victimUser.id);
                const freshHostData = await getEconomyData(client, guildId, hostId);
                if (!freshVictimData || !freshHostData) return;

                const finalVictimBank = typeof freshVictimData.bank === 'number' ? freshVictimData.bank : 0;
                let lockpickBypassed = false;

                if (finalVictimBank < MIN_VICTIM_BANK) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [warningEmbed('Heist Cancelled', `The target's vault balance fell below requirements during planning.`)],
                        components: []
                    });
                }

                // POST-LOBBY RUNTIME CHECK: Process Lockpick sequence if target is armed
                if (freshVictimData.vaultProtected === true) {
                    const currentLockpicks = freshHostData.inventory?.[LOCKPICK_ITEM_ID] || 0;

                    if (currentLockpicks <= 0) {
                        return await InteractionHelper.safeEditReply(interaction, {
                            embeds: [warningEmbed('Heist Aborted', `🔒 The target vault is secured and the host no longer possesses a Lockpick item.`)],
                            components: []
                        });
                    }

                    // Burn the host's lockpick tool
                    freshHostData.inventory[LOCKPICK_ITEM_ID] = currentLockpicks - 1;
                    await setEconomyData(client, guildId, hostId, freshHostData);

                    // Break the target's Vault Lock array under the stress of the attempt
                    freshVictimData.vaultProtected = false;
                    await setEconomyData(client, guildId, victimUser.id, freshVictimData);

                    // Roll to see if lockpick successfully breaks the grid
                    const bypassRoll = Math.random() < LOCKPICK_BYPASS_CHANCE;
                    if (!bypassRoll) {
                        // Apply failure cooldowns to all registered crew members
                        for (const memberId of crewIds) {
                            const memberData = await getEconomyData(client, guildId, memberId);
                            if (memberData) {
                                memberData.lastBankrob = Date.now();
                                await setEconomyData(client, guildId, memberId, memberData);
                            }
                        }

                        return await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                warningEmbed(
                                    'Lockpick Snapped! Heist Failed.',
                                    `🚨 <@${hostId}> jammed their Lockpick into the grid cylinder, but the security tumbler snapped the tool! The internal vault locks held strong, alarms sounded, and the crew had to scatter empty-handed. All crew members are now on cooldown.`
                                )
                            ],
                            components: []
                        });
                    } else {
                        lockpickBypassed = true; // Bypassed! Allow execution logic to fall through
                    }
                }

                // Standard Heist Probability Resolution
                const finalSuccessChance = Math.min(BASE_SUCCESS_CHANCE + (crewIds.length - 1) * BONUS_SUCCESS_PER_CREW, MAX_SUCCESS_CHANCE);
                const isSuccessful = Math.random() < finalSuccessChance;
                const resultEmbed = new EmbedBuilder();

                if (isSuccessful) {
                    const totalStolen = Math.floor(finalVictimBank * STEAL_PERCENTAGE);
                    const splitAmount = Math.floor(totalStolen / crewIds.length);

                    freshVictimData.bank = Math.max(0, finalVictimBank - totalStolen);
                    await setEconomyData(client, guildId, victimUser.id, freshVictimData);

                    for (const memberId of crewIds) {
                        const memberData = (memberId === hostId) ? freshHostData : await getEconomyData(client, guildId, memberId);
                        if (memberData) {
                            memberData.wallet = (memberData.wallet || 0) + splitAmount;
                            memberData.lastBankrob = Date.now();
                            await setEconomyData(client, guildId, memberId, memberData);
                        }
                    }

                    resultEmbed
                        .setTitle('🎉 HEIST SUCCESSFUL! 🎉')
                        .setDescription(`💰 The vault security layout was completely compromised! Your crew successfully bypassed operations to secure the payout! ${lockpickBypassed ? '\n\n-# 🕵️‍♂️ *Note: Vault Lock was successfully bypassed with a Lockpick structure.*' : ''}`)
                        .addFields(
                            { name: '💵 Total Vault Looted', value: `$${totalStolen.toLocaleString()}`, inline: true },
                            { name: '👥 Split Per Member', value: `$${splitAmount.toLocaleString()}`, inline: true },
                            { name: '🎒 Winning Crew', value: crewIds.map(id => `<@${id}>`).join(', ') }
                        )
                        .setColor(0x2ecc71);

                } else {
                    const fineLogs = [];

                    for (const memberId of crewIds) {
                        const memberData = (memberId === hostId) ? freshHostData : await getEconomyData(client, guildId, memberId);
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
                        .setDescription(`🚨 The emergency silent alarm caught the squad deep inside the perimeter! Cruisers blocked off escape routes. The crew was intercepted and heavily fined.`)
                        .addFields({ name: '⛓️ Legal Penalties Applied', value: fineLogs.join('\n') })
                        .setColor(0xe74c3c);
                }

                const hoursLeft = Math.floor(BANKROB_COOLDOWN / (1000 * 60 * 60));
                resultEmbed.setTimestamp().setFooter({ text: `All participating crew members are on an ${hoursLeft}-hour cooldown.` });

                await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed], components: [] });

            } catch (err) {
                console.error('[Bankrob Execution Lifecycle Critical Crash]:', err);
            }
        });

    }, { command: 'bankrob' })
};
