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
      console.log('Enriching idea with AI analysis...');

      const categoryList = existingCategories.length > 0 
        ? existingCategories.map(cat => cat.name).join(', ')
        : 'Business, Research, Personal, Health, Creative, Technology, Lifestyle, Learning';

      const prompt = `Analyze the following idea and provide a comprehensive brief. Return ONLY valid JSON with no additional text.

Idea: "${ideaText}"

Existing categories: ${categoryList}

Return JSON in this exact format:
{
  "summary": "1-2 sentence executive summary",
  "competitors": [
    {"name": "Competitor Name", "one_line": "Brief description"}
  ],
  "market_size_estimate": "Market size with timeframe (e.g., '$50B by 2025')",
  "cagr_pct_estimate": "Growth rate percentage (e.g., '15%')",
  "likely_biz_models": ["Model 1", "Model 2", "Model 3"],
  "next_step": "Immediate actionable next step",
  "category": {
    "name": "Best fitting category from the list above, or suggest new one",
    "confidence": 0.85,
    "reasoning": "Brief explanation for category choice"
  }
}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a business analyst expert. Analyze ideas and provide structured insights. Always return valid JSON. Prefix analysis with "Estimates - verify independently." Be realistic about market data.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content.trim();
      let analysis;
      
      try {
        analysis = JSON.parse(content);
      } catch (parseError) {
        console.error('Failed to parse GPT response as JSON:', content);
        throw new Error('Invalid JSON response from AI');
      }

      // Validate and sanitize the response
      const enrichedIdea = {
        summary: analysis.summary || 'AI analysis completed',
        competitors: Array.isArray(analysis.competitors) ? analysis.competitors.slice(0, 5) : [],
        market_size_estimate: analysis.market_size_estimate || 'Market size analysis needed',
        cagr_pct_estimate: analysis.cagr_pct_estimate || 'Growth rate analysis needed',
        likely_biz_models: Array.isArray(analysis.likely_biz_models) ? analysis.likely_biz_models : [],
        next_step: analysis.next_step || 'Further research required',
        category: {
          name: analysis.category?.name || 'Business',
          confidence: Math.min(Math.max(analysis.category?.confidence || 0.5, 0), 1),
          reasoning: analysis.category?.reasoning || 'Default categorization',
        },
        disclaimer: 'Estimates - verify independently',
        generated_at: new Date().toISOString(),
      };

      // Track GPT costs
      const tokens = response.usage.total_tokens;
      const cost = (tokens / 1000) * 0.03;
      this.trackCost('gpt', cost);

      console.log('Idea enrichment completed successfully');
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