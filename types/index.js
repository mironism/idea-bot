// Type definitions for Idea Vault Bot

/**
 * @typedef {Object} IdeaData
 * @property {string} title - Idea title
 * @property {string} rawText - Original text content
 * @property {Array} attachments - File attachments
 * @property {string} status - Processing status
 */

/**
 * @typedef {Object} EnrichmentResult
 * @property {string} summary - Executive summary
 * @property {Array} competitors - Competitor analysis
 * @property {string} market_size_estimate - Market size estimate
 * @property {string} cagr_pct_estimate - Growth rate estimate
 * @property {Array} likely_biz_models - Business model suggestions
 * @property {string} next_step - Recommended next action
 * @property {Object} category - Category classification
 * @property {string} category.name - Category name
 * @property {number} category.confidence - Confidence score (0-1)
 * @property {string} category.reasoning - Classification reasoning
 */

/**
 * @typedef {Object} TelegramMessage
 * @property {Object} from - User information
 * @property {Object} chat - Chat information
 * @property {string} text - Message text (optional)
 * @property {Object} voice - Voice message (optional)
 * @property {Array} photo - Photo attachments (optional)
 * @property {Object} document - Document attachment (optional)
 */

/**
 * @typedef {Object} APIResponse
 * @property {boolean} success - Success status
 * @property {Object|string} data - Response data or error message
 * @property {string} timestamp - Response timestamp
 */

/**
 * @typedef {Object} CategoryData
 * @property {string} id - Category ID
 * @property {string} name - Category name
 * @property {string} color - Category color
 * @property {number} usage_count - Usage count
 */

/**
 * @typedef {Object} StatsData
 * @property {number} totalIdeas - Total ideas count
 * @property {Object} categoryStats - Ideas by category
 * @property {Object} statusStats - Ideas by status
 * @property {string} lastUpdated - Last update timestamp
 */

/**
 * @typedef {Object} CostSummary
 * @property {number} whisperCost - Whisper API costs
 * @property {number} gptCost - GPT API costs
 * @property {number} totalCost - Total costs
 * @property {string} lastReset - Last reset timestamp
 */

module.exports = {
  // Export types for JSDoc usage
}; 