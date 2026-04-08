# Dles Night

A real-time social viewing platform built for a Discord group who play daily reset puzzle games ("dles") together most evenings. One person — Julie — hosts and plays while everyone else watches, shouts suggestions, and contributes through a shared social layer.

This is a **Turborepo monorepo** containing two applications and a shared package:

```
dles-night-monorepo/
├── apps/
│   ├── electron/     ← Julie's host app (electron-vite + React)
│   └── web/          ← Viewer web app (React + Vite)
├── packages/
│   └── shared/       ← Shared library (@dles-night/shared)
├── package.json      ← Turborepo workspace root
└── turbo.json
```

---

## The Concept

Every evening, a Discord group of ~15 people open up a series of daily puzzle games — Wordle-style games that reset each day and are identical for everyone. The games range from word puzzles to music identification (Heardles) to movie grid challenges. Seven of the group's regular games are audio-based.

Before this app, the experience was Julie screen sharing her browser on Discord while everyone watched and shouted suggestions over voice chat. It worked, but it meant Julie had to constantly switch between the game and Discord to see what people were saying, and there was no persistent social layer to draw on, annotate, or leave notes across.

Dles Night gives the group a dedicated space: Julie plays in the Electron app where the game is embedded right next to her chat window, and viewers join the web app to watch her game stream alongside a shared canvas, sticky notes, and chat.

---

## Two Apps, One Experience

### Electron App — `apps/electron/`

Julie's host experience. The app solves a problem no web browser can: loading external game sites in an embedded native window while keeping chat and suggestions visible alongside them, then streaming that game view with full audio to all viewers.

**Key features:**
- Every game in the rotation loads natively via `WebContentsView` — no iframe blocking
- One-click stream to viewers via WebRTC, capturing game video and audio silently with no picker dialog
- Real-time chat sidebar always visible alongside the game
- Transparent overlay window renders viewer drawings and sticky notes directly over the game
- Main menu with Play button and mode toggles (Random Mode live, Drinking/Chaos coming)
- Win/Fail tracking per game with persistent all-time win rate via Supabase
- End of session recap with Discord-ready emoji summary
- Packaged as a Windows `.exe` installer via electron-builder
- Auto-updates via `electron-updater` and GitHub Releases

### Web App — `apps/web/`

The viewer experience. Deployed on Vercel, accessible from any browser.

**Key features:**
- Live WebRTC stream of Julie's game — video and full audio
- Real-time chat with coloured usernames and online list
- Shared drawing canvas — pen, eraser, full colour picker, draggable toolbar
- Sticky notes — draggable, colour coded, synced in real time, late-joiner sync
- Session tracking — results, win rates, session notes log
- End of session recap screen
- ICE connection state monitoring with user-facing messages and a reconnect button

### Shared Package — `packages/shared/`

Published internally as `@dles-night/shared`. Both apps import from a single line:

```js
import { DlesRTC, SharedCanvas, SessionChat, SessionSync, StickyNotes, supabase } from '@dles-night/shared'
```

| File | Export | Purpose |
|---|---|---|
| `supabase.js` | `supabase` | Supabase client |
| `webrtc.js` | `DlesRTC` | WebRTC host broadcast and viewer join |
| `canvas.js` | `SharedCanvas` | Real-time shared drawing canvas |
| `chat.js` | `SessionChat` | Real-time chat |
| `notes.js` | `StickyNotes` | Real-time sticky notes with late-joiner sync |
| `session.js` | `SessionSync` | Session state broadcast — results, dle list, win rate |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo |
| Web frontend | React + Vite |
| Electron frontend | electron-vite + React |
| Styling | Tailwind CSS v4 |
| Web hosting | Vercel |
| Database + Realtime | Supabase |
| WebRTC | Native browser APIs |
| Packaging | electron-builder (NSIS) |
| Auto-updates | electron-updater + GitHub Releases |
| TURN server | Metered.ca (free tier) |

---

## Key Technical Decisions

### Why Electron for Julie

Web browsers enforce iframe security at multiple levels: `X-Frame-Options` HTTP headers, `Content-Security-Policy: frame-ancestors`, and JavaScript frame-busting code that detects `window.top !== window.self` and breaks out immediately. A definitive test confirmed the frame-busting issue: loading a dle in a plain `file://` HTML page worked perfectly because there's no parent frame. Nesting it inside any iframe — even from `file://` — broke it instantly.

Electron bypasses all three layers: `webSecurity: false` in the `BrowserWindow` config, response header stripping via `session.defaultSession.webRequest.onHeadersReceived`, and a relaxed CSP. Every dle in the rotation loads natively.

### Why WebContentsView — The Streaming Solution

The core challenge was capturing just the embedded game content (not the full app window) as a `MediaStream` with audio, so viewers only see the game and not Julie's duplicate chat sidebar.

An `<iframe>` sub-frame doesn't work for this — its `webContents` is not a first-class top-level object, making per-frame audio capture impossible through Electron's APIs.

A `WebContentsView` is created and managed entirely from the main process with its own top-level `webContents` and a proper `WebFrameMain` instance. This is what Electron's capture APIs require.

`session.defaultSession.setDisplayMediaRequestHandler()` intercepts the renderer's `getDisplayMedia()` call before it reaches the OS and silently provides the game view as the source:

```javascript
session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
  callback({
    video: dleView.webContents.mainFrame,
    audio: dleView.webContents.mainFrame,
    enableLocalEcho: true
  })
})
```

`enableLocalEcho: true` is critical — without it Julie loses audio locally while streaming, making audio-based Heardles unplayable for her. With it, she hears the game normally while the stream flows to viewers.

### Why a Separate BrowserWindow for the Overlay

`WebContentsView` renders at the native compositor level, always above the renderer DOM. CSS z-index has no effect on it. This means DOM elements — canvas, sticky notes — cannot visually overlay the game.

The solution is a three-layer stack:
1. **Base renderer** — React app (sidebar, chat, controls, titlebar)
2. **dleView** (`WebContentsView`) — the embedded game
3. **overlayWindow** (transparent child `BrowserWindow`) — viewer drawings and sticky notes

The overlay uses `setIgnoreMouseEvents(true, { forward: true })` so all input passes through to the game beneath. `WebContentsView` has no equivalent API — this is why the overlay must be a `BrowserWindow` rather than another view.

### Why Frameless + Transparent

`transparent: true` on a `BrowserWindow` requires `frame: false` on Windows. This necessitated building a custom 32px titlebar with IPC-based minimize/maximize/close controls. The trade-off: Windows 11 DWM shadow and rounded corners are disabled.

### Coordinate Normalisation

Canvas strokes and sticky notes use 0–1 normalised coordinates for cross-resolution support. Before broadcasting, coordinates are divided by the sender's canvas dimensions. On receiving, they are multiplied by the receiver's canvas dimensions.

The web app canvas is sized to match the actual video content area — accounting for `object-contain` letterboxing — not the full panel. This uses `getVideoContentRect()` with `videoEl.videoWidth/videoHeight` to calculate what area the stream actually occupies. Without this, drawings would misalign between hosts and viewers on different screen sizes.

### Random Mode and the Aukspot List

Random Mode fetches from [dles.aukspot.com](https://dles.aukspot.com) — an open-source curated index of 696+ daily web games maintained by aukspot. When active, the Electron app fetches the raw JSON at session start, shuffles the full list, and takes 20 random entries as the session's dle array. This list is then broadcast to all viewers via `SessionSync` so both apps operate on the same set of games throughout the session. If the fetch fails, the app falls back to the default hardcoded rotation.

### Supabase as a WebRTC Signalling Server

Supabase Realtime broadcast channels handle WebRTC signalling — offers, answers, and ICE candidates — between Julie and all viewers. It was already in the stack, it works without needing a separate WebSocket server, and the channel is only needed for the initial handshake. After that, the stream is fully peer-to-peer and Supabase is no longer involved.

---

## The Dev Story

### Attempt 1 — Iframes in the Web App

The original plan was to embed dle games in iframes. The first obstacle was `X-Frame-Options` headers. A browser extension to strip them seemed like the fix — but after installing it, the games still wouldn't load. Inspecting the response headers revealed no `X-Frame-Options` present at all. The extension wasn't the issue.

The real culprit was JavaScript frame-busting: code inside each game that detects `window.top !== window.self` and immediately redirects the page. The definitive test: load the game in a raw `file://` HTML file. It worked perfectly — no parent frame, no frame-buster trigger. Nest it inside another iframe and it broke instantly. Iframes in any web browser context were definitively ruled out.

### Attempt 2 — WebRTC Screen Share from Browser

The fallback was WebRTC streaming from a browser tab. This worked technically but created a worse experience — viewers would see Julie's whole browser window including her tabs and toolbars. More importantly, Julie still had to switch between the game and Discord to read chat suggestions.

Getting Supabase Realtime channels working reliably between browser windows took significant debugging. An invisible trailing newline on the Supabase anon key (`%0A` in the URL) was corrupting every WebSocket URL. A stale closure bug caused the `offerSent` flag to always report `index 0`. Each issue looked systemic but turned out to be one precise thing.

### Attempt 3 — Electron with WebContentsView

Moving to Electron resolved the iframe problem immediately. Every dle loaded natively. But viewer streaming was still unsolved — the stream needed to show only the game with audio, not Julie's full app.

Several approaches were rejected: screenshot frame capture (no audio), streaming the whole Electron window (viewers would see the duplicate chat sidebar), a second popup window for the game (defeats the purpose of the app).

The breakthrough was combining `WebContentsView` with `setDisplayMediaRequestHandler`. The first attempt passed `dleView.webContents` as the video source and got `TypeError: video must be a WebFrameMain or DesktopCapturerSource`. The fix was `.mainFrame` — the API specifically requires a `WebFrameMain` instance. With `enableLocalEcho: true` added, Julie keeps her audio while streaming. The result: a clean, scoped stream of exactly the game.

### The Overlay Problem

Once the stream worked, a new problem appeared: how do viewers' drawings and sticky notes appear over the game? The first attempt was DOM layering — position a canvas above the game panel with CSS z-index. It had no effect. `WebContentsView` renders at the native compositor level, above all DOM elements regardless of z-index.

The solution was a transparent child `BrowserWindow` positioned to exactly match the game panel. It loads a minimal overlay page with a canvas and notes container, subscribes to Supabase Realtime directly, and renders incoming strokes and notes. `setIgnoreMouseEvents(true, { forward: true })` makes it invisible to input — clicks and keypresses pass straight through to the game beneath.

### Monorepo Migration and Deployment

Moving both apps into a Turborepo monorepo created several unexpected problems. npm workspaces ignores per-workspace `.npmrc` files when installing from root. Scoped package names in electron-builder create subfolders in artifact output paths, requiring explicit `artifactName` in `electron-builder.yml`. Turborepo's auto-detection of build commands overrides Vercel's build settings — the build command had to be set manually in the Vercel dashboard.

The most dangerous issue: `ELECTRON_RUN_AS_NODE=1` set as a Windows system environment variable causes Electron to run as plain Node.js. `require('electron')` returns the binary path string instead of the Electron API object. Symptoms: `electron.app` is `undefined`. This wasted significant debugging time — it's now the first thing checked if Electron API issues recur.

### WebRTC Signalling Stability

The `host-ready` broadcast fires up to 5 times at 2-second intervals on startup. Before the `offerInFlight` guard was added, a viewer subscribing early could receive multiple pulses before their first connection completed — each one tearing down the current peer connection and sending a fresh offer. The host would receive 5 simultaneous offers, create 5 separate peer connections, and all but one would collapse. The fix was a boolean flag that blocks new offers while one is already in flight.

React's StrictMode double-invokes effects in development mode. This caused SessionSync's `connect()` to run twice, tracking presence twice on the same channel — producing ghost user entries in the online list that persisted until Supabase's presence TTL expired. Removing StrictMode and nulling out `this.channel` on disconnect resolved both the duplicate entries and the stale channel references.

Passing React state into a `useEffect` to initialise a class instance is a known timing trap. `setActiveDles(dles)` enqueues a React state update — by the time the effect runs on the next render, the state variable may still hold the previous value. The fix was a ref (`pendingDlesRef`) assigned synchronously in the same event handler as the fetch, carrying the fresh value across the render boundary without depending on React's update cycle.

---

## Deployment

### Web App — Vercel

Deploys automatically on push to `main`.

- **Build command:** `cd apps/web && npm run build` (set manually in Vercel dashboard — Turborepo detection overrides it otherwise)
- **Output directory:** `apps/web/dist`
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`

### Electron App — GitHub Actions + GitHub Releases

Triggered only on `v*` tag pushes. Never fires on branch pushes.

```bash
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

Web-only changes: push to `main` only, no tag. Electron changes always require a tag.

electron-builder produces `DlesNight-Setup-*.exe` and `latest.yml` at `apps/electron/dist-installer/`. Auto-updates are handled by `electron-updater` pointing at GitHub Releases.

---

## Local Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/BritishBambi/dles-night-monorepo.git
cd dles-night-monorepo
npm install
```

Create `.env` files in both `apps/web/` and `apps/electron/`:

```
VITE_SUPABASE_URL=https://hulwvnpcbksifrxucnhz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_TURN_URL=turn:global.relay.metered.ca:443
VITE_TURN_USERNAME=<metered username>
VITE_TURN_CREDENTIAL=<metered credential>
```

TURN vars are optional — falls back to STUN-only if not set.

> **Critical:** Do not set `ELECTRON_RUN_AS_NODE=1` as a system environment variable. This causes Electron to run as plain Node.js and breaks the entire app.

### Running

```bash
# Web app
cd apps/web && npm run dev

# Electron app
cd apps/electron && npm run dev
```

### Building the Electron Installer

Requires Windows with Developer Mode enabled (Settings → System → For developers).

```bash
cd apps/electron && npm run build:win
```

Installer appears at `apps/electron/dist-installer/`. Not committed to the repository.

---

## Known Issues

- **Stream requires reconnect on first join** — if a viewer connects before Julie starts streaming, they need to click Reconnect after she starts. The viewer's initial offer fires before the stream exists. A "stream started" event is the planned fix.
- **Mobile layout** — portrait mode is broken. Toolbar covers the stream, proportions are off. A responsive pass is planned.
- **ICE failures on strict NAT** — without a TURN relay, WebRTC connections can fail. The Reconnect button handles this manually. The free tier TURN server (Metered.ca) is limited to 500MB/month.
- **Opera GX GPU compositor** — can cause a black screen due to disabled GPU compositing. Switching to Chrome resolves it.
- **Windows Defender warning** — the installer is unsigned (expected for a private app). Click More info → Run anyway.
- **Windows 11 visual regressions** — DWM shadow and rounded corners are disabled due to `transparent: true` on the main `BrowserWindow`.

---

## Planned Features

### Dle Manager
A visual dle selector built into the Electron app. Organised by aukspot category. Toggle which games are in the active rotation, drag to reorder. Persists to Supabase and syncs to viewers at session start.

### Drinking Mode
Pop-ups triggered by specific in-game events or terms during the session.

### Chaos Mode
Random events, time limits, distracting auto-notes, general mayhem.

### Mobile Layout Polish
Responsive pass for portrait mobile — collapsible sidebar, repositioned toolbar, proper proportions.

---

## Acknowledgements

- Julie — for being the host, product owner, and QA tester simultaneously, and for designing the branding
- [aukspot/dles](https://github.com/aukspot/dles) — the open-source index of 696+ daily games that powers Random Mode
- Claude (Anthropic) — architecture, planning, and implementation throughout the build