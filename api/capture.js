require('dotenv').config();
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
    return res.status(405).json(Utils.createErrorResponse(new Error('Method not allowed'), 405));
  }

  try {
    console.log('📨 Capture API called:', JSON.stringify(req.body, null, 2));

    // Validate request body
    const { type, content, attachments = [], metadata = {} } = req.body;

    if (!type || !content) {
      return res.status(400).json(Utils.createErrorResponse(new Error('Missing required fields: type, content'), 400));
    }

    // Validate supported types
    const supportedTypes = ['text', 'voice', 'file'];
    if (!supportedTypes.includes(type)) {
      return res.status(400).json(Utils.createErrorResponse(new Error(`Unsupported type: ${type}`), 400));
    }

    // Initialize clients
    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    let processedContent = content;
    let processedAttachments = attachments;

    // Process voice content if needed
    if (type === 'voice' && content.startsWith('http')) {
      try {
        const fileData = await openaiClient.downloadFile(content);
        const transcription = await openaiClient.transcribeAudio(fileData.buffer);
        
        if (transcription.success) {
          processedContent = transcription.text;
          processedAttachments = [{
            type: 'audio',
            url: content,
            name: 'voice_message.ogg',
            size: fileData.size,
          }, ...processedAttachments];
        } else {
          throw new Error('Voice transcription failed');
        }
      } catch (error) {
        return res.status(500).json(Utils.createErrorResponse(error, 500));
      }
    }

    // Generate AI title
    let ideaTitle = Utils.truncateWithEllipsis(processedContent, 50); // Fallback
    try {
      const titleResult = await openaiClient.generateIdeaTitle(processedContent);
      if (titleResult.success) {
        ideaTitle = titleResult.title;
      }
    } catch (error) {
      console.log('⚠️ AI title generation failed, using fallback:', error.message);
    }

    // Create idea in Notion
    const ideaData = {
      title: ideaTitle,
      rawText: processedContent,
      attachments: processedAttachments,
      status: 'Captured',
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaData);
    console.log('💾 Idea saved to Notion:', notionEntry.id);

    // Generate clarifying question
    let clarifyingQuestion = null;
    try {
      const questionResult = await openaiClient.generateClarifyingQuestion(processedContent);
      if (questionResult.success) {
        clarifyingQuestion = questionResult.question;
      }
    } catch (error) {
      console.log('⚠️ Clarifying question failed:', error.message);
      // Continue without clarifying question
    }

    // Return success response
    const responseData = {
      ideaId: notionEntry.id,
      title: ideaData.title,
      notionUrl: `https://notion.so/${notionEntry.id.replace(/-/g, '')}`,
      clarifyingQuestion: clarifyingQuestion,
      nextStep: clarifyingQuestion ? 'clarify' : 'enrich',
      status: 'captured'
    };

    return res.status(200).json(Utils.createSuccessResponse(responseData));

  } catch (error) {
    console.error('❌ Capture API error:', error);
    return res.status(500).json(Utils.createErrorResponse(error, 500));
  }
}; 