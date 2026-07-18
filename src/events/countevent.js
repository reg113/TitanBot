import { ChannelType } from 'discord.js';
import { 
  getCountingGameConfig, 
  isValidCountingMessage, 
  recordCorrectCount, 
  resetCountingGame 
} from '../services/countingGameService.js'; // ⚠️ Double check this path matches your project structure
import { logger } from '../utils/logger.js';

export default {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bots, direct messages, or messages outside of a text channel
    if (message.author.bot || !message.guild || message.channel.type !== ChannelType.GuildText) return;

    try {
      const guildId = message.guildId;
      const config = await getCountingGameConfig(message.client, guildId);

      // If the game isn't enabled or this isn't the assigned counting channel, ignore the message completely
      if (!config || !config.enabled || message.channelId !== config.channelId) return;

      // 1. Check if the same user is trying to count twice in a row
      const isDoubleCount = config.lastUserId === message.author.id;

      // 2. Use your service function to check if the count matches the expected system value
      const isValid = isValidCountingMessage(message.content, config);

      // --- WRONG COUNT OR DOUBLE COUNT ---
      if (!isValid || isDoubleCount) {
        // React with an X emoji
        await message.react('❌').catch(() => {});

        // Reset the database sequence back to 1 using your service
        await resetCountingGame(message.client, guildId, 1);

        let failureReason = 'entered the wrong number!';
        if (isDoubleCount) {
          failureReason = 'tried to count twice in a row!';
        }

        // Announce the mistake in chat
        return await message.channel.send({
          content: `💥 **${message.author.username}** ${failureReason} The streak has been broken. Start again at **1**!`,
        });
      }

      // --- RIGHT COUNT ---
      // React with a skull emoji
      await message.react('💀').catch(() => {});

      // Update the streaks, database state, and leaderboard using your service
      await recordCorrectCount(message.client, guildId, message.author.id);

    } catch (error) {
      logger.error('Error executing counting game message handler:', error);
    }
  },
};
