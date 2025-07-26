require('dotenv').config();
const NotionClient = require('../lib/notion');
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

  try {
    Utils.validateEnvironmentVariables();

    const notionClient = new NotionClient();

    if (req.method === 'GET') {
      // Fetch all categories
      try {
        const categories = await notionClient.getCategories();
        const stats = await notionClient.getIdeaStats();

        // Enhance categories with usage counts
        const enhancedCategories = categories.map(category => ({
          ...category,
          usage_count: stats.categoryStats[category.name] || 0,
        }));

        const responseData = {
          categories: enhancedCategories,
          total_categories: categories.length,
          total_ideas: stats.totalIdeas,
          category_stats: stats.categoryStats,
        };

        Utils.logWithTimestamp(`Categories fetched: ${categories.length} found`);
        return res.status(200).json(Utils.createSuccessResponse(responseData));

      } catch (error) {
        Utils.logWithTimestamp(`Error fetching categories: ${error.message}`, 'error');
        return res.status(500).json(
          Utils.createErrorResponse(new Error(`Failed to fetch categories: ${error.message}`), 500)
        );
      }

    } else if (req.method === 'POST') {
      // Create new category
      const { name, color } = req.body;

      if (!name) {
        return res.status(400).json(
          Utils.createErrorResponse(new Error('Missing required field: name'), 400)
        );
      }

      // Validate category name
      const sanitizedName = Utils.sanitizeInput(name).trim();
      if (sanitizedName.length < 2 || sanitizedName.length > 50) {
        return res.status(400).json(
          Utils.createErrorResponse(new Error('Category name must be between 2 and 50 characters'), 400)
        );
      }

      try {
        const result = await notionClient.addCategory(sanitizedName);
        
        if (result.success) {
          const responseData = {
            category: {
              name: sanitizedName,
              color: color || 'default',
              created_at: new Date().toISOString(),
            },
            message: result.message,
          };

          Utils.logWithTimestamp(`Category created: ${sanitizedName}`);
          return res.status(201).json(Utils.createSuccessResponse(responseData));
        } else {
          return res.status(400).json(
            Utils.createErrorResponse(new Error(result.message), 400)
          );
        }

      } catch (error) {
        Utils.logWithTimestamp(`Error creating category: ${error.message}`, 'error');
        return res.status(500).json(
          Utils.createErrorResponse(new Error(`Failed to create category: ${error.message}`), 500)
        );
      }

    } else {
      return res.status(405).json(
        Utils.createErrorResponse(new Error('Method not allowed'), 405)
      );
    }

  } catch (error) {
    Utils.logWithTimestamp(`Categories API error: ${error.message}`, 'error');
    return res.status(500).json(Utils.createErrorResponse(error, 500));
  }
}; 