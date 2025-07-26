require('dotenv').config();
const TelegramClient = require('../../lib/telegram');
const NotionClient = require('../../lib/notion');
const OpenAIClient = require('../../lib/openai');
const Utils = require('../../lib/utils');
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    Utils.validateEnvironmentVariables();

    const update = req.body;
    
    if (!Utils.isValidTelegramUpdate(update)) {
      return res.status(400).json({ error: 'Invalid Telegram update' });
    }

    const telegramClient = new TelegramClient();
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, telegramClient, notionClient, openaiClient);
      return res.status(200).json({ ok: true });
    }

    // Handle regular messages
    const message = update.message;
    const userInfo = telegramClient.extractUserInfo(message);
    const messageType = Utils.determineMessageType(message);

    Utils.logWithTimestamp(`Message from ${userInfo.userId}: type=${messageType}`);

    // Handle commands
    if (message.text && message.text.startsWith('/')) {
      await handleCommand(message, telegramClient, notionClient, openaiClient);
      return res.status(200).json({ ok: true });
    }

    // Handle idea capture
    await handleIdeaCapture(message, telegramClient, notionClient, openaiClient);
    
    return res.status(200).json({ ok: true });

  } catch (error) {
    Utils.logWithTimestamp(`Webhook error: ${error.message}`, 'error');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleCommand(message, telegramClient, notionClient, openaiClient) {
  const chatId = message.chat.id;
  const command = message.text.toLowerCase().split(' ')[0];
  const userInfo = telegramClient.extractUserInfo(message);

  switch (command) {
    case '/start':
      await telegramClient.sendMessage(
        chatId, 
        telegramClient.formatWelcomeMessage()
      );
      break;

    case '/help':
      const helpMessage = `🤖 <b>Idea Vault Bot Commands</b>

<b>Basic Usage:</b>
• Send any text, voice, or file with your idea
• I'll ask a clarifying question
• Confirm to get AI analysis and Notion storage

<b>Commands:</b>
• /start - Show welcome message
• /help - Show this help
• /stats - Show statistics (admin only)

<b>Supported Content:</b>
• 📝 Text ideas
• 🎤 Voice messages (≤30s)
• 📎 Images, PDFs, documents
• 🔗 URLs in text

Just start sharing your ideas! 💡`;

      await telegramClient.sendMessage(chatId, helpMessage);
      break;

    case '/stats':
      if (!telegramClient.isAdmin(userInfo.userId)) {
        await telegramClient.sendMessage(
          chatId, 
          '❌ Access denied. This command is for administrators only.'
        );
        return;
      }

      try {
        const stats = await notionClient.getIdeaStats();
        const costs = openaiClient.getCostSummary();
        const statsMessage = telegramClient.formatStatsMessage(stats, costs);
        
        await telegramClient.sendMessage(chatId, statsMessage);
      } catch (error) {
        await telegramClient.sendMessage(
          chatId, 
          '❌ Failed to retrieve statistics. Please try again later.'
        );
      }
      break;

    default:
      await telegramClient.sendMessage(
        chatId, 
        'Unknown command. Send /help for available commands.'
      );
  }
}

async function handleIdeaCapture(message, telegramClient, notionClient, openaiClient) {
  const chatId = message.chat.id;
  const messageType = Utils.determineMessageType(message);

  try {
    let ideaData = {
      type: messageType,
      content: '',
      attachments: [],
      metadata: {},
    };

    // Process different message types
    switch (messageType) {
      case 'text':
        ideaData.content = message.text;
        break;

      case 'voice':
        if (message.voice.duration > 30) {
          await telegramClient.sendMessage(
            chatId, 
            '⚠️ Voice message too long. Please keep it under 30 seconds to manage costs.'
          );
          return;
        }

        const voiceFile = await telegramClient.downloadFile(message.voice.file_id);
        ideaData.content = voiceFile.url;
        ideaData.metadata = {
          duration: message.voice.duration,
          fileSize: message.voice.file_size,
        };
        break;

      case 'photo':
        const photo = message.photo[message.photo.length - 1]; // Get highest resolution
        const photoFile = await telegramClient.downloadFile(photo.file_id);
        
        ideaData.type = 'file';
        ideaData.content = message.caption || 'Image attachment';
        ideaData.attachments = [{
          type: 'image',
          url: photoFile.url,
          name: 'image.jpg',
          size: photo.file_size,
        }];
        break;

      case 'document':
        const docFile = await telegramClient.downloadFile(message.document.file_id);
        
        ideaData.type = 'file';
        ideaData.content = message.caption || `Document: ${message.document.file_name}`;
        ideaData.attachments = [{
          type: 'document',
          url: docFile.url,
          name: message.document.file_name,
          size: message.document.file_size,
        }];
        break;

      default:
        await telegramClient.sendMessage(
          chatId, 
          'Sorry, I can only process text, voice messages, images, and documents right now.'
        );
        return;
    }

    // Send processing message
    const processingMsg = await telegramClient.sendMessage(
      chatId, 
      '🔄 Processing your idea...'
    );

    // Call capture API endpoint
    const captureResponse = await axios.post(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/capture`, ideaData);
    
    if (!captureResponse.data.success) {
      throw new Error('Capture API failed');
    }

    const captureData = captureResponse.data.data;

    // Delete processing message
    try {
      await telegramClient.bot.deleteMessage(chatId, processingMsg.message_id);
    } catch (e) {
      // Ignore deletion errors
    }

    // Send clarifying question if available
    if (captureData.clarifyingQuestion) {
      const questionMessage = `💡 <b>Idea captured!</b>

<b>Your idea:</b> ${Utils.truncateWithEllipsis(captureData.processedContent, 200)}

<b>Quick question to improve it:</b>
${captureData.clarifyingQuestion}`;

      const keyboard = telegramClient.createInlineKeyboard([
        [
          { text: '✍️ Add Details', callback_data: `clarify_${captureData.ideaId}` },
          { text: '👍 Skip & Save', callback_data: `skip_${captureData.ideaId}` },
        ],
      ]);

      await telegramClient.sendMessage(chatId, questionMessage, keyboard);
    } else {
      // No clarifying question, proceed directly to enrichment
      await processEnrichment(captureData.ideaId, captureData.processedContent, chatId, telegramClient);
    }

  } catch (error) {
    Utils.logWithTimestamp(`Idea capture error: ${error.message}`, 'error');
    
    const errorResponse = telegramClient.formatErrorMessage(error);
    await telegramClient.sendMessage(chatId, errorResponse);
  }
}

async function handleCallbackQuery(callbackQuery, telegramClient, notionClient, openaiClient) {
  const chatId = callbackQuery.message.chat.id;
  const callbackData = Utils.parseCallbackData(callbackQuery.data);
  
  try {
    // Acknowledge the callback query
    await telegramClient.bot.answerCallbackQuery(callbackQuery.id);

    switch (callbackData.action) {
      case 'clarify':
        await telegramClient.sendMessage(
          chatId,
          '✍️ Please send me additional details about your idea:'
        );
        // Store the idea ID for the next message (in a real app, you'd use a session store)
        break;

      case 'skip':
        await processEnrichment(callbackData.ideaId, 'Idea content', chatId, telegramClient);
        break;

      case 'ok':
        await processEnrichment(callbackData.ideaId, 'Idea content', chatId, telegramClient);
        break;

      case 'cancel':
        await telegramClient.sendMessage(
          chatId,
          '❌ Idea capture cancelled. Send me a new idea anytime!'
        );
        break;

      case 'retry':
        await telegramClient.sendMessage(
          chatId,
          '🔄 Retrying... Please wait a moment.'
        );
        // Implement retry logic based on the specific action
        break;
    }

  } catch (error) {
    Utils.logWithTimestamp(`Callback query error: ${error.message}`, 'error');
    await telegramClient.sendMessage(
      chatId,
      '❌ An error occurred. Please try again.'
    );
  }
}

async function processEnrichment(ideaId, ideaText, chatId, telegramClient) {
  try {
    // Send enrichment started message
    const enrichingMsg = await telegramClient.sendMessage(
      chatId,
      '🔎 Researching & categorizing your idea...'
    );

    // Call enrichment API
    const enrichResponse = await axios.post(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/enrich-lite`, {
      ideaId,
      ideaText,
    });

    if (!enrichResponse.data.success) {
      throw new Error('Enrichment API failed');
    }

    const enrichData = enrichResponse.data.data;

    // Delete enriching message
    try {
      await telegramClient.bot.deleteMessage(chatId, enrichingMsg.message_id);
    } catch (e) {
      // Ignore deletion errors
    }

    // Format success message
    const successMessage = `✅ <b>Idea Saved & Enriched!</b>

🏷️ <b>Category:</b> ${enrichData.enrichment.category.name}
📊 <b>Confidence:</b> ${(enrichData.enrichment.category.confidence * 100).toFixed(0)}%

📝 <b>Summary:</b>
${enrichData.enrichment.summary}

🏢 <b>Key Competitors:</b>
${enrichData.enrichment.competitors.slice(0, 3).map(c => `• ${c.name}: ${c.one_line}`).join('\n')}

💰 <b>Market Size:</b> ${enrichData.enrichment.market_analysis.size_estimate}

🚀 <b>Next Step:</b>
${enrichData.enrichment.next_step}

<i>${enrichData.enrichment.disclaimer}</i>

<a href="${enrichData.notionUrl}">📋 View in Notion</a>`;

    await telegramClient.sendMessage(chatId, successMessage);

    Utils.logWithTimestamp(`Enrichment completed for ${ideaId}`);

  } catch (error) {
    Utils.logWithTimestamp(`Enrichment error: ${error.message}`, 'error');
    
    const errorResponse = telegramClient.formatErrorMessage(
      error, 
      'enrich', 
      ideaId
    );
    
    if (typeof errorResponse === 'object') {
      await telegramClient.sendMessage(chatId, errorResponse.text, errorResponse.keyboard);
    } else {
      await telegramClient.sendMessage(chatId, errorResponse);
    }
  }
} 