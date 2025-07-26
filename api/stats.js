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

  if (req.method !== 'GET') {
    return res.status(405).json(Utils.createErrorResponse(new Error('Method not allowed'), 405));
  }

  try {
    Utils.validateEnvironmentVariables();

    Utils.logWithTimestamp('Stats request received');

    const notionClient = new NotionClient();
    const openaiClient = new OpenAIClient();

    // Get idea statistics from Notion
    let ideaStats;
    try {
      ideaStats = await notionClient.getIdeaStats();
      Utils.logWithTimestamp(`Idea stats retrieved: ${ideaStats.totalIdeas} total ideas`);
    } catch (error) {
      Utils.logWithTimestamp(`Error fetching idea stats: ${error.message}`, 'error');
      return res.status(500).json(
        Utils.createErrorResponse(new Error(`Failed to fetch statistics: ${error.message}`), 500)
      );
    }

    // Get cost tracking data
    const costSummary = openaiClient.getCostSummary();

    // Calculate additional metrics
    const now = new Date();
    const enrichedIdeas = ideaStats.statusStats['Enriched'] || 0;
    const capturedIdeas = ideaStats.statusStats['Captured'] || 0;
    const enrichmentRate = ideaStats.totalIdeas > 0 
      ? ((enrichedIdeas / ideaStats.totalIdeas) * 100).toFixed(1)
      : '0.0';

    // Get top categories
    const topCategories = Object.entries(ideaStats.categoryStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // System health metrics
    const systemHealth = {
      status: 'operational',
      uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      last_check: now.toISOString(),
    };

    // Prepare comprehensive response
    const responseData = {
      overview: {
        total_ideas: ideaStats.totalIdeas,
        enriched_ideas: enrichedIdeas,
        captured_ideas: capturedIdeas,
        enrichment_rate: `${enrichmentRate}%`,
        total_categories: Object.keys(ideaStats.categoryStats).length,
      },
      
      status_breakdown: ideaStats.statusStats,
      
      category_breakdown: {
        all_categories: ideaStats.categoryStats,
        top_categories: topCategories,
      },

      costs: {
        whisper_cost: costSummary.whisperCost,
        gpt_cost: costSummary.gptCost,
        total_cost: costSummary.totalCost,
        last_24h: costSummary.last24h,
        cost_per_idea: ideaStats.totalIdeas > 0 
          ? (costSummary.totalCost / ideaStats.totalIdeas).toFixed(4)
          : '0.0000',
        last_reset: costSummary.lastReset,
      },

      performance: {
        average_cost_per_idea: ideaStats.totalIdeas > 0 
          ? `$${(costSummary.totalCost / ideaStats.totalIdeas).toFixed(4)}`
          : '$0.0000',
        ideas_per_category: ideaStats.totalIdeas > 0 
          ? (ideaStats.totalIdeas / Math.max(Object.keys(ideaStats.categoryStats).length, 1)).toFixed(1)
          : '0.0',
      },

      system: systemHealth,

      timestamps: {
        last_updated: ideaStats.lastUpdated,
        report_generated: now.toISOString(),
      },
    };

    Utils.logWithTimestamp('Stats compiled successfully');
    return res.status(200).json(Utils.createSuccessResponse(responseData));

  } catch (error) {
    Utils.logWithTimestamp(`Stats error: ${error.message}`, 'error');
    return res.status(500).json(Utils.createErrorResponse(error, 500));
  }
}; 