const OpenAI = require('openai');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

class OpenAIClient {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.costTracking = {
      whisperCost: 0,
      gptCost: 0,
      totalCost: 0,
      lastReset: new Date().toISOString(),
    };
  }

  async transcribeAudio(audioBuffer, filename = 'audio.ogg') {
    try {
      console.log('Starting audio transcription...');
      
      // Create a temporary file from buffer
      const tempFilePath = `/tmp/${Date.now()}_${filename}`;
      fs.writeFileSync(tempFilePath, audioBuffer);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en', // Can be made dynamic
      });

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      // Track costs (Whisper is $0.006 per minute)
      const estimatedMinutes = audioBuffer.length / (1024 * 1024 * 0.5); // Rough estimate
      const cost = estimatedMinutes * 0.006;
      this.trackCost('whisper', cost);

      console.log('Audio transcribed successfully');
      return {
        text: transcription.text,
        success: true,
        cost: cost,
      };
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  async generateIdeaTitle(ideaText) {
    try {
      console.log('Generating AI title...');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at creating concise, professional titles for business ideas and concepts. Generate titles that are clear, engaging, and under 60 characters.',
          },
          {
            role: 'user',
            content: `Generate a concise, professional title (max 60 chars) for this idea: "${ideaText}"`,
          },
        ],
        max_tokens: 50,
        temperature: 0.7,
      });

      const title = response.choices[0].message.content.trim().replace(/["""]/g, '');
      
      // Track GPT costs
      const tokens = response.usage.total_tokens;
      const cost = (tokens / 1000) * 0.03;
      this.trackCost('gpt', cost);

      return {
        title,
        success: true,
        cost: cost,
        tokens: tokens,
      };
    } catch (error) {
      console.error('Error generating title:', error);
      throw new Error(`Title generation failed: ${error.message}`);
    }
  }

  async generateClarifyingQuestion(ideaText) {
    try {
      console.log('Generating clarifying question...');

      const prompt = `You are helping someone refine their idea. Based on the following idea, ask ONE specific, insightful question that would help clarify or improve the idea. Keep it concise and actionable.

Idea: "${ideaText}"

Generate a single clarifying question:`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at helping people refine their ideas by asking the right clarifying questions. Ask only one focused question that will help improve or clarify the idea.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      const question = response.choices[0].message.content.trim();
      
      // Track GPT costs (roughly $0.03 per 1K tokens for GPT-4o)
      const tokens = response.usage.total_tokens;
      const cost = (tokens / 1000) * 0.03;
      this.trackCost('gpt', cost);

      return {
        question,
        success: true,
        cost: cost,
        tokens: tokens,
      };
    } catch (error) {
      console.error('Error generating clarifying question:', error);
      throw new Error(`Question generation failed: ${error.message}`);
    }
  }

  async enrichIdea(ideaText, existingCategories = []) {
    try {
      console.log('Enriching idea with detailed business analysis...');

      const categoryList = existingCategories.length > 0 
        ? existingCategories.map(cat => cat.name).join(', ')
        : 'Business, Research, Personal, Health, Creative, Technology, Lifestyle, Learning';

      const prompt = `Analyze this business idea and create a comprehensive business plan analysis:

IDEA: "${ideaText}"

Create detailed content for each section (use clean formatting without markdown stars):

## Executive Summary
Write 2-3 compelling paragraphs summarizing the core concept, value proposition, and potential impact.

## Market Analysis  
- Market size and growth projections
- Key market trends and drivers
- Target audience demographics
- Market opportunities and challenges

## Competitive Landscape
Analyze 4-5 key competitors:
- Company name and brief description  
- Their strengths and weaknesses
- Market positioning
- How this idea differentiates

## Business Models
Detail potential revenue streams:
- Primary monetization strategies
- Pricing models and tiers
- Revenue projections and assumptions
- Scalability considerations

## User Stories
Create 3-4 detailed user scenarios:
- User persona and pain point
- How they discover and use the solution
- Value they receive
- Success metrics

## Next Steps
Provide 5-7 specific, actionable recommendations:
- Immediate actions (next 30 days)
- Short-term goals (3-6 months)  
- Key metrics to track
- Resource requirements

## Resources & References
- CB Insights market research: https://cbinsights.com
- Statista industry data: https://statista.com
- Product Hunt for competitor analysis: https://producthunt.com
- Google Trends for market validation: https://trends.google.com
- TechCrunch for industry news: https://techcrunch.com

IMPORTANT: After the content, provide this JSON on separate lines:
ANALYSIS_DATA_START
{
  "category": {
    "name": "Best fitting category from: ${categoryList}",
    "confidence": 0.85,
    "reasoning": "Brief explanation"
  },
  "key_insights": [
    "Market size: $X billion with Y% growth",
    "Main competitors: Company1, Company2, Company3", 
    "Revenue potential: $X with Z% conversion rate",
    "Key differentiator: Specific unique value proposition"
  ]
}
ANALYSIS_DATA_END`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a senior business analyst and consultant. Create comprehensive, actionable business analysis with clean formatting for Notion. Use plain text without markdown formatting (no ** or * or `). Be specific with real numbers, examples, and recommendations. Format content clearly with headers and bullet points. In key_insights, provide actual valuable data points from your analysis.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      });

      const content = response.choices[0].message.content.trim();
      
      // Extract JSON between markers
      const jsonStartMarker = 'ANALYSIS_DATA_START';
      const jsonEndMarker = 'ANALYSIS_DATA_END';
      
      let categoryData = {
        category: { name: 'Business', confidence: 0.8, reasoning: 'Default' },
        key_insights: ['Market analysis provided', 'Competitive research completed', 'Revenue projections calculated']
      };
      
      let businessPlanContent = content;
      
      const startIndex = content.indexOf(jsonStartMarker);
      const endIndex = content.indexOf(jsonEndMarker);
      
      if (startIndex !== -1 && endIndex !== -1) {
        // Extract JSON content
        const jsonContent = content.substring(startIndex + jsonStartMarker.length, endIndex).trim();
        
        try {
          categoryData = JSON.parse(jsonContent);
        } catch (parseError) {
          console.error('Failed to parse category JSON:', parseError);
        }
        
        // Remove JSON markers and content from business plan
        businessPlanContent = content.substring(0, startIndex).trim();
      }

      // Clean up any remaining markdown formatting for Notion
      businessPlanContent = businessPlanContent
        .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove **bold**
        .replace(/\*(.*?)\*/g, '$1')      // Remove *italic*
        .replace(/`(.*?)`/g, '$1')        // Remove `code`
        .trim();

      const enrichedIdea = {
        businessPlanContent,
        category: {
          name: categoryData.category?.name || 'Business',
          confidence: Math.min(Math.max(categoryData.category?.confidence || 0.8, 0), 1),
          reasoning: categoryData.category?.reasoning || 'Default categorization',
        },
        keyInsights: categoryData.key_insights || ['Analysis completed', 'Research provided', 'Next steps outlined'],
        generated_at: new Date().toISOString(),
      };

      // Track GPT costs
      const tokens = response.usage.total_tokens;
      const cost = (tokens / 1000) * 0.03;
      this.trackCost('gpt', cost);

      console.log('Detailed business analysis completed successfully');
      return {
        enrichedIdea,
        success: true,
        cost: cost,
        tokens: tokens,
      };
    } catch (error) {
      console.error('Error enriching idea:', error);
      throw new Error(`Idea enrichment failed: ${error.message}`);
    }
  }

  trackCost(type, cost) {
    if (type === 'whisper') {
      this.costTracking.whisperCost += cost;
    } else if (type === 'gpt') {
      this.costTracking.gptCost += cost;
    }
    this.costTracking.totalCost = this.costTracking.whisperCost + this.costTracking.gptCost;
  }

  getCostSummary() {
    return {
      ...this.costTracking,
      last24h: this.costTracking.totalCost, // Simplified for now
    };
  }

  resetDailyCosts() {
    this.costTracking = {
      whisperCost: 0,
      gptCost: 0,
      totalCost: 0,
      lastReset: new Date().toISOString(),
    };
  }

  async downloadFile(url, maxSize = 20 * 1024 * 1024) { // 20MB limit
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        maxContentLength: maxSize,
        timeout: 30000,
      });

      return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'],
        size: response.data.byteLength,
      };
    } catch (error) {
      console.error('Error downloading file:', error);
      throw new Error(`File download failed: ${error.message}`);
    }
  }
}

module.exports = OpenAIClient; 