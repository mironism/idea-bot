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
    
    // Additional environment check
    if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID || !process.env.OPENAI_API_KEY) {
      throw new Error('Missing critical environment variables');
    }

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

    // Process idea directly instead of HTTP call
    let processedContent = ideaData.content;
    let processedAttachments = ideaData.attachments;
    let ideaTitle = 'New Idea';

    // Handle different content types
    switch (ideaData.type) {
      case 'text':
        processedContent = Utils.sanitizeInput(ideaData.content);
        ideaTitle = Utils.truncateWithEllipsis(processedContent, 50);
        break;

      case 'voice':
        try {
          if (typeof ideaData.content === 'string' && Utils.isValidUrl(ideaData.content)) {
            const fileData = await openaiClient.downloadFile(ideaData.content);
            const transcription = await openaiClient.transcribeAudio(fileData.buffer);
            
            if (!transcription.success) {
              throw new Error('Voice transcription failed');
            }

            processedContent = transcription.text;
            ideaTitle = Utils.truncateWithEllipsis(processedContent, 50);

            processedAttachments.push({
              type: 'audio',
              url: ideaData.content,
              name: 'voice_message.ogg',
              size: fileData.size,
            });
          } else {
            throw new Error('Invalid voice content format');
          }
        } catch (error) {
          throw new Error(`Voice processing failed: ${error.message}`);
        }
        break;

      case 'file':
        processedContent = ideaData.metadata?.caption || ideaData.content || 'File attachment';
        ideaTitle = `File: ${ideaData.metadata?.filename || 'attachment'}`;
        break;
    }

    // Create initial idea entry in Notion
    const ideaEntryData = {
      title: ideaTitle,
      rawText: processedContent,
      attachments: processedAttachments,
      status: 'Captured',
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaEntryData);
    const ideaId = notionEntry.id;

    // Generate clarifying question
    let clarifyingQuestion = null;
    try {
      const questionResult = await openaiClient.generateClarifyingQuestion(processedContent);
      if (questionResult.success) {
        clarifyingQuestion = questionResult.question;
      }
    } catch (error) {
      // Continue without clarifying question
    }

    const captureData = {
      ideaId,
      notionUrl: `https://notion.so/${ideaId.replace(/-/g, '')}`,
      title: ideaTitle,
      processedContent,
      attachments: processedAttachments,
      clarifyingQuestion,
      status: 'captured',
      nextStep: clarifyingQuestion ? 'clarify' : 'enrich',
    };

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
      await processEnrichment(captureData.ideaId, captureData.processedContent, chatId, telegramClient, notionClient, openaiClient);
    }

  } catch (error) {
    Utils.logWithTimestamp(`Idea capture error: ${error.message}`, 'error');
    console.error('Full error details:', error);
    
    await telegramClient.sendMessage(
      chatId,
      `⚠️ <b>Something went wrong</b>\n\nError: ${error.message}\n\nPlease try again in a moment.`
    );
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
        await processEnrichment(callbackData.ideaId, 'Idea content', chatId, telegramClient, notionClient, openaiClient);
        break;

      case 'ok':
        await processEnrichment(callbackData.ideaId, 'Idea content', chatId, telegramClient, notionClient, openaiClient);
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

async function processEnrichment(ideaId, ideaText, chatId, telegramClient, notionClient, openaiClient) {
  try {
    // Send enrichment started message
    const enrichingMsg = await telegramClient.sendMessage(
      chatId,
      '🔎 Researching & categorizing your idea...'
    );

    // Get existing categories from Notion
    let existingCategories = [];
    try {
      existingCategories = await notionClient.getCategories();
    } catch (error) {
      // Continue without categories
    }

    // Generate AI enrichment with categorization
    const enrichmentResult = await openaiClient.enrichIdea(ideaText, existingCategories);
    
    if (!enrichmentResult.success) {
      throw new Error('AI enrichment failed');
    }

    const { enrichedIdea } = enrichmentResult;

    // Handle category creation if needed
    let finalCategory = enrichedIdea.category.name;
    if (enrichedIdea.category.confidence >= 0.7) {
      const categoryExists = existingCategories.some(
        cat => cat.name.toLowerCase() === enrichedIdea.category.name.toLowerCase()
      );

      if (!categoryExists) {
        try {
          await notionClient.addCategory(enrichedIdea.category.name);
        } catch (error) {
          // Continue with enrichment even if category creation fails
        }
      }
    }

    // Update Notion entry with enrichment data
    await notionClient.updateIdeaEntry(ideaId, {
      briefJson: enrichedIdea,  
      category: finalCategory,
      confidence: enrichedIdea.category.confidence,
      status: 'Enriched',
    });

    const enrichData = {
      ideaId,
      enrichment: {
        summary: enrichedIdea.summary,
        category: {
          name: finalCategory,
          confidence: enrichedIdea.category.confidence,
          reasoning: enrichedIdea.category.reasoning,
        },
        competitors: enrichedIdea.competitors,
        market_analysis: {
          size_estimate: enrichedIdea.market_size_estimate,
          cagr_estimate: enrichedIdea.cagr_pct_estimate,
        },
        business_models: enrichedIdea.likely_biz_models,
        next_step: enrichedIdea.next_step,
        disclaimer: enrichedIdea.disclaimer,
        generated_at: enrichedIdea.generated_at,
      },
      notionUrl: `https://notion.so/${ideaId.replace(/-/g, '')}`,
    };

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
    console.error('Full enrichment error details:', error);
    
    await telegramClient.sendMessage(
      chatId,
      `⚠️ <b>Enrichment failed</b>\n\nError: ${error.message}\n\nYour idea was saved, but AI analysis failed. Please try again.`
    );
  }
} 