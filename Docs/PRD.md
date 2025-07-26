# PRODUCT REQUIREMENT DOCUMENT

**Project:** **Idea Vault Bot v1.0-Lite**
**Owner:** You (Founder / PM)  **Date:** Jul 2025
**Goal:** Ship a Telegram-first bot that **captures any idea (voice / text / attachments)**, lets the user refine it, then generates a **Lite Brief** (AI summary + high-level market snapshot + smart categorization) and stores everything in a Notion "Idea Vault" database.

> Architecture must be **stateless & reusable** so the same endpoints can power an upcoming iOS app and a future "Idea-to-Business-Plan" SaaS.

---

## 1  Vision & Value

1. **Never lose an idea.** Fast, friction-free capture in the device that's always with users.
2. **Instant light validation.** A one-page AI brief (competitors, market size, biz model hints) so users see if an idea is worth deeper work.
3. **Smart categorization.** AI automatically categorizes ideas (business, research, personal, health, etc.) and can create new categories dynamically.
4. **Central archive.** All raw inputs + enriched briefs live in Notion where they're searchable, filterable by category, and taggable for life.
5. **Reusable core.** Capture–Clarify–Enrich–Categorize is exposed as clean JSON endpoints → easy to plug into iOS or web SaaS later.

---

## 2  Personas

| Persona               | Need                                                            | Frequency |
| --------------------- | --------------------------------------------------------------- | --------- |
| **Indie-Hacker Alex** | Capture flashes of app ideas & get a sanity check, organize by business vs. side projects.              | Daily     |
| **Creative Mia**      | Voice-dump art concepts, attach inspo images, find them later by category (art, music, writing).  | Weekly    |
| **Side-Founder Sam**  | Store 20+ ideas across categories, later filter business ideas for full business plan development. | Monthly   |

---

## 3  User Stories (MVP)

| ID        | Story              | Acceptance Criteria                                                                                                                                |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US-01** | Capture voice      | User sends ≤30 s OGG → bot transcribes ≥95 % accurate words; original file link saved.                                                             |
| **US-02** | Capture text       | Simple text saved verbatim to Notion.                                                                                                              |
| **US-03** | Capture attachment | User attaches image / doc / URL → file or link stored; filename visible in Notion.                                                                 |
| **US-04** | Clarify            | Bot asks one GPT-generated question; user may add more detail; bot re-shows draft + **OK/Cancel**.                                                 |
| **US-05** | Store              | On **OK**, raw + enhanced fields saved to "Idea Vault" DB; timestamped.                                                                            |
| **US-06** | Lite Brief         | Background job produces: Executive Summary · 3–5 Competitors · Market size/CAGR guess · Possible biz models · Next Step. Appears in Notion ≤5 min. |
| **US-07** | Auto-categorize    | AI analyzes idea content and assigns category (Business, Research, Personal, Health, Creative, etc.) or creates new category if needed.           |
| **US-08** | Error handling     | Any API failure → bot sends "⚠️ failed, tap to retry".                                                                                             |
| **US-09** | Admin stats        | `/stats` returns total ideas, token cost, last error, breakdown by category.                                                                       |

(Future stories—Full Plan, team sharing, etc.—out of scope v1.0.)

---

## 4  Functional Scope

### 4.1 Telegram Flow

```text
/start  →  intro + examples
⮑ user: voice / text / file
⮑ bot: transcription / file-ack + clarify Q
⮑ user: extra detail
⮑ bot: shows draft + [👍 OK] [✖️ Cancel]
⮑ bot: "🔎 Researching & categorizing…"
⮑ after job: "✅ Saved! Category: [Business] View Notion ↗"
```

### 4.2 Enrichment (Lite Brief + Categorization)

Single GPT-4o call with system template:

```
Return JSON {
 summary,
 competitors:[{name,one_line}],
 market_size_estimate,
 cagr_pct_estimate,
 likely_biz_models:[…],
 next_step,
 category: {
   name: "string", // e.g. "Business", "Research", "Personal", "Health", "Creative"
   confidence: 0.8, // 0-1 confidence score
   reasoning: "brief explanation"
 }
}
```

**Category Logic:**
- AI determines best-fit category from existing Notion database categories
- If no good match (confidence < 0.7), AI can suggest new category name
- System automatically creates new Notion database categories via API when needed
- Common categories: Business, Research, Personal, Health, Creative, Technology, Lifestyle, Learning

No Perplexity/Web search in v1.0; rely on GPT knowledge.

### 4.3 Notion Schema (updated)

| Field       | Type                        | Description |
| ----------- | --------------------------- | ----------- |
| Idea title  | Title                       | Auto-generated from summary |
| Raw text    | Long text                   | Verbatim user input |
| Attachments | Files / URLs                | Telegram CDN links |
| Brief JSON  | Rich text (collapsed)       | Full AI analysis |
| Category    | Select (dynamic options)    | AI-assigned category |
| Confidence  | Number (0-1)                | Category confidence score |
| Created     | Date                        | Timestamp |
| Status      | Select (Captured, Enriched) | Processing status |

**Dynamic Category Management:**
- Notion Select field options are managed programmatically
- When AI suggests new category, system checks if it exists in Notion DB
- If not, automatically adds new option to Category select field
- All ideas retroactively become filterable by new categories

---

## 5  Non-Functional Requirements

| Attribute       | Target                                                   |
| --------------- | -------------------------------------------------------- |
| **Latency**     | Clarify cycle ≤60 s · Enrich + categorize ≤5 min        |
| **Cost**        | ≤ \$0.02 per idea (Whisper + 1 GPT-4o call)              |
| **Uptime**      | 99.5 % (Vercel edge + cron)                              |
| **Security**    | Env vars for keys; HTTPS; redact idea text in logs       |
| **Scalability** | Stateless functions; Upstash Redis queue if >100 jobs/hr |
| **Privacy**     | Ideas private by default; E2E not required v1.0          |

---

## 6  Tech Stack

| Layer          | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Runtime        | **Node.js 20** on Vercel Serverless Functions         |
| Bot SDK        | `node-telegram-bot-api` (long-poll)                   |
| Speech-to-Text | **OpenAI Whisper** (fast 16 kHz)                      |
| NLP / Brief    | **OpenAI GPT-4o**                                     |
| Data store     | **Notion** via official SDK (acts as DB + dynamic schema management) |
| Queue          | Vercel Background Function (native) → Upstash (later) |
| Storage links  | Telegram file CDN URLs (max 20 MB)                    |

**Micro-service endpoints**

```
POST /capture
PATCH /clarify
POST /enrich-lite        <-- used by TG + future apps (includes categorization)
GET /categories          <-- returns available categories
POST /categories         <-- creates new category in Notion
```

---

## 7  Acceptance Criteria

1. Send voice + image → receive clarify Q → add detail → OK → Notion page with raw text, attachment list, Lite Brief + auto-assigned category within 5 min.
2. AI correctly categorizes 90%+ of ideas with confidence > 0.7
3. New categories are automatically created in Notion when AI suggests them
4. Whisper + GPT tokens ≤ \$0.02 logged.
5. Error simulation returns retry flow.
6. `/stats` displays total ideas, last 24h cost, and breakdown by category.

---

## 8  Risks & Mitigations

| Risk                            | Mitigation                                           |
| ------------------------------- | ---------------------------------------------------- |
| High Whisper cost on long audio | Limit to 30 s; trim longer.                          |
| GPT hallucinated data           | Prefix brief with "Estimates, verify independently." |
| Notion API rate-limit           | Batch writes, exponential retry.                     |
| Attachment types explode        | Restrict to images / pdf / doc at upload.            |
| Category explosion              | Limit to 20 categories max; merge similar ones.      |
| Poor categorization accuracy    | Log mismatches, retrain prompts based on feedback.   |

---

## 9  Future Extensions

* **Full Plan endpoint** (multi-step chain) behind paid tier.
* **iOS / Android app** hitting the same endpoints (JWT auth).
* **Team folders & sharing** within Notion.
* **Perplexity web-search** fallback for real-time competitor pull.
* **Stripe paywall** (limits → subscription tiers).
* **Category analytics** - trending categories, idea success rates by category.
* **Custom category rules** - user-defined categorization logic.

---

This comprehensive PRD incorporates AI-powered categorization with dynamic category creation, ensuring ideas are automatically organized while maintaining the core stateless, reusable architecture for future multi-platform expansion. 