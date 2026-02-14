# 🤡🏆 DoomScroller

We help people who lose hours on social feeds turn invisible doomscrolling into visible, trackable behavior using live distance tracking, social game mechanics, and AI-powered roast feedback.

> **Disclaimer:** This browser extension may not work on managed office/school Wi-Fi (for example, UBS-like corporate networks) because DNS/content filtering can block Supabase domains (`*.supabase.co`), which breaks login and AI features. For reliable behavior, aggressive browser tracking protection/shields should be turned off for this extension.

---

## 🎥 Live Demo

* 🔗 **Live Application:** [ADD_URL_HERE]
* 🎬 **Demo Video (60–90s):** [ADD_VIDEO_URL_HERE]

---

## 😂 Why This Exists

People spend a lot of time scrolling without any intuitive sense of how much they actually consumed. Existing wellness tools are usually passive and easy to ignore. We wanted a system that gives immediate, honest, and slightly chaotic feedback, while still being technically robust enough to support realtime game loops, social interactions, and AI features.

---

## 🎯 Target Users & Use Cases

### Primary Users

* Students, professionals, and creators who use social feeds daily.
* Users who want awareness/accountability but dislike preachy productivity UX.

### Secondary Users

* Friend groups that want lightweight competition around scrolling behavior.

### Example Use Case

A user opens YouTube for “a quick break,” starts scrolling, and sees distance/coins update immediately. They join a battle room via key, play a timed round with a coin bet, and get winner/loser feedback directly on the webpage. Later, they open AI Chat and ask for a roast that reflects only their own scrolling patterns.

---

## 💡 Solution Overview

DoomScroller is a Chrome extension that tracks scroll distance across selected social platforms and converts activity into a live meter, coin system, social competition, and AI interactions. The system uses local-first updates for instant UX and asynchronous cloud sync for persistence and multiplayer features. Users can search/add friends, compare world/friends leaderboard positions, join battle rooms, and interact with AI chat/achievement experiences tied to their behavior.  

**Key Differentiator:** DoomScroller is not a static joke script; it is a real-time, data-backed extension where gameplay, stats, and AI behavior are integrated into one coherent loop.

---

## 🔍 How It Works (Step by Step)

1. **Extension runs on supported social domains**  
   A content script binds to the active scroll container (with rebinding for SPA page transitions) and tracks scroll deltas.

2. **Scroll movement is converted into distance**  
   Pixel deltas are converted to meters and flushed as runtime messages at short intervals.

3. **Background service worker handles local-first updates**  
   It validates site scope, aggregates unsynced batches, and serves immediate stats from local/cache state for fast UI response.

4. **Async backend sync persists data**  
   Batched sessions are pushed to Supabase in the background, updating durable profile/session tables without blocking UX.

5. **Coins are awarded from distance progression**  
   Coin checkpoints are tracked and incremented as total distance crosses thresholds.

6. **Battle rooms run timed multiplayer rounds**  
   Users join with room keys, host configures bet/timer/game mode, and rounds run with shared timing plus live standings.

7. **Round settlement is server-authoritative**  
   End-of-round logic computes winners, splits pot/payouts, writes result payload, and keeps players in the room for the next round.

8. **Main-screen overlays deliver instant game feedback**  
   During rounds, timer appears on the webpage; after settlement, winner/loser overlays (with confetti for winners) show directly on-page.

9. **AI layer adds context-aware interaction**  
   Edge Functions generate roast/chat and achievement enrichment from authenticated user context, with fallbacks if AI is unavailable.

---

## ⚙️ System Architecture

```text
User Input
 ↓
Content Script + Background Aggregation (local-first)
 ↓
Supabase Sync + Edge Function Intelligence
 ↓
Popup UI + On-Page Overlays (timer, winner/loser, toasts)
```

### Inputs

* Scroll events from supported social domains
* Popup actions (auth, friends, rooms, settings, chat)
* Battle/game actions and AI prompts

### Processing

* Content script captures scroll deltas and batches updates
* Background service worker validates/aggregates events
* Local cache updates UI immediately
* Supabase sync writes durable state (profiles, sessions, friends, battles)
* Edge Functions generate AI chat and achievement content

### Outputs

* Live today/total distance and per-app breakdown
* Coin earnings and battle room updates
* On-page timer + winner/loser overlay
* AI roast responses and achievement metadata

---

## 🧠 Core Technical Insight

The hardest early issue was user-perceived latency: backend-dependent updates made the extension feel slow (10+ second delay in initial builds).  

We solved this with a **local-first cache-and-sync model**:

* Update meters/coins in local runtime immediately
* Batch and sync to backend asynchronously
* Merge local unsynced state with DB-backed stats in reads

This kept UX fast while preserving server-side consistency for leaderboard, friends, battles, and persistence.

Additional engineering challenges we solved:

* **AI integration reliability:** added stronger auth/session handling and fallback behavior so the app still works when AI is unavailable.
* **DNS/network blocking in managed environments:** documented constraints, added clearer errors, and validated alternative-network guidance.
* **Spec-driven development:** for V2, we used contract-first + migration-first implementation to reduce regressions while shipping features quickly.

---

## 🤖 How We Use AI to Enhance the Experience

AI is used where static rules alone would feel repetitive:

* Personalized roast/chat responses from a user’s own doomscroll context
* Achievement text enrichment with dynamic tone and context

Why this is not a gimmick:

* Rule-only systems can score behavior, but they cannot sustain varied, context-aware interaction quality.
* AI responses increase replay value and make feedback memorable.

Safety/control approach:

* JWT-scoped identity in Edge Functions
* Structured output constraints and validation
* Graceful fallback responses when AI/network fails
* No cross-user leakage in user-level context flows

---

## ✨ Key Features

* **Local-First Doom Meter** – Distance updates instantly, then syncs in background.
* **Coins + Battle Rooms** – Room key join flow, bets, timers, and automated coin settlement.
* **On-Page Battle Overlay** – Timer and winner/loser visuals appear directly on the webpage during/after rounds.
* **Friends + Leaderboards** – Search/add/accept/remove friends and compare world/friends ranks.
* **AI Roast + Achievements** – User-specific chat/achievement enrichment tied to scrolling behavior.

---

## 🧪 Validation & Results

* End-to-end manual testing with multiple accounts validated tracking → coins → battle → settlement flow.
* Perceived update latency improved from backend-lagged behavior (10s+) to near-instant local updates.
* Realtime room behavior validated for joins/leaves, host transfer, and persistent membership across popup reopen.
* AI fallback behavior verified so chat/achievement UX degrades gracefully instead of hard failing.

---

## 🏆 Why DoomScroller Stands Out

* Strongly aligned with a playful hackathon theme, while technically real under the hood.
* Combines realtime extension architecture, multiplayer game logic, and AI interaction in one product.
* Demo is easy to understand and memorable: track → compete → settle → roast.

---

## 🔐 Privacy & Data Handling

### Data Access

* Auth identity (Supabase user)
* Profile data (username, display name, avatar, visibility)
* Scroll session metrics (site key, distance, timestamps, duration)
* Friendship/request state
* Battle metadata and round outcomes
* Chat message content

### Data Usage

* Used only for tracking, social gameplay, and user-specific AI features
* Not used for ad targeting

### Storage

* Local runtime cache in `chrome.storage.local`
* Persistent backend storage in Supabase Postgres

### Third-Party Services

* Supabase (Auth, DB, Realtime, Edge Functions)
* Gemini API via Supabase Edge Functions

### User Control

* Sign out support
* Profile visibility control
* Extension storage can be cleared by user

---

## 🛠️ Tech Stack

* **Frontend:** React, TypeScript, TailwindCSS
* **Backend:** Supabase Postgres, RLS, Realtime, Edge Functions
* **AI:** Gemini (through Edge Functions)
* **Extension Platform:** Chrome Extension MV3 (service worker + content scripts)
* **Build Tooling:** Vite

---

## ⚡ Setup & Run Locally

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

Build the extension:

```bash
cd extension
npm run build
```

Load in browser:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select `/Users/sashreek/Documents/doomscroller/extension/dist`

Optional backend setup:

```bash
cd /Users/sashreek/Documents/doomscroller
npx supabase@latest link --project-ref <PROJECT_REF>
npx supabase@latest db push --include-all
npx supabase@latest secrets set GEMINI_API_KEY="<YOUR_GEMINI_KEY>"
npx supabase@latest functions deploy generate-achievement --use-api
npx supabase@latest functions deploy chatbot --use-api
```

---

## 🚀 Future Roadmap

* Add more battle modes with deterministic scoring and anti-cheat telemetry.
* Add seasonal progression/coin sinks for deeper retention.
* Add configurable AI personalities (roast intensity vs coaching mode).

---

## ⚠️ Limitations & Risks

* Managed networks can block Supabase DNS/domains and break auth/AI.
* Strict browser privacy/shield settings can interfere with extension session behavior.
* Tracking is limited to supported social domains and extension execution contexts.
* Realtime quality still depends on browser extension service worker lifecycle.

---

## 🧑‍🤝‍🧑 Team

* [NAME_1] — [ROLE] — [CONTRIBUTION]
* [NAME_2] — [ROLE] — [CONTRIBUTION]
* [NAME_3] — [ROLE] — [CONTRIBUTION]
* [NAME_4] — [ROLE] — [CONTRIBUTION]

---

## 📜 License

[ADD_LICENSE_HERE]
