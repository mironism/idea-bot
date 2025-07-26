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

  if (req.method !== 'POST') {
    return res.status(405).json(Utils.createErrorResponse(new Error('Method not allowed'), 405));
  }

  try {
    Utils.validateEnvironmentVariables();

    const { ideaId, ideaText, skipCategoryCreation } = req.body;

    if (!ideaId || !ideaText) {
      return res.status(400).json(
        Utils.createErrorResponse(new Error('Missing required fields: ideaId, ideaText'), 400)
      );
    }

    Utils.logWithTimestamp(`Enrich request: ideaId=${ideaId}, text_length=${ideaText.length}`);

    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Get existing categories from Notion
    let existingCategories = [];
    try {
      existingCategories = await notionClient.getCategories();
      Utils.logWithTimestamp(`Found ${existingCategories.length} existing categories`);
    } catch (error) {
      Utils.logWithTimestamp(`Warning: Could not fetch categories: ${error.message}`, 'warn');
    }

    // Generate AI enrichment with categorization
    let enrichmentResult;
    try {
      enrichmentResult = await openaiClient.enrichIdea(ideaText, existingCategories);
      
      if (!enrichmentResult.success) {
        throw new Error('AI enrichment failed');
      }

      Utils.logWithTimestamp(`AI enrichment completed for ${ideaId}`);
    } catch (error) {
      Utils.logWithTimestamp(`Enrichment error: ${error.message}`, 'error');
      return res.status(500).json(
        Utils.createErrorResponse(new Error(`AI enrichment failed: ${error.message}`), 500)
      );
    }

    const { enrichedIdea } = enrichmentResult;

    // Handle category creation if needed
    let finalCategory = enrichedIdea.category.name;
    if (!skipCategoryCreation && enrichedIdea.category.confidence >= 0.7) {
      const categoryExists = existingCategories.some(
        cat => cat.name.toLowerCase() === enrichedIdea.category.name.toLowerCase()
      );

      if (!categoryExists) {
        try {
          const addResult = await notionClient.addCategory(enrichedIdea.category.name);
          if (addResult.success) {
            Utils.logWithTimestamp(`New category created: ${enrichedIdea.category.name}`);
          }
        } catch (error) {
          Utils.logWithTimestamp(`Failed to create category: ${error.message}`, 'warn');
          // Continue with enrichment even if category creation fails
        }
      }
    }

    // Update Notion entry with enrichment data
    try {
      await notionClient.updateIdeaEntry(ideaId, {
        briefJson: enrichedIdea,
        category: finalCategory,
        confidence: enrichedIdea.category.confidence,
        status: 'Enriched',
      });

      Utils.logWithTimestamp(`Notion entry updated with enrichment: ${ideaId}`);
    } catch (error) {
      Utils.logWithTimestamp(`Failed to update Notion: ${error.message}`, 'error');
      return res.status(500).json(
        Utils.createErrorResponse(new Error(`Failed to save enrichment: ${error.message}`), 500)
      );
    }

    // Prepare response data
    const responseData = {
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
      costs: {
        tokens_used: enrichmentResult.tokens,
        estimated_cost: enrichmentResult.cost,
      },
      status: 'enriched',
      notionUrl: `https://notion.so/${ideaId.replace(/-/g, '')}`,
    };

    Utils.logWithTimestamp(`Enrichment completed successfully: ${ideaId}`);
    return res.status(200).json(Utils.createSuccessResponse(responseData));

  } catch (error) {
    Utils.logWithTimestamp(`Enrich-lite error: ${error.message}`, 'error');
    return res.status(500).json(Utils.createErrorResponse(error, 500));
  }
}; 