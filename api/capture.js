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
    // Validate environment variables
    Utils.validateEnvironmentVariables();

    const { type, content, attachments = [], metadata = {} } = req.body;

    if (!type || !content) {
      return res.status(400).json(
        Utils.createErrorResponse(new Error('Missing required fields: type, content'), 400)
      );
    }

    Utils.logWithTimestamp(`Capture request: type=${type}, content_length=${content.length}`);

    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    let processedContent = content;
    let processedAttachments = attachments;
    let ideaTitle = 'New Idea';

    // Handle different content types
    switch (type) {
      case 'text':
        processedContent = Utils.sanitizeInput(content);
        ideaTitle = Utils.truncateWithEllipsis(processedContent, 50);
        break;

      case 'voice':
        try {
          Utils.logWithTimestamp('Processing voice content');
          
          // Expect content to be a file URL or buffer info
          if (typeof content === 'string' && Utils.isValidUrl(content)) {
            // Download and transcribe
            const fileData = await openaiClient.downloadFile(content);
            const transcription = await openaiClient.transcribeAudio(fileData.buffer);
            
            if (!transcription.success) {
              throw new Error('Voice transcription failed');
            }

            processedContent = transcription.text;
            ideaTitle = Utils.truncateWithEllipsis(processedContent, 50);

            // Add original voice file as attachment
            processedAttachments.push({
              type: 'audio',
              url: content,
              name: 'voice_message.ogg',
              size: fileData.size,
            });

            Utils.logWithTimestamp(`Voice transcribed: ${transcription.text.length} chars`);
          } else {
            throw new Error('Invalid voice content format');
          }
        } catch (error) {
          Utils.logWithTimestamp(`Voice processing error: ${error.message}`, 'error');
          return res.status(500).json(
            Utils.createErrorResponse(new Error(`Voice processing failed: ${error.message}`), 500)
          );
        }
        break;

      case 'file':
        // Handle file attachments
        processedContent = metadata.caption || content || 'File attachment';
        ideaTitle = `File: ${metadata.filename || 'attachment'}`;
        break;

      default:
        return res.status(400).json(
          Utils.createErrorResponse(new Error(`Unsupported content type: ${type}`), 400)
        );
    }

    // Create initial idea entry in Notion
    const ideaData = {
      title: ideaTitle,
      rawText: processedContent,
      attachments: processedAttachments,
      status: 'Captured',
    };

    const notionEntry = await notionClient.createIdeaEntry(ideaData);
    const ideaId = notionEntry.id;

    Utils.logWithTimestamp(`Idea captured in Notion: ${ideaId}`);

    // Generate clarifying question
    let clarifyingQuestion = null;
    try {
      const questionResult = await openaiClient.generateClarifyingQuestion(processedContent);
      if (questionResult.success) {
        clarifyingQuestion = questionResult.question;
        Utils.logWithTimestamp(`Clarifying question generated: ${clarifyingQuestion.length} chars`);
      }
    } catch (error) {
      Utils.logWithTimestamp(`Question generation failed: ${error.message}`, 'warn');
      // Continue without clarifying question
    }

    // Return success response
    const responseData = {
      ideaId,
      notionUrl: `https://notion.so/${ideaId.replace(/-/g, '')}`,
      title: ideaTitle,
      processedContent,
      attachments: processedAttachments,
      clarifyingQuestion,
      status: 'captured',
      nextStep: clarifyingQuestion ? 'clarify' : 'enrich',
    };

    Utils.logWithTimestamp(`Capture completed successfully: ${ideaId}`);
    return res.status(200).json(Utils.createSuccessResponse(responseData));

  } catch (error) {
    Utils.logWithTimestamp(`Capture error: ${error.message}`, 'error');
    
    if (error.message.includes('Missing required environment variables')) {
      return res.status(500).json(
        Utils.createErrorResponse(new Error('Server configuration error'), 500)
      );
    }

    return res.status(500).json(
      Utils.createErrorResponse(error, 500)
    );
  }
}; 