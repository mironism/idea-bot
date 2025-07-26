require('dotenv').config();
const NotionClient = require('../lib/notion');
const OpenAIClient = require('../lib/openai');
const TelegramClient = require('../lib/telegram');
const Utils = require('../lib/utils');

module.exports = async (req, res) => {
  // Set CORS headers for API access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json(Utils.createErrorResponse(new Error('Method not allowed'), 405));
  }

  // DETECT TELEGRAM WEBHOOK vs REGULAR CAPTURE
  const isTelegramWebhook = req.body && (req.body.update_id !== undefined || req.body.message !== undefined);
  
  if (isTelegramWebhook) {
    console.log('🤖 TELEGRAM WEBHOOK detected:', JSON.stringify(req.body, null, 2));
    return handleTelegramWebhook(req, res);
  } else {
    console.log('📝 REGULAR CAPTURE detected:', JSON.stringify(req.body, null, 2));
    return handleRegularCapture(req, res);
  }
};

// Handle Telegram webhook requests
async function handleTelegramWebhook(req, res) {
  try {
    const update = req.body;
    console.log('🤖 Processing Telegram update:', JSON.stringify(update, null, 2));

    // More flexible validation - handle different types of updates
    if (!update) {
      console.error('❌ No update body received');
      return res.status(400).json({ error: 'No update body' });
    }

    // Handle different types of updates
    let message = null;
    let chatId = null;

    if (update.message) {
      message = update.message;
      chatId = message.chat.id;
    } else if (update.edited_message) {
      message = update.edited_message;
      chatId = message.chat.id;
    } else if (update.callback_query) {
      // Handle callback queries (inline keyboard responses)
      message = update.callback_query.message;
      chatId = update.callback_query.message.chat.id;
    } else {
      console.log('⚠️ Unsupported update type:', Object.keys(update));
      // Return 200 to acknowledge the update but don't process it
      return res.status(200).json({ ok: true, message: 'Update acknowledged but not processed' });
    }

    if (!message || !chatId) {
      console.error('❌ No valid message or chat ID found');
      return res.status(400).json({ error: 'Invalid message structure' });
    }

    console.log(`✅ Processing message from chat ${chatId}`);

    // Initialize clients
    const telegramClient = new TelegramClient();
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Send processing message FIRST
    try {
      await telegramClient.sendMessage(chatId, '🔄 Processing your idea...');
    } catch (error) {
      console.error('❌ Failed to send processing message:', error);
      // Continue processing even if this fails
    }

    // Determine message type and content
    let content = '';
    let attachments = [];

    if (message.text) {
      content = message.text;
      console.log('Text message:', content);
    } else if (message.voice) {
      // Handle voice
      const voiceFile = await telegramClient.downloadFile(message.voice.file_id);
      const fileData = await openaiClient.downloadFile(voiceFile.url);
      const transcription = await openaiClient.transcribeAudio(fileData.buffer);

      if (transcription.success) {
        content = transcription.text;
        attachments.push({
          type: 'audio',
          url: voiceFile.url,
          name: 'voice_message.ogg',
          size: message.voice.file_size,
        });
        console.log('Voice transcribed:', content);
      } else {
        throw new Error('Voice transcription failed');
      }
    } else {
      content = 'Unsupported message type';
    }

    // Create idea in Notion
    const ideaData = {
      title: Utils.truncateWithEllipsis(content, 50),
      rawText: content,
      attachments: attachments,
      status: 'Captured',
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaData);
    console.log('Idea saved to Notion:', notionEntry.id);

    // Generate clarifying question
    let clarifyingQuestion = null;
    try {
      const questionResult = await openaiClient.generateClarifyingQuestion(content);
      if (questionResult.success) {
        clarifyingQuestion = questionResult.question;
      }
    } catch (error) {
      console.log('Clarifying question failed:', error.message);
    }

    // Send success response to user
    let responseText = `✅ <b>Idea captured!</b>\n\n`;
    responseText += `<b>Title:</b> ${ideaData.title}\n`;
    responseText += `<b>Notion:</b> <a href="https://notion.so/${notionEntry.id.replace(/-/g, '')}">View in Notion</a>\n\n`;

    if (clarifyingQuestion) {
      responseText += `<b>💡 Quick question:</b> ${clarifyingQuestion}`;
    } else {
      responseText += `Your idea has been saved! You can now send another idea or check your Notion database.`;
    }

    await telegramClient.sendMessage(chatId, responseText);

    console.log('✅ Telegram webhook processed successfully');
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('❌ Telegram webhook error:', error);

    // Try to send error message to user if we have chatId
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

    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Handle regular capture requests (existing logic)
async function handleRegularCapture(req, res) {
  try {
    // Validate environment variables
    const validationResult = Utils.validateEnvironmentVariables([
      'NOTION_API_KEY',
      'NOTION_DATABASE_ID',
      'OPENAI_API_KEY'
    ]);

    if (!validationResult.isValid) {
      return res.status(500).json(Utils.createErrorResponse(
        new Error(`Missing environment variables: ${validationResult.missing.join(', ')}`), 
        500
      ));
    }

    // Initialize clients
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Validate request body
    const { type, content, attachments = [], metadata = {} } = req.body;

    if (!type || !content) {
      return res.status(400).json(Utils.createErrorResponse(
        new Error('Type and content are required'), 
        400
      ));
    }

    if (!['text', 'voice', 'url', 'file'].includes(type)) {
      return res.status(400).json(Utils.createErrorResponse(
        new Error('Invalid type. Must be one of: text, voice, url, file'), 
        400
      ));
    }

    let processedContent = content;
    let processedAttachments = attachments;

    // Handle voice content (transcription)
    if (type === 'voice') {
      if (!content.startsWith('http')) {
        return res.status(400).json(Utils.createErrorResponse(
          new Error('Voice content must be a URL to audio file'), 
          400
        ));
      }

      try {
        const fileData = await openaiClient.downloadFile(content);
        const transcription = await openaiClient.transcribeAudio(fileData.buffer);
        
        if (!transcription.success) {
          throw new Error(transcription.error || 'Transcription failed');
        }

        processedContent = transcription.text;
        
        // Add the audio file as an attachment
        processedAttachments.push({
          type: 'audio',
          url: content,
          name: fileData.filename || 'voice_message.wav',
          size: fileData.size,
          mimeType: fileData.mimeType
        });

      } catch (error) {
        console.error('Voice transcription error:', error);
        return res.status(500).json(Utils.createErrorResponse(
          new Error(`Voice transcription failed: ${error.message}`), 
          500
        ));
      }
    }

    // Handle URL content (extract and validate)
    if (type === 'url') {
      if (!Utils.isValidUrl(content)) {
        return res.status(400).json(Utils.createErrorResponse(
          new Error('Invalid URL format'), 
          400
        ));
      }

      // Extract additional URLs from content if any
      const extractedUrls = Utils.extractUrls(content);
      processedAttachments = [
        ...processedAttachments,
        ...extractedUrls.map(url => ({
          type: 'url',
          url: url,
          name: Utils.truncateWithEllipsis(url, 50)
        }))
      ];
    }

    // Validate attachments
    if (processedAttachments.some(att => att.size && att.size > 20 * 1024 * 1024)) {
      return res.status(400).json(Utils.createErrorResponse(
        new Error('Attachment size cannot exceed 20MB'), 
        400
      ));
    }

    // Create the idea entry in Notion
    const ideaData = {
      title: Utils.truncateWithEllipsis(processedContent, 100),
      rawText: processedContent,
      type: type,
      attachments: processedAttachments,
      status: 'Captured',
      metadata: {
        ...metadata,
        source: 'api',
        capturedAt: new Date().toISOString()
      }
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaData);

    // Generate a clarifying question (optional, best effort)
    let clarifyingQuestion = null;
    try {
      const questionResult = await openaiClient.generateClarifyingQuestion(processedContent);
      if (questionResult.success) {
        clarifyingQuestion = questionResult.question;
      }
    } catch (error) {
      console.log('Clarifying question generation failed (non-critical):', error.message);
    }

    // Return success response
    const response = {
      success: true,
      message: 'Idea captured successfully',
      data: {
        notionId: notionEntry.id,
        title: ideaData.title,
        type: type,
        status: 'Captured',
        notionUrl: `https://notion.so/${notionEntry.id.replace(/-/g, '')}`,
        clarifyingQuestion: clarifyingQuestion,
        attachments: processedAttachments.length
      },
      timestamp: new Date().toISOString()
    };

    console.log('Idea captured successfully:', {
      notionId: notionEntry.id,
      title: ideaData.title,
      type: type
    });

    return res.status(201).json(response);

  } catch (error) {
    console.error('Capture error:', error);
    
    // Return user-friendly error message
    const statusCode = error.status || 500;
    return res.status(statusCode).json(Utils.createErrorResponse(error, statusCode));
  }
} 