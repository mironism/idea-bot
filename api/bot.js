require('dotenv').config();
const TelegramClient = require('../lib/telegram');
const NotionClient = require('../lib/notion');
const OpenAIClient = require('../lib/openai');
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Webhook called:', JSON.stringify(req.body, null, 2));

    const update = req.body;
    
    // Validate Telegram update
    if (!update || !update.message) {
      return res.status(400).json({ error: 'Invalid update' });
    }

    const message = update.message;
    const chatId = message.chat.id;
    
    console.log(`Processing message from chat ${chatId}`);

    // Initialize clients
    const telegramClient = new TelegramClient();
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Send processing message
    await telegramClient.sendMessage(chatId, '🔄 Processing your idea...');

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
    
    console.log('Success! Idea processed and user notified.');
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Webhook error:', error);
    
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
}; 