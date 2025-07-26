require('dotenv').config();
const TelegramClient = require('../lib/telegram');
const NotionClient = require('../lib/notion');
const OpenAIClient = require('../lib/openai');
const Utils = require('../lib/utils');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Telegram webhook called:', JSON.stringify(req.body, null, 2));
    
    // Validate environment variables
    Utils.validateEnvironmentVariables();
    
    const update = req.body;
    
    if (!Utils.isValidTelegramUpdate(update)) {
      return res.status(400).json({ error: 'Invalid Telegram update' });
    }

    // Initialize clients
    const telegramClient = new TelegramClient();
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Simplified flow - no callback queries needed

    // Handle regular messages
    if (update.message) {
      const message = update.message;
      const userInfo = telegramClient.extractUserInfo(message);
      const messageType = Utils.determineMessageType(message);

      console.log(`📨 Message from ${userInfo.userId}: type=${messageType}`);

      // Handle commands
      if (message.text && message.text.startsWith('/')) {
        await handleCommand(message, telegramClient, notionClient, openaiClient);
        return res.status(200).json({ ok: true });
      }

      // Handle idea capture
      await handleIdeaCapture(message, telegramClient, notionClient, openaiClient);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    Utils.logWithTimestamp(`Webhook error: ${error.message}`, 'error');
    
    // Try to send error message to user if possible
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        const telegramClient = new TelegramClient();
        await telegramClient.sendMessage(
          chatId,
          `⚠️ Something went wrong: ${error.message}\n\nPlease try again.`
        );
      }
    } catch (notifyError) {
      console.error('Failed to notify user of error:', notifyError);
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// Handle bot commands
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

// Handle idea capture and processing
async function handleIdeaCapture(message, telegramClient, notionClient, openaiClient) {
  const chatId = message.chat.id;
  const messageType = Utils.determineMessageType(message);

  try {
    console.log(`🎯 Processing idea capture: ${messageType}`);
    
    // Send initial processing message
    await telegramClient.sendMessage(chatId, '🔄 Processing your idea...');

    let content = '';
    let attachments = [];

    // Process different message types
    switch (messageType) {
      case 'text':
        content = Utils.sanitizeInput(message.text);
        break;

      case 'voice':
        if (message.voice.duration > 30) {
          await telegramClient.sendMessage(
            chatId, 
            '⚠️ Voice message too long. Please keep it under 30 seconds to manage costs.'
          );
          return;
        }

        try {
          const voiceFile = await telegramClient.downloadFile(message.voice.file_id);
          const fileData = await openaiClient.downloadFile(voiceFile.url);
          const transcription = await openaiClient.transcribeAudio(fileData.buffer);
          
          if (!transcription.success) {
            throw new Error('Voice transcription failed');
          }

          content = transcription.text;
          attachments = [{
            type: 'audio',
            url: voiceFile.url,
            name: 'voice_message.ogg',
            size: message.voice.file_size,
          }];
        } catch (error) {
          throw new Error(`Voice processing failed: ${error.message}`);
        }
        break;

      case 'photo':
        const photo = message.photo[message.photo.length - 1]; // Get largest photo
        try {
          const photoFile = await telegramClient.downloadFile(photo.file_id);
          content = message.caption || '[Image with no description]';
          attachments = [{
            type: 'image',
            url: photoFile.url,
            name: 'image.jpg',
            size: photo.file_size,
          }];
        } catch (error) {
          throw new Error(`Photo processing failed: ${error.message}`);
        }
        break;

      case 'document':
        try {
          const docFile = await telegramClient.downloadFile(message.document.file_id);
          content = message.caption || `[Document: ${message.document.file_name}]`;
          attachments = [{
            type: 'document',
            url: docFile.url,
            name: message.document.file_name,
            size: message.document.file_size,
          }];
        } catch (error) {
          throw new Error(`Document processing failed: ${error.message}`);
        }
        break;

      default:
        content = 'Unsupported message type';
    }

    if (!content) {
      throw new Error('No content extracted from message');
    }

    // Generate AI title
    let ideaTitle = Utils.truncateWithEllipsis(content, 50); // Fallback
    try {
      const titleResult = await openaiClient.generateIdeaTitle(content);
      if (titleResult.success) {
        ideaTitle = titleResult.title;
      }
    } catch (error) {
      console.log('⚠️ AI title generation failed, using fallback:', error.message);
    }

    // Create idea in Notion
    const ideaData = {
      title: ideaTitle,
      rawText: content,
      attachments: attachments,
      status: 'Captured',
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaData);
    console.log('💾 Idea saved to Notion:', notionEntry.id);

    // Send initial success response
    let responseText = `✅ <b>Idea captured!</b>\n`;
    responseText += `<b>Title:</b> ${ideaData.title}\n`;
    responseText += `<b>Notion:</b> <a href="https://notion.so/${notionEntry.id.replace(/-/g, '')}">View in Notion</a>\n\n`;
    responseText += `🔎 Researching & categorizing your idea...`;

    await telegramClient.sendMessage(chatId, responseText);
    
    // Trigger enrichment directly (no clarification needed)
    await triggerEnrichment(notionEntry.id, content, telegramClient, notionClient, openaiClient, chatId);

  } catch (error) {
    console.error('❌ Idea capture error:', error);
    await telegramClient.sendMessage(
      chatId,
      `⚠️ Failed to process your idea: ${error.message}\n\nPlease try again.`
    );
  }
}

// Handle callback queries (button presses) - REMOVED since we simplified the flow

// Trigger AI enrichment process
async function triggerEnrichment(ideaId, ideaText, telegramClient, notionClient, openaiClient, chatId) {
  try {
    // Get existing categories
    const categories = await notionClient.getCategories();
    
    // Enrich the idea with AI
    const enrichmentResult = await openaiClient.enrichIdea(ideaText, categories);
    
    if (enrichmentResult.success) {
      const enrichedIdea = enrichmentResult.enrichedIdea;
      
      // Check if we need to create a new category
      if (enrichedIdea.category.confidence >= 0.7) {
        const categoryExists = categories.some(cat => 
          cat.name.toLowerCase() === enrichedIdea.category.name.toLowerCase()
        );
        
        if (!categoryExists) {
          await notionClient.addCategory(enrichedIdea.category.name);
        }
      }
      
      // Update Notion entry with enrichment
      await notionClient.updateIdeaEntry(ideaId, {
        businessPlanContent: enrichedIdea.businessPlanContent,
        category: enrichedIdea.category.name,
        confidence: enrichedIdea.category.confidence,
        status: 'Enriched'
      });
      
      // Send success message with key insights
      let successText = `✅ <b>Analysis Complete!</b>\n\n`;
      
      // Add bullet points from key insights
      if (enrichedIdea.keyInsights && enrichedIdea.keyInsights.length > 0) {
        for (const insight of enrichedIdea.keyInsights.slice(0, 5)) {
          successText += `• ${insight}\n`;
        }
        successText += `\n`;
      }
      
      successText += `<b>Category:</b> ${enrichedIdea.category.name} (${Math.round(enrichedIdea.category.confidence * 100)}% confidence)\n\n`;
      successText += `<a href="https://notion.so/${ideaId.replace(/-/g, '')}">📝 View Full Analysis in Notion</a>`;
      
      await telegramClient.sendMessage(chatId, successText);
      
    } else {
      throw new Error('AI enrichment failed');
    }
    
  } catch (error) {
    console.error('❌ Enrichment error:', error);
    await telegramClient.sendMessage(
      chatId, 
      `⚠️ AI analysis failed: ${error.message}\n\nYour idea is still saved in Notion.`
    );
  }
} 