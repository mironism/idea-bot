require('dotenv').config();
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

  if (req.method !== 'PATCH') {
    return res.status(405).json(Utils.createErrorResponse(new Error('Method not allowed'), 405));
  }

  try {
    Utils.validateEnvironmentVariables();

    const { ideaId, clarification, action } = req.body;

    if (!ideaId) {
      return res.status(400).json(
        Utils.createErrorResponse(new Error('Missing required field: ideaId'), 400)
      );
    }

    if (!action || !['add_detail', 'generate_question', 'confirm'].includes(action)) {
      return res.status(400).json(
        Utils.createErrorResponse(new Error('Invalid action. Must be: add_detail, generate_question, or confirm'), 400)
      );
    }

    Utils.logWithTimestamp(`Clarify request: ideaId=${ideaId}, action=${action}`);

    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Get existing idea from Notion
    let existingIdea;
    try {
      // For now, we'll work with the assumption that the idea content is in rawText
      // In a full implementation, you'd retrieve the page from Notion
      existingIdea = {
        id: ideaId,
        rawText: clarification || '', // Simplified for this implementation
      };
    } catch (error) {
      return res.status(404).json(
        Utils.createErrorResponse(new Error('Idea not found'), 404)
      );
    }

    let responseData = {};

    switch (action) {
      case 'add_detail':
        if (!clarification) {
          return res.status(400).json(
            Utils.createErrorResponse(new Error('Missing clarification text'), 400)
          );
        }

        // Combine original idea with clarification
        const enhancedText = `${existingIdea.rawText}\n\nAdditional details: ${clarification}`;
        
        // Update Notion entry
        await notionClient.updateIdeaEntry(ideaId, {
          rawText: enhancedText,
        });

        Utils.logWithTimestamp(`Idea clarified: ${ideaId}`);

        responseData = {
          ideaId,
          updatedContent: enhancedText,
          status: 'clarified',
          nextStep: 'confirm',
          message: 'Clarification added successfully',
        };
        break;

      case 'generate_question':
        // Generate a new clarifying question based on current content
        try {
          const questionResult = await openaiClient.generateClarifyingQuestion(
            existingIdea.rawText
          );

          if (questionResult.success) {
            responseData = {
              ideaId,
              question: questionResult.question,
              status: 'awaiting_clarification',
              nextStep: 'add_detail',
            };
          } else {
            throw new Error('Question generation failed');
          }
        } catch (error) {
          return res.status(500).json(
            Utils.createErrorResponse(new Error(`Failed to generate question: ${error.message}`), 500)
          );
        }
        break;

      case 'confirm':
        // Mark idea as ready for enrichment
        await notionClient.updateIdeaEntry(ideaId, {
          status: 'Ready for Enrichment',
        });

        responseData = {
          ideaId,
          status: 'confirmed',
          nextStep: 'enrich',
          message: 'Idea confirmed and ready for AI enrichment',
          notionUrl: `https://notion.so/${ideaId.replace(/-/g, '')}`,
        };

        Utils.logWithTimestamp(`Idea confirmed for enrichment: ${ideaId}`);
        break;
    }

    return res.status(200).json(Utils.createSuccessResponse(responseData));

  } catch (error) {
    Utils.logWithTimestamp(`Clarify error: ${error.message}`, 'error');
    return res.status(500).json(Utils.createErrorResponse(error, 500));
  }
}; 