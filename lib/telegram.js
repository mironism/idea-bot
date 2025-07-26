const TelegramBot = require('node-telegram-bot-api');

class TelegramClient {
  constructor() {
    // Don't instantiate TelegramBot in serverless environment
    // We only need it for sendMessage, which we can do via direct API calls
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.adminUserId = process.env.ADMIN_TELEGRAM_USER_ID;
    this.bot = null; // Lazy initialization
  }

  _getBot() {
    if (!this.bot) {
      this.bot = new TelegramBot(this.token, { polling: false, webHook: false });
    }
    return this.bot;
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      return await this._getBot().sendMessage(chatId, text, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async sendWithRetry(chatId, text, options = {}) {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.sendMessage(chatId, text, options);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  createInlineKeyboard(buttons) {
    return {
      reply_markup: {
        inline_keyboard: buttons,
      },
    };
  }

  createOkCancelKeyboard(ideaId) {
    return this.createInlineKeyboard([
      [
        { text: '👍 OK - Save & Enrich', callback_data: `ok_${ideaId}` },
        { text: '✖️ Cancel', callback_data: `cancel_${ideaId}` },
      ],
    ]);
  }

  createRetryKeyboard(action, ideaId) {
    return this.createInlineKeyboard([
      [
        { text: '🔄 Retry', callback_data: `retry_${action}_${ideaId}` },
        { text: '✖️ Cancel', callback_data: `cancel_${ideaId}` },
      ],
    ]);
  }

  async getFileInfo(fileId) {
    try {
      return await this._getBot().getFile(fileId);
    } catch (error) {
      console.error('Error getting file info:', error);
      throw error;
    }
  }

  getFileUrl(filePath) {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  async downloadFile(fileId) {
    try {
      const fileInfo = await this.getFileInfo(fileId);
      const fileUrl = this.getFileUrl(fileInfo.file_path);
      
      return {
        url: fileUrl,
        path: fileInfo.file_path,
        size: fileInfo.file_size,
      };
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }

  extractUserInfo(msg) {
    return {
      userId: msg.from.id,
      username: msg.from.username,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
      chatId: msg.chat.id,
    };
  }

  isAdmin(userId) {
    return this.adminUserId && userId.toString() === this.adminUserId.toString();
  }

  formatIdeaSummary(idea, brief = null) {
    let summary = `💡 <b>New Idea Captured</b>\n\n`;
    summary += `<b>Raw Text:</b>\n${idea.rawText}\n\n`;
    
    if (idea.attachments && idea.attachments.length > 0) {
      summary += `📎 <b>Attachments:</b> ${idea.attachments.length} file(s)\n\n`;
    }

    if (brief) {
      summary += `🔍 <b>AI Analysis:</b>\n`;
      summary += `Category: ${brief.category?.name || 'Unknown'}\n`;
      summary += `Summary: ${brief.summary}\n\n`;
    }

    return summary;
  }

  formatWelcomeMessage() {
    return `🚀 <b>Welcome to Idea Vault Bot!</b>

I help you capture and enrich your ideas with AI analysis.

<b>How to use:</b>
• Send me text, voice, or files with your idea
• I'll ask a clarifying question
• After you confirm, I'll research and categorize it
• Everything gets saved to your Notion database

<b>Examples:</b>
💬 "App idea: Dating app for pet owners"
🎤 Voice message describing your startup concept
📎 Image with product mockup + description

Try sending me your first idea now! 💡`;
  }

  formatStatsMessage(stats, costs) {
    return `📊 <b>Idea Vault Statistics</b>

💡 <b>Total Ideas:</b> ${stats.totalIdeas}

📈 <b>By Status:</b>
${Object.entries(stats.statusStats).map(([status, count]) => `• ${status}: ${count}`).join('\n')}

🏷️ <b>By Category:</b>
${Object.entries(stats.categoryStats).map(([category, count]) => `• ${category}: ${count}`).join('\n')}

💰 <b>Costs (24h):</b>
• Whisper: $${costs.whisperCost.toFixed(4)}
• GPT: $${costs.gptCost.toFixed(4)}
• Total: $${costs.totalCost.toFixed(4)}

<i>Last updated: ${new Date().toLocaleString()}</i>`;
  }

  formatErrorMessage(error, retryAction = null, ideaId = null) {
    let message = '⚠️ <b>Something went wrong</b>\n\n';
    message += `Error: ${error.message}\n\n`;
    
    if (retryAction && ideaId) {
      message += 'You can try again using the button below.';
      return {
        text: message,
        keyboard: this.createRetryKeyboard(retryAction, ideaId),
      };
    }
    
    return message;
  }

  sanitizeForHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  truncateText(text, maxLength = 500) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  validateAudioDuration(duration) {
    const maxDuration = 30; // 30 seconds
    return duration <= maxDuration;
  }

  getSupportedFileTypes() {
    return {
      images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],
      documents: ['pdf', 'doc', 'docx', 'txt', 'rtf'],
      audio: ['ogg', 'mp3', 'wav', 'm4a'],
    };
  }

  getFileTypeFromMime(mimeType) {
    const mimeMap = {
      'image/jpeg': 'image',
      'image/png': 'image',
      'image/gif': 'image',
      'image/bmp': 'image',
      'image/webp': 'image',
      'application/pdf': 'document',
      'application/msword': 'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
      'text/plain': 'document',
      'audio/ogg': 'audio',
      'audio/mpeg': 'audio',
      'audio/wav': 'audio',
      'audio/mp4': 'audio',
    };
    
    return mimeMap[mimeType] || 'unknown';
  }

  async deleteMessage(chatId, messageId) {
    try {
      return await this._getBot().deleteMessage(chatId, messageId);
    } catch (error) {
      console.error('Error deleting message:', error);
      // Don't throw, message deletion is not critical
    }
  }

  async answerCallbackQuery(callbackQueryId, options = {}) {
    try {
      return await this._getBot().answerCallbackQuery(callbackQueryId, options);
    } catch (error) {
      console.error('Error answering callback query:', error);
      throw error;
    }
  }
}

module.exports = TelegramClient; 