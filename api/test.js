export default async function handler(req, res) {
  console.log('TEST ENDPOINT CALLED');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Test basic operations
    console.log('Testing environment variables...');
    const hasTokens = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.OPENAI_API_KEY && !!process.env.NOTION_API_KEY;
    console.log('Environment variables exist:', hasTokens);
    
    console.log('Testing module imports...');
    
    // Try importing our modules one by one
    const Utils = require('../lib/utils');
    console.log('Utils imported successfully');
    
    const TelegramClient = require('../lib/telegram');
    console.log('TelegramClient imported successfully');
    
    const NotionClient = require('../lib/notion');
    console.log('NotionClient imported successfully');
    
    const OpenAIClient = require('../lib/openai');
    console.log('OpenAIClient imported successfully');
    
    console.log('Testing client instantiation...');
    
    const telegramClient = new TelegramClient();
    console.log('TelegramClient instantiated successfully');
    
    const notionClient = new NotionClient();
    console.log('NotionClient instantiated successfully');
    
    const openaiClient = new OpenAIClient();
    console.log('OpenAIClient instantiated successfully');
    
    return res.status(200).json({ 
      success: true, 
      message: 'All tests passed!',
      hasTokens 
    });
    
  } catch (error) {
    console.error('TEST ERROR:', error);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: 'Test failed',
      message: error.message,
      stack: error.stack
    });
  }
} 