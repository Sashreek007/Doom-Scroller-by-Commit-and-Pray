# 🤡🏆 **DoomScroller**

### **One-Sentence Value Proposition**

> We help **people who lose hours on social feeds** deal with **mindless doomscrolling and zero self-awareness of time spent** by **tracking real scroll distance live, turning it into coins/competitions, and adding AI-powered roast feedback**, resulting in **a fun, social, and brutally honest behavior mirror**.

> **Disclaimer:** This browser extension may not work on managed office/school Wi-Fi (for example, UBS-like corporate networks) because DNS/content filtering can block Supabase auth and Edge Function domains (`*.supabase.co`), which breaks login and AI features. Also, for the extension to work reliably, aggressive browser tracking protection/shields should be turned off for this extension.

**Checklist**

* One sentence
* Names the user
* States outcome
* Still understandable if the joke is removed

---

## 🎥 **Live Demo**

*(Judges look here first. This is non-negotiable.)*

* 🔗 **Live Application:** [ADD_URL_HERE]
* 🎬 **Demo Video (60–90s):** [ADD_VIDEO_URL_HERE]

**What the demo shows**

1. The problem in <5 seconds
2. User input
3. System response
4. Why it’s funny / better / different

---

## 😂 **Why This Exists**

*(Problem Statement, but themed for a silly hackathon)*

### The Problem We Are (Over-Dramatically) Solving

* People scroll for hours but have no intuitive sense of distance/time spent.
* Existing “wellness” tools are passive, boring, and easy to ignore.
* Most trackers show delayed stats, so feedback arrives too late to change behavior.
* Social accountability is missing; habit change is harder alone.
* AI assistants are usually generic and polite, not behavior-aware or memorable.
* Corporate/school networks can silently block critical APIs, making “it works on my Wi-Fi” a real product issue.

---

## 🎯 **Target Users & Use Cases**

### Who This Is For

**Primary User**

* Who they are: Students, early-career professionals, and creators who spend significant time on short-form/social feeds.
* Situation they’re in: They want awareness/control but dislike preachy productivity apps.
* How often this problem happens: Daily, usually multiple sessions per day.

**Secondary User (Optional)**

* Friends who want to compete in battle rooms and make scrolling visible/accountable.

**Concrete Use Case**

> A user opens YouTube after work “for 5 minutes,” keeps scrolling, and DoomScroller instantly increments today distance and coins locally. Their friends invite them to a battle room where they bet coins on a 20-second round. After the round ends, the winner/loser result appears directly on the webpage with confetti, and later the user asks AI Chat, “How cooked am I today?” to get a roast based only on their own behavior.

---

## 💡 **Solution Overview**

### What We Built

DoomScroller is a Chrome extension that tracks scrolling distance across selected social platforms and converts it into a live meter/coin system. It combines local-first runtime updates (for instant UI responsiveness) with async cloud sync to Supabase (for persistence, leaderboard, friends, and battles). Users can compete in real-time multiplayer battle rooms with timers, betting, and automatic payout settlement. The system also generates AI-enhanced achievements and provides an AI chat roast mode grounded in each user’s own doomscroll data.  
We built this with a playful voice, but the underlying architecture is production-style: typed message contracts, RLS policies, migration-driven schema evolution, and resilient fallback paths.

> **Key Differentiator:** This is not a static joke UI; it is a real-time behavior engine where tracking, multiplayer game logic, and AI outputs are all data-backed and user-specific.

---

## ⚙️ **System Architecture**

### How It Works Under the Hood

**Inputs**

* Scroll deltas from content scripts on supported social domains
* User auth/profile/friend/battle actions from popup UI
* Chat prompts and achievement trigger events

**Processing**

* Content script normalizes scroll activity and flushes batched updates
* Background service worker aggregates, validates, and applies local-first updates
* Supabase sync layer persists sessions/profiles/rooms/relationships
* Edge Functions generate AI responses/achievement content under JWT-scoped access

**Outputs**

* Real-time today/total distance and per-app breakdown
* Coin earnings, battle timers/results, leaderboard updates
* AI chat roasts and achievement metadata

```text
User Input
 ↓
Content Script + Background Aggregation (local-first)
 ↓
Supabase Sync + Edge Function Intelligence
 ↓
Popup UI + On-Page Overlays (timer, winner/loser, toasts)
```

**Pipeline Notes**

* Local updates are shown immediately; cloud writes are async.
* Message contracts are typed (`shared/messages.ts`) to keep popup/background/content behavior aligned.
* Battle mode includes round state, settlement payloads, and replay-safe overlays.

---

## 🧠 **Core Technical Insight**

### The Non-Obvious Engineering Decision

1. **Hardest technical problem:** Perceived lag was high at launch (users saw backend-bound delays of 10+ seconds), which made tracking feel broken.
2. **Decision that solved it:** We switched to a **local-first cache-and-sync architecture**: update meters immediately in local runtime/cache, then sync batched data to Supabase in the background.
3. **Why it matters:** This made the experience feel instant while preserving durable server-side truth for leaderboard, coins, friends, and battles.

Additional hard problems and fixes:

* **AI integration instability:** We added stricter token/session handling, edge-function contract checks, and fallbacks so UI does not hard-fail when AI is unavailable.
* **DNS/network blocking issue:** On some managed networks, requests to Supabase domains were blocked. Solution: document the dependency, recommend domain allowlisting or alternate network, and provide graceful error handling/fallback behavior.
* **New engineering practice tried:** We used **spec-driven development** for V2 features (contracts first, migration-first schema changes, then UI wiring), which reduced regressions while shipping fast.

---

## 🤖 **How We Use AI to Enhance the Experience**

### Why AI Is Essential (Not Just a Gimmick)

**Why AI Is Needed**

A pure rule-based system can assign static labels, but it cannot generate context-rich, user-specific roast/achievement language that stays fresh and engaging over repeated interactions.

**What the AI Does**

* Interprets user prompts in AI Chat using only that user’s context
* Generates roast-style responses tied to individual scroll patterns
* Enriches achievement content with dynamic title/description/tone
* Adapts response style while preserving product constraints

**The Intentional “Silly Constraint”**

> The assistant is intentionally opinionated/roasty and behavior-focused, while still bounded by strict context isolation and response validation.

**User Experience Impact**

* Makes behavior feedback memorable instead of generic
* Increases replay and engagement in chat/achievement loops
* Turns passive tracking into an interactive experience

**Technical Responsibility**

AI calls run through controlled Edge Functions with JWT-derived identity, schema-validated outputs, and fallback responses to keep behavior predictable and safe.

---

## ✨ **Key Features**

### The Fun Stuff (That Actually Works)

* **Local-First Doom Meter** – Scroll distance updates immediately in the UI, then syncs to cloud without blocking user feedback.
* **Coins + Battle Rooms** – Users create/join rooms via key, set bets/timers, and run competitive rounds with automatic payout settlement.
* **On-Page Game Overlay** – During rounds, users see timer and winner/loser feedback directly on the webpage (not only in popup).
* **Social Layer (Friends + Leaderboards)** – Search/add/accept/remove friends, world/friends rankings, and request indicators.
* **AI Roast + Achievements** – AI chat and achievement enrichment use user-specific doomscroll context for personalized responses.

---

## 🧪 **Validation & Results**

### Proof This Isn’t Just a Meme

* Internal manual testing with multiple accounts/room participants validated end-to-end flow: tracking → coins → battle settlement → UI overlays.
* Before/after latency improvement: perceived metric updates moved from backend-lagged behavior (10s+ in early builds) to near-instant local UI updates.
* Realtime room behavior validated with host transfer, kick handling, and persistent room membership across popup reopen.
* AI fallback behavior validated so chat/achievement UX degrades gracefully when external AI service/network is unavailable.

---

## 🏆 **Why This Project Wins**

### Judge-Facing Justification

* It strongly matches a silly/entertainment hackathon theme while remaining technically real.
* The humor is layered on top of concrete engineering: typed contracts, migrations, RLS, realtime, caching, and async pipelines.
* It has a clear live demo arc: track, compete, settle, roast.
* It is memorable because users get immediate visual feedback and social game loops, not just a dashboard.

---

## 🔐 **Privacy & Data Handling**

### How We Treat User Data

**What Data We Access**

* Auth identity (Supabase user)
* Profile data (username, display name, avatar, visibility)
* Scroll session metrics (site key, meters/pixels, timestamps, duration)
* Social graph data (friend requests/relationships)
* Battle/game metadata (room membership, bets, results)
* Chat messages (user + assistant)

**How Data Is Used**

* Used for tracking stats, battles, social features, and user-specific AI responses
* Not used for ad targeting or cross-user content leakage in AI prompts

**Storage & Retention**

* Runtime cache: `chrome.storage.local` for fast UX and resilience
* Persistent storage: Supabase Postgres tables and edge function logs per project settings
* Retention policy can be adjusted by product policy / DB cleanup jobs

**Third-Party Services**

* Supabase (Auth, Postgres, Realtime, Edge Functions)
* Gemini API (invoked from Edge Functions; key stored as Supabase secret)

**User Control**

* Users can sign out and clear extension storage
* Profile visibility toggle available
* Team can provide account/data deletion path via backend admin workflow

---

## 🛠️ **Tech Stack**

### Tools Used

* **Frontend:** React + TypeScript + TailwindCSS (Chrome extension popup UI)
* **Backend:** Supabase Postgres + RLS + Realtime + Edge Functions
* **AI / ML:** Gemini (via Supabase Edge Functions)
* **Infrastructure:** Chrome Extension MV3 (service worker + content scripts), Vite build pipeline

---

## ⚡ **Setup & Run Locally**

### How to Run This Project

```bash
git clone [repo-url]
cd doomscroller
npm install
```

Create `.env` in repo root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Build extension:

```bash
cd extension
npm run build
```

Load extension in browser:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `/Users/sashreek/Documents/doomscroller/extension/dist`

Optional backend setup (if running your own Supabase project):

```bash
cd /Users/sashreek/Documents/doomscroller
npx supabase@latest link --project-ref <PROJECT_REF>
npx supabase@latest db push --include-all
npx supabase@latest secrets set GEMINI_API_KEY="<YOUR_GEMINI_KEY>"
npx supabase@latest functions deploy generate-achievement --use-api
npx supabase@latest functions deploy chatbot --use-api
```

---

## 🚀 **Future Roadmap**

### Where This Could Go Next

* Add additional battle game modes with deterministic scoring contracts and anti-cheat telemetry.
* Add weekly seasonal ladders and coin sinks (cosmetics/badge frames) to deepen retention loops.
* Add user-controlled AI persona presets (roast intensity + coaching mode) with strict privacy boundaries.

---

## ⚠️ **Limitations & Risks**

### Known Constraints

* Managed networks with strict DNS/content filtering can block Supabase domains and break auth/AI endpoints.
* Browser privacy/tracking protections may interfere with extension auth/session persistence if too strict.
* Scroll tracking is domain-scoped to supported sites and depends on content-script execution contexts.
* Realtime UX still depends on background worker lifecycle and browser extension constraints.

---

## 🧑‍🤝‍🧑 **Team**

### Who Built This

* [NAME_1] — [ROLE] — [CONTRIBUTION]
* [NAME_2] — [ROLE] — [CONTRIBUTION]
* [NAME_3] — [ROLE] — [CONTRIBUTION]
* [NAME_4] — [ROLE] — [CONTRIBUTION]

---

## 📜 **License (Optional)**

[ADD_LICENSE_HERE]

---

# 🔥 FINAL CHECKLIST (DO NOT IGNORE)

Your README must:

* Have a demo near the top
* Explain *why* AI is used
* Show at least one real technical insight
* Balance humor with clarity
* Respect privacy even in a joke project

If you do all that, **your README will be top-tier**.
