# 🚀 Idea Vault Bot v1.0-Lite

A Telegram-first bot that captures ideas (voice/text/files), enriches them with AI analysis, and stores everything in Notion with smart categorization.

## ✨ Features

- **Multi-modal Capture**: Text, voice messages (≤30s), images, documents
- **AI Transcription**: Whisper-powered voice-to-text
- **Smart Clarification**: GPT-4o generates contextual follow-up questions
- **AI Enrichment**: Market analysis, competitors, business models, next steps
- **Auto-categorization**: AI assigns categories with confidence scoring
- **Dynamic Categories**: Creates new Notion categories automatically
- **Notion Integration**: All data stored in organized Notion database
- **Cost Tracking**: Built-in monitoring for OpenAI costs
- **Stateless Architecture**: Ready for iOS/web extensions

## 🏗️ Architecture

```
Telegram Bot → API Endpoints → OpenAI/Notion → Background Enrichment
                ↓
    Stateless JSON APIs (reusable for iOS/web)
```

**Core Endpoints:**
- `POST /api/capture` - Process initial idea
- `PATCH /api/clarify` - Handle clarifications  
- `POST /api/enrich-lite` - AI analysis & categorization
- `GET /api/categories` - Category management
- `GET /api/stats` - Admin statistics
- `POST /api/telegram/webhook` - Telegram integration

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Telegram Bot Token
- OpenAI API Key
- Notion API Key & Database ID

### 1. Clone & Install
```bash
git clone <your-repo>
cd idea-bot
npm install
```

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in your keys:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
NOTION_API_KEY=your_notion_api_key_here
NOTION_DATABASE_ID=your_notion_database_id_here
ADMIN_TELEGRAM_USER_ID=your_telegram_user_id_for_admin_commands
```

### 3. Notion Database Setup
Create a Notion database with these properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| Idea title | Title | Auto-generated from content |
| Raw text | Rich text | Original user input |
| Attachments | Files & media | File uploads |
| Brief JSON | Rich text | AI analysis (collapsed) |
| Category | Select | AI-assigned category |
| Confidence | Number | Category confidence (0-1) |
| Created | Created time | Timestamp |
| Status | Select | "Captured", "Enriched" |

### 4. Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard
```

### 5. Set Telegram Webhook
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-vercel-domain.vercel.app/api/telegram/webhook"}'
```

## 📱 Usage

### Telegram Commands
- `/start` - Welcome message with examples
- `/help` - Usage instructions  
- `/stats` - Admin statistics (requires admin user ID)

### Idea Capture Flow
1. **Send idea**: Text, voice (≤30s), or file with description
2. **Clarify**: Bot asks a follow-up question
3. **Confirm**: Choose to add details or skip
4. **Enrich**: AI analyzes and categorizes (≤5 min)
5. **Store**: Everything saved to Notion with link

## 🔧 API Reference

### POST /api/capture
Capture and process ideas.

**Request:**
```json
{
  "type": "text|voice|file",
  "content": "idea text or file URL",
  "attachments": [],
  "metadata": {}
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ideaId": "uuid",
    "clarifyingQuestion": "AI-generated question",
    "nextStep": "clarify|enrich"
  }
}
```

### POST /api/enrich-lite
AI enrichment with categorization.

**Request:**
```json
{
  "ideaId": "uuid",
  "ideaText": "full idea content"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "enrichment": {
      "summary": "Executive summary",
      "category": {"name": "Business", "confidence": 0.85},
      "competitors": [{"name": "X", "one_line": "Y"}],
      "market_analysis": {"size_estimate": "$50B", "cagr_estimate": "15%"},
      "business_models": ["SaaS", "Marketplace"],
      "next_step": "Validate with target users"
    }
  }
}
```

## 💰 Cost Management

Target: **≤$0.02 per idea**
- Whisper: ~$0.006/minute
- GPT-4o: ~$0.03/1K tokens
- Built-in cost tracking via `/stats`

## 🛡️ Security Features

- Environment variable validation
- Input sanitization  
- Rate limiting considerations
- Admin-only commands
- Sensitive data redaction in logs
- HTTPS enforcement

## 📊 Monitoring

Use `/stats` command or `GET /api/stats` for:
- Total ideas processed
- Category breakdown
- Cost tracking (24h)
- Success rates
- System health

## 🔧 Development

### Local Development
```bash
# Install Vercel CLI for local development
npm i -g vercel

# Run locally
vercel dev
```

### Testing
```bash
# Test API endpoints
curl -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -d '{"type": "text", "content": "App idea for dog owners"}'
```

## 🚗 Roadmap

**Phase 2 (Future):**
- [ ] Full business plan generation
- [ ] iOS/Android apps using same APIs
- [ ] Team collaboration features
- [ ] Perplexity web search integration
- [ ] Stripe payment tiers
- [ ] Advanced analytics

## 📝 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues or questions:
1. Check environment variables are set correctly
2. Verify Notion database schema matches requirements
3. Test API endpoints individually
4. Check Vercel function logs

## 🙏 Acknowledgments

Built with:
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- [@notionhq/client](https://github.com/makenotion/notion-sdk-js)
- [OpenAI API](https://openai.com/api/)
- [Vercel Functions](https://vercel.com/docs/functions) 