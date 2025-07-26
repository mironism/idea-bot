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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TEMPORARILY HANDLE EVERYTHING AS TELEGRAM WEBHOOK
  console.log('🤖 RAW REQUEST BODY:', JSON.stringify(req.body, null, 2));
  console.log('🤖 REQUEST HEADERS:', JSON.stringify(req.headers, null, 2));
  
  try {
    const update = req.body;
    
    // Basic validation
    if (!update) {
      console.error('❌ No request body');
      return res.status(400).json({ error: 'No request body' });
    }

    console.log('✅ Got update, trying to find message...');

    // Find message and chat ID
    let message = null;
    let chatId = null;

    if (update.message) {
      message = update.message;
      chatId = message.chat?.id;
      console.log('✅ Found message:', message.text || 'non-text');
    } else {
      console.log('❌ No message field in update');
      return res.status(200).json({ ok: true, message: 'No message to process' });
    }

    if (!chatId) {
      console.error('❌ No chat ID found');
      return res.status(400).json({ error: 'No chat ID' });
    }

    console.log(`✅ Processing message from chat ${chatId}`);

    // Initialize Telegram client
    const TelegramClient = require('../lib/telegram');
    const telegramClient = new TelegramClient();

    // Send immediate response
    console.log('📤 Sending processing message...');
    await telegramClient.sendMessage(chatId, '🔄 Processing your idea...');
    console.log('✅ Processing message sent');

    // For now, just send a simple response
    await telegramClient.sendMessage(chatId, '✅ Test successful! Your message was: ' + (message.text || 'non-text message'));
    console.log('✅ Response sent');

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    console.error('❌ ERROR STACK:', error.stack);
    
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}; 