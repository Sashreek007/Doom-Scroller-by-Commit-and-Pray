# DoomScroller - Technical Plan

## Context

DoomScroller is a Chrome browser extension that tracks how much a user scrolls on social media and converts it to a real-world distance (meters). It gamifies the experience with leaderboards, sarcastic AI-powered achievements (targeted at university students), a chatbot, and real-time scroll battles. The goal is something silly that guilt-trips students into studying by insulting their scrolling habits.

---

## Key Decisions

- **Auth:** Username + email + password. Username is the public identity. Email for password recovery only.
- **Platform:** Desktop Chrome only.
- **UI:** Dark & edgy — dark backgrounds, neon accent colors (electric green, hot pink, cyan), meme-inspired micro-interactions. NOT a polished SaaS look.
- **Backend:** Supabase (Auth + PostgreSQL + Realtime + Edge Functions).
- **AI:** Google Gemini API (`gemini-2.0-flash`).
- **Ship strategy:** v1 (core) → v2 (AI) → v3 (battles). Commit after each small task.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension UI | React 18 + TypeScript + Tailwind CSS (dark neon theme) |
| Bundler | Vite + CRXJS |
| Background / Content Scripts | Plain TypeScript |
| Backend | Supabase (Auth + PostgreSQL + Realtime + Edge Functions) |
| AI | Google Gemini API (`gemini-2.0-flash`) |

---

## UI Design

### Overall Vibe
Dark background (`#0a0a0a`), neon accent gradients, glowing borders, monospace stats, emoji-heavy badges. Think "hacker terminal meets meme culture." The popup is **400x600px**.

### Popup Layout (400x600)

```
┌──────────────────────────────────┐
│  DoomScroller          [P] [S]  │  Header: logo, profile & settings icons
├──────────────────────────────────┤
│                                  │
│   TODAY: 1,847m                 │  Big stat, neon green glow
│   "That's 18 football fields"   │  Fun comparison, dimmed text
│                                  │
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│   │IG  │ │ X  │ │RED │ │YT  │  │  Per-site mini cards with meters
│   │542m│ │891m│ │200m│ │214m│  │
│   └────┘ └────┘ └────┘ └────┘  │
│                                  │
├──────────────────────────────────┤
│  [Home] [Board] [Pals]          │  Bottom nav, neon underline active
│  [Battle] [Chat]                │
└──────────────────────────────────┘
```

### Key Pages

**Dashboard (Home):** Big today-meters with neon glow, fun comparison text (rotates: "football fields", "Eiffel Towers", "lengths of your unread textbook"), per-site breakdown as small cards, weekly mini chart.

**Leaderboard:** Toggle tabs for World / Friends. Rows show rank #, avatar, username, total meters. Top 3 get special icons. Your own rank highlighted with neon border.

**Friends:** Search bar at top. Pending requests section (accept/reject buttons). Friend list with online indicators.

**Profile:** Username + avatar, total meters, member since. Achievements grid (locked ones shown as dark/grayed). Scroll history chart.

**Chat:** Message bubbles — user messages dark, AI responses with neon border glow.

**Battle (v3):** "Start Battle" button, friend selector, live battle view with real-time meters bar chart and floating insult overlay.

---

## Architecture

```
CHROME BROWSER
├── Content Scripts (per social media site)
│   ├── Scroll event listener (passive)
│   ├── Battle overlay (v3)
│   └── Sends deltas → Background SW every 5s
├── Background Service Worker
│   ├── Aggregates scroll data from all tabs
│   ├── Syncs to Supabase every 30s (chrome.alarms)
│   ├── Manages Realtime channels
│   └── Checks achievement thresholds
└── Popup UI (React)
    ├── Dashboard, Leaderboard, Friends, Profile
    ├── Chat (v2), Battles (v3)
    └── Settings

SUPABASE
├── Auth (email + password, username in profiles table)
├── PostgreSQL + RLS
├── Realtime Channels (battles, notifications)
└── Edge Functions → Gemini API
```

---

## Database Schema

### Tables

1. **profiles** — `id (FK→auth.users)`, `username (unique, lowercase, 3-20 chars)`, `display_name`, `avatar_url`, `is_public (default true)`, `total_meters_scrolled`, `created_at`
2. **scroll_sessions** — `user_id`, `site`, `pixels_scrolled`, `meters_scrolled`, `duration_seconds`, `session_start`, `session_end`
3. **friendships** — `requester_id`, `addressee_id`, `status (pending|accepted|rejected)`, unique constraint on pair
4. **achievements** — `user_id`, `trigger_type`, `trigger_value`, `title`, `description`, `icon`, `earned_at`
5. **battles** — `creator_id`, `status`, `winner_id`, `max_participants (2-4)` *(v3)*
6. **battle_participants** — `battle_id`, `user_id`, `status`, `meters_scrolled` *(v3)*
7. **battle_messages** — `battle_id`, `content`, `target_user_id` *(v3)*
8. **chat_messages** — `user_id`, `role`, `content` *(v2)*

### Leaderboard
- Materialized view `leaderboard_world` refreshed every 5 min via pg_cron

### Username Registration
- On sign-up: Supabase Auth creates user → database trigger auto-creates `profiles` row → user must set unique username before proceeding

---

## Scroll Tracking

- **Conversion:** `1 meter ≈ 3,779.53 CSS pixels` (from CSS spec: 96px = 1 inch)
- Both scroll directions count (`Math.abs(delta)`)
- **Passive** event listener (no scroll jank)
- Per-site scroll container selectors (Instagram=window, X=primaryColumn, YouTube=#content, etc.)
- Content script → Background SW every 5s → Supabase every 30s
- `chrome.storage.local` as write-ahead log (survives SW termination)

---

## Deployment Plan

### Development
1. `npm run dev` — Vite + CRXJS with HMR
2. Load `dist/` as unpacked extension in `chrome://extensions`
3. Supabase CLI for migrations: `supabase db push`
4. Edge Functions: `supabase functions deploy --all`

### Production (Chrome Web Store)
1. `npm run build` → production `dist/` folder
2. `zip -r doomscroller.zip dist/`
3. Upload to Chrome Web Store Developer Dashboard ($5 one-time fee)
4. Required: privacy policy, description, screenshots, category
5. Review: 1-3 business days

### Supabase Hosting
- Free tier: 500MB DB, 50K MAU, 500K function invocations/mo, 200 concurrent Realtime connections
- Gemini key stored via `supabase secrets set GEMINI_API_KEY=<key>`

---

## Implementation Tasks (Granular, Commit After Each)

### v1 — Core

#### Task 1: Project Scaffolding
- [ ] 1.1 Init npm workspace at root with `extension/` directory
- [ ] 1.2 Set up Vite + CRXJS + React + TypeScript in `extension/`
- [ ] 1.3 Configure Tailwind CSS with dark neon theme (custom colors, fonts)
- [ ] 1.4 Create `manifest.json` (MV3, permissions, content script matches)
- [ ] 1.5 Create `supabase/` directory with `config.toml`
- [ ] 1.6 Add `.gitignore`, `.env.example`

#### Task 2: Supabase Schema + Auth
- [ ] 2.1 Write migration `001_initial_schema.sql` (profiles, scroll_sessions, friendships tables)
- [ ] 2.2 Write migration `002_rls_policies.sql` (all RLS policies)
- [ ] 2.3 Write database trigger: auto-create profile row on auth.users insert
- [ ] 2.4 Set up Supabase client in `shared/supabase.ts`

#### Task 3: Auth UI
- [ ] 3.1 Build `Login.tsx` page (email + password + username for signup)
- [ ] 3.2 Build `Signup.tsx` page with username validation (unique, lowercase, 3-20 chars)
- [ ] 3.3 Auth state management (hook: `useAuth`)
- [ ] 3.4 Route guard: redirect to login if not authenticated

#### Task 4: Scroll Tracker (Content Script)
- [ ] 4.1 Build `site-config.ts` with scroll container selectors per site
- [ ] 4.2 Build `tracker.ts` — passive scroll listener, pixel accumulation, 5s flush to background
- [ ] 4.3 Build `shared/constants.ts` — pixel-to-meter conversion, site list
- [ ] 4.4 Build `shared/messages.ts` — typed message definitions for chrome.runtime

#### Task 5: Background Service Worker
- [ ] 5.1 Build `message-router.ts` — handle SCROLL_UPDATE messages from content scripts
- [ ] 5.2 Build `scroll-aggregator.ts` — batch per-site scroll data in chrome.storage.local
- [ ] 5.3 Build `alarm-handlers.ts` — 30s alarm to sync batched data to Supabase
- [ ] 5.4 Build `index.ts` — service worker entry, register alarms and listeners

#### Task 6: Dashboard Page
- [ ] 6.1 Build `Dashboard.tsx` — big today-meters stat with neon glow
- [ ] 6.2 Build fun comparison text rotation ("football fields", "Eiffel Towers", etc.)
- [ ] 6.3 Build per-site breakdown cards
- [ ] 6.4 Build `useScrollStats` hook (fetch from Supabase + local cache)
- [ ] 6.5 Build bottom navigation bar component

#### Task 7: Profile Page
- [ ] 7.1 Build `Profile.tsx` — own profile view (username, total meters, member since)
- [ ] 7.2 Build achievements grid placeholder (empty state for v1)
- [ ] 7.3 Build public profile view (for viewing other users)

#### Task 8: Friends System
- [ ] 8.1 Build `Friends.tsx` — search bar to find users by username
- [ ] 8.2 Build friend request sending (POST to friendships table)
- [ ] 8.3 Build pending requests section (accept/reject)
- [ ] 8.4 Build friends list with basic info
- [ ] 8.5 Build `useFriends` hook

#### Task 9: Leaderboards
- [ ] 9.1 Write migration for materialized view `leaderboard_world`
- [ ] 9.2 Build `Leaderboard.tsx` — World tab (top 50 + your rank)
- [ ] 9.3 Build Friends tab (only accepted friends + you)
- [ ] 9.4 Styling: top 3 get special icons, your row highlighted

#### Task 10: Settings + Polish
- [ ] 10.1 Build `Settings.tsx` — privacy toggle (public/private profile)
- [ ] 10.2 Create extension icons (16, 48, 128px)
- [ ] 10.3 Polish all pages — loading states, error states, empty states
- [ ] 10.4 Test full flow end-to-end

---

### v2 — AI Features

#### Task 11: Achievement Edge Function
- [ ] 11.1 Build `supabase/functions/generate-achievement/index.ts`
- [ ] 11.2 Gemini prompt: take milestone data + user stats → return sarcastic achievement JSON
- [ ] 11.3 Build threshold detection in background SW (after each sync)
- [ ] 11.4 Toast notification when achievement earned

#### Task 12: Achievement Display
- [ ] 12.1 Update Profile page — render earned achievements as badge grid
- [ ] 12.2 Locked achievements shown as grayed-out silhouettes
- [ ] 12.3 Achievement detail modal (title, description, when earned)

#### Task 13: AI Chatbot
- [ ] 13.1 Build `supabase/functions/chatbot/index.ts` — fetch user stats, build system prompt, call Gemini
- [ ] 13.2 Build `Chat.tsx` — message bubbles, input field, send button
- [ ] 13.3 Store conversation in `chat_messages` table, send last 20 as context
- [ ] 13.4 AI personality: sarcastic disappointed sibling who knows your scroll data

---

### v3 — Scroll Battles

#### Task 14: Battle Backend
- [ ] 14.1 Add battles, battle_participants, battle_messages tables (migration)
- [ ] 14.2 Build `supabase/functions/battle-insult/index.ts`
- [ ] 14.3 Set up Supabase Realtime channel pattern for battles

#### Task 15: Battle UI + Real-time
- [ ] 15.1 Build `Battles.tsx` — create battle, invite friends, lobby view
- [ ] 15.2 Build real-time battle view (live meters bar chart per participant)
- [ ] 15.3 Build battle-mode in background SW (500ms sync, Realtime broadcast)
- [ ] 15.4 Build content script overlay — floating NicoNico-style insult text
- [ ] 15.5 Idle detection (15s no scroll = quit), winner determination
- [ ] 15.6 Battle results screen + history

---

## Verification Plan

1. **Scroll tracking:** Load unpacked extension → open Instagram → scroll 30s → popup shows meters > 0 → Supabase table has data
2. **Auth:** Sign up with username → log out → log back in → session persists
3. **Friends:** 2 test accounts → send request → accept → both in friend lists
4. **Leaderboards:** Both accounts scroll → world board shows ranking → friends board filters correctly
5. **Achievements (v2):** Cross 100m threshold → Gemini called → achievement in profile
6. **Chatbot (v2):** Ask "what did I do today?" → response uses actual scroll data
7. **Battle (v3):** Create battle → both scroll → real-time updates → insults overlay → winner determined
8. **Privacy:** Set private → non-friend can't see profile
