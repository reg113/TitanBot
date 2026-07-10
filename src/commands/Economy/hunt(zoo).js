import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ANIMALS, ANIMAL_LIST } from '../../utils/animals.js';

export default {
    category: 'Economy',
    data: new SlashCommandBuilder()
        .setName('zoo')
        .setDescription('Manage your animal collection')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your or another user\'s current animal collection')
                .addUserOption(option =>
                    option.setName('user').setDescription('View another user\'s zoo').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('bestiary')
                .setDescription('View all discoverable animals and your completion progress')
                .addUserOption(option =>
                    option.setName('user').setDescription('View another user\'s bestiary').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('star')
                .setDescription('Star an animal to protect it from /sellall')
                .addStringOption(option =>
                    option.setName('animal')
                        .setDescription('Select an animal to star')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unstar')
                .setDescription('Remove star protection from an animal')
                .addStringOption(option =>
                    option.setName('animal')
                        .setDescription('Select an animal to unstar')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('sell')
                .setDescription('Sell a specific animal from your zoo')
                .addStringOption(option =>
                    option.setName('animal')
                        .setDescription('Select an animal to sell')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount to sell (default: all of that type)')
                        .setMinValue(1)
                        .setMaxValue(1000)
                        .setRequired(false)
                )
        ),

    async autocomplete(interaction, client) {
        const focusedValue = interaction.options.getFocused();
        const subcommand = interaction.options.getSubcommand();

        const userData = await getEconomyData(client, interaction.guildId, interaction.user.id);
        const userZoo = userData.zoo || {};
        const userStarred = userData.starred || [];

        const choices = [];

        for (const animal of ANIMAL_LIST) {
            const count = userZoo[animal.id] || 0;
            if (count > 0) {
                const isStarred = userStarred.includes(animal.id);
                const starIcon = isStarred ? ' ⭐' : '';
                const label = `${animal.emoji} ${animal.name} (x${count})${starIcon}`;

                if (focusedValue === '' || label.toLowerCase().includes(focusedValue.toLowerCase())) {
                    choices.push({ name: label.substring(0, 100), value: animal.id });
                }
            }
        }

        return choices.slice(0, 25);
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'view':
                await handleView(interaction, client);
                break;
            case 'bestiary':
                await handleBestiary(interaction, client);
                break;
            case 'star':
                await handleStar(interaction, client, true);
                break;
            case 'unstar':
                await handleStar(interaction, client, false);
                break;
            case 'sell':
                await handleSell(interaction, client);
                break;
        }
    }, { command: 'zoo' })
};

// ============================================
// /zoo view - Current animals in zoo
// ============================================
async function handleView(interaction, client) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userData = await getEconomyData(client, interaction.guildId, targetUser.id);
    const userZoo = userData.zoo || {};
    const userStarred = userData.starred || [];

    let uniqueOwned = 0;
    let totalCount = 0;

    const tiers = {
        'LEGENDARY': [],
        'EPIC': [],
        'RARE': [],
        'UNCOMMON': [],
        'COMMON': []
    };

    for (const animal of ANIMAL_LIST) {
        const count = userZoo[animal.id] || 0;
        if (count > 0) {
            totalCount += count;
            uniqueOwned++;

            const isStarred = userStarred.includes(animal.id);
            const starIcon = isStarred ? '⭐' : '　'; // Full-width space for alignment
            const displayLine = `${starIcon}\`x${count}\` ${animal.emoji} ${animal.name}`;

            if (animal.maxPrice > 4000) {
                tiers['LEGENDARY'].push(displayLine);
            } else if (animal.maxPrice > 400) {
                tiers['EPIC'].push(displayLine);
            } else if (animal.maxPrice > 100) {
                tiers['RARE'].push(displayLine);
            } else if (animal.maxPrice > 35) {
                tiers['UNCOMMON'].push(displayLine);
            } else {
                tiers['COMMON'].push(displayLine);
            }
        }
    }

    const totalUniqueAnimals = ANIMAL_LIST.length;
    const completionPercent = Math.round((uniqueOwned / totalUniqueAnimals) * 100);
    const barFilled = Math.round(completionPercent / 10);
    const progressBar = '🟩'.repeat(barFilled) + '⬛'.repeat(10 - barFilled);

    const embed = createEmbed({
        title: `📋 ZOO: ${targetUser.username.toUpperCase()}`,
        color: "#2ECC71"
    })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(
            `\`\`\`yaml\n` +
            `Animals Held: ${totalCount}\n` +
            `Unique Types: ${uniqueOwned}/${totalUniqueAnimals} (${completionPercent}%)\n` +
            `\`\`\`\n` +
            `${progressBar}\n` +
            `⭐ = Protected from /sellall\n⠀`
        );

    let hasAnimals = false;

    for (const [tierName, animals] of Object.entries(tiers)) {
        if (animals.length > 0) {
            hasAnimals = true;
            embed.addFields({
                name: `✨ ${tierName}`,
                value: animals.join('\n'),
                inline: true
            });
        }
    }

    if (!hasAnimals) {
        embed.setDescription(
            `\`\`\`yaml\n` +
            `Animals Held: 0\n` +
            `Unique Types: 0/${totalUniqueAnimals} (0%)\n` +
            `\`\`\`\n` +
            `⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛\n\n` +
            `❌ No animals found. Run \`/hunt\` to start your collection.`
        );
    }

    embed.setFooter({ text: `Use /zoo star to protect • /zoo sell to sell specific animals` });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

// ============================================
// /zoo bestiary - All animals, discovered vs undiscovered
// ============================================
async function handleBestiary(interaction, client) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userData = await getEconomyData(client, interaction.guildId, targetUser.id);
    const userDiscovered = userData.discovered || [];

    const discoveredCount = userDiscovered.length;
    const totalCount = ANIMAL_LIST.length;
    const completionPercent = Math.round((discoveredCount / totalCount) * 100);
    const barFilled = Math.round(completionPercent / 10);
    const progressBar = '🟩'.repeat(barFilled) + '⬛'.repeat(10 - barFilled);

    // Tier definitions with colors
    const tierConfig = {
        'COMMON': { icon: '⬜', animals: [] },
        'UNCOMMON': { icon: '🟢', animals: [] },
        'RARE': { icon: '🔵', animals: [] },
        'EPIC': { icon: '🟣', animals: [] },
        'LEGENDARY': { icon: '🟡', animals: [] }
    };

    for (const animal of ANIMAL_LIST) {
        const isDiscovered = userDiscovered.includes(animal.id);
        const display = isDiscovered
            ? `✅ ${animal.emoji} ${animal.name}`
            : `❌ ❓ ❓ ❓ ❓`;

        if (animal.maxPrice > 4000) {
            tierConfig['LEGENDARY'].animals.push(display);
        } else if (animal.maxPrice > 400) {
            tierConfig['EPIC'].animals.push(display);
        } else if (animal.maxPrice > 100) {
            tierConfig['RARE'].animals.push(display);
        } else if (animal.maxPrice > 35) {
            tierConfig['UNCOMMON'].animals.push(display);
        } else {
            tierConfig['COMMON'].animals.push(display);
        }
    }

    // Build tier stats summary
    let tierStats = '';
    for (const [tierName, data] of Object.entries(tierConfig)) {
        const found = data.animals.filter(a => a.startsWith('✅')).length;
        const total = data.animals.length;
        const bar = '🟩'.repeat(found) + '⬛'.repeat(total - found);
        tierStats += `${data.icon} ${tierName.padEnd(10)} ${bar} ${found}/${total}\n`;
    }

    // Determine title based on completion
    let titlePrefix = '📖';
    if (completionPercent === 100) titlePrefix = '🏆';
    else if (completionPercent >= 80) titlePrefix = '🌟';
    else if (completionPercent >= 50) titlePrefix = '📜';

    const embed = createEmbed({
        title: `${titlePrefix} BESTIARY: ${targetUser.username.toUpperCase()}`,
        color: "#9B59B6",
        description:
            `\`\`\`\n` +
            `Species Discovered: ${discoveredCount}/${totalCount} (${completionPercent}%)\n\n` +
            `${tierStats}\`\`\`\n` +
            `${progressBar}\n⠀`
    })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

    for (const [tierName, data] of Object.entries(tierConfig)) {
        const found = data.animals.filter(a => a.startsWith('✅')).length;
        embed.addFields({
            name: `${data.icon} ${tierName} (${found}/${data.animals.length})`,
            value: data.animals.join('\n'),
            inline: true
        });
    }

    // Achievement message based on progress
    let footerText = '❌ = Undiscovered • Hunt to find new species!';
    if (completionPercent === 100) {
        footerText = '🏆 COMPLETIONIST! You\'ve discovered every species!';
    } else if (completionPercent >= 80) {
        footerText = '🌟 Almost there! Keep hunting for the remaining species!';
    } else if (completionPercent >= 50) {
        footerText = '📜 Halfway there! The rarest creatures still await...';
    }

    embed.setFooter({ text: footerText });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

// ============================================
// /zoo star & /zoo unstar
// ============================================
async function handleStar(interaction, client, isStarring) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const animalId = interaction.options.getString('animal');

    const userData = await getEconomyData(client, guildId, userId);
    const userZoo = userData.zoo || {};
    const userStarred = userData.starred || [];

    const animal = ANIMALS[animalId];
    if (!animal) {
        throw createError("Invalid Animal", ErrorTypes.VALIDATION, "That animal doesn't exist.");
    }

    const count = userZoo[animalId] || 0;
    if (count === 0) {
        throw createError("Not Owned", ErrorTypes.VALIDATION, `You don't have any ${animal.emoji} ${animal.name} in your zoo.`);
    }

    if (isStarring) {
        if (userStarred.includes(animalId)) {
            throw createError("Already Starred", ErrorTypes.VALIDATION, `${animal.emoji} ${animal.name} is already starred!`);
        }
        userStarred.push(animalId);
        userData.starred = userStarred;
        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, {
            content: `⭐ **Starred!** ${animal.emoji} ${animal.name} is now protected from \`/sellall\`.\nYou have \`x${count}\` in your zoo.\n\nUse \`/zoo unstar\` to remove protection.`
        });
    } else {
        const index = userStarred.indexOf(animalId);
        if (index === -1) {
            throw createError("Not Starred", ErrorTypes.VALIDATION, `${animal.emoji} ${animal.name} isn't starred.`);
        }
        userStarred.splice(index, 1);
        userData.starred = userStarred;
        await setEconomyData(client, guildId, userId, userData);

        await InteractionHelper.safeEditReply(interaction, {
            content: `❌ **Unstarred.** ${animal.emoji} ${animal.name} can now be sold with \`/sellall\`.`
        });
    }
}

// ============================================
// /zoo sell - Sell specific animal(s)
// ============================================
async function handleSell(interaction, client) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const animalId = interaction.options.getString('animal');
    const sellAmount = interaction.options.getInteger('amount');

    const userData = await getEconomyData(client, guildId, userId);
    const userZoo = userData.zoo || {};

    const animal = ANIMALS[animalId];
    if (!animal) {
        throw createError("Invalid Animal", ErrorTypes.VALIDATION, "That animal doesn't exist.");
    }

    const owned = userZoo[animalId] || 0;
    if (owned === 0) {
        throw createError("Not Owned", ErrorTypes.VALIDATION, `You don't have any ${animal.emoji} ${animal.name} to sell.`);
    }

    const amountToSell = sellAmount ? Math.min(sellAmount, owned) : owned;
    const rolledPrice = Math.floor(Math.random() * (animal.maxPrice - animal.minPrice + 1)) + animal.minPrice;
    const totalEarnings = rolledPrice * amountToSell;

    userZoo[animalId] = owned - amountToSell;
    userData.zoo = userZoo;
    userData.wallet = (userData.wallet || 0) + totalEarnings;

    await setEconomyData(client, guildId, userId, userData);

    const remaining = userZoo[animalId];

    await InteractionHelper.safeEditReply(interaction, {
        content: `💰 **Sold!** You sold **${amountToSell}x** ${animal.emoji} ${animal.name} for **$${totalEarnings.toLocaleString()}** ($${rolledPrice.toLocaleString()} each).\n` +
            (remaining > 0 ? `**Remaining:** ${remaining}x ${animal.emoji} ${animal.name}\n` : '') +
            `\n💵 **New Balance:** $${userData.wallet.toLocaleString()}`
    });
}
