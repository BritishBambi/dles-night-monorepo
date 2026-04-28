# Dles Night

A real-time social viewing platform for a Discord group who play daily reset puzzle games together. Julie hosts and plays in the Electron app while up to 15 viewers watch her live stream in the browser, contributing through shared chat, a drawing canvas, and sticky notes.

This is a Turborepo monorepo containing two apps and a shared package.

---

## Repository Structure

```
dles-night-monorepo/
├── apps/
│   ├── electron/     Julie's host app (electron-vite + React)
│   └── web/          Viewer web app (React + Vite)
├── packages/
│   └── shared/       Shared library (@dles-night/shared)
├── package.json      Turborepo workspace root
└── turbo.json
```

---

## Applications

### Electron App (`apps/electron/`)

Julie's host experience. The Electron app exists to solve a problem no web browser can: loading external game sites in an embedded native window while keeping chat visible alongside them, then streaming that game view with full audio to all viewers.

Features:
- Games load natively via `WebContentsView`, bypassing all iframe restrictions
- One-click WebRTC stream to viewers capturing game video and audio, with no picker dialog
- Chat sidebar visible alongside the game at all times
- Transparent overlay window renders viewer drawings and sticky notes over the game
- Main menu with Play button and mode toggles (Random Mode live; Drinking and Chaos modes coming)
- Win/Fail tracking per game with persistent all-time win rate via Supabase
- End-of-session recap with a Discord-ready emoji summary
- Packaged as a Windows `.exe` installer via electron-builder
- Auto-updates via `electron-updater` and GitHub Releases

### Web App (`apps/web/`)

The viewer experience. Deployed on Vercel, accessible from any browser.

Features:
- Live WebRTC stream of Julie's game with full audio
- Real-time chat with coloured usernames and an online list
- Shared drawing canvas with pen, eraser, full colour picker, and a draggable toolbar
- Sticky notes: draggable, colour-coded, synced in real time with late-joiner support
- Session tracking: results, win rates, and a session notes log
- End-of-session recap screen
- ICE connection state monitoring with user-facing status messages and a reconnect button

### Shared Package (`packages/shared/`)

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
| `session.js` | `SessionSync` | Session state broadcast: results, dle list, win rate |

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

## Architecture Notes

### Why Electron

Web browsers enforce iframe security at multiple levels: `X-Frame-Options` HTTP headers, `Content-Security-Policy: frame-ancestors` directives, and JavaScript frame-busting code that detects `window.top !== window.self` and redirects immediately. Electron bypasses all three via `webSecurity: false`, response header stripping via `session.defaultSession.webRequest.onHeadersReceived`, and a relaxed CSP. Every game in the rotation loads natively.

### Streaming with WebContentsView

The core challenge was capturing just the embedded game content as a `MediaStream` with audio so viewers see only the game and not Julie's chat sidebar. A `WebContentsView` is created from the main process with its own top-level `webContents` and a proper `WebFrameMain` instance, which is what Electron's capture APIs require.

`setDisplayMediaRequestHandler()` intercepts the renderer's `getDisplayMedia()` call and silently provides the game view as the stream source:

```javascript
session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
  callback({
    video: dleView.webContents.mainFrame,
    audio: dleView.webContents.mainFrame,
    enableLocalEcho: true
  })
})
```

`enableLocalEcho: true` is required so Julie hears the game locally while it streams to viewers. Seven of the group's regular games are audio-based, making this non-negotiable.

### Overlay Architecture

`WebContentsView` renders at the native compositor level, above all renderer DOM regardless of z-index. To overlay viewer drawings and sticky notes on top of the game, the app uses a three-layer stack:

1. **Base renderer**: React app (sidebar, chat, controls, titlebar)
2. **dleView**: `WebContentsView` running the embedded game
3. **overlayWindow**: transparent child `BrowserWindow` rendering viewer drawings and notes

The overlay uses `setIgnoreMouseEvents(true, { forward: true })` so all input passes through to the game. `WebContentsView` has no equivalent API, which is why the overlay is a `BrowserWindow` rather than another view.

### Frameless Window

`transparent: true` on a `BrowserWindow` requires `frame: false` on Windows, which meant building a custom 32px titlebar with IPC-based window controls. The trade-off is that Windows 11 DWM shadow and rounded corners are disabled.

### Coordinate Normalisation

Canvas strokes and sticky notes use 0-1 normalised coordinates for cross-resolution support. Coordinates are divided by the sender's canvas dimensions before broadcasting and multiplied by the receiver's dimensions on render.

The web app canvas is sized to match the actual video content area, accounting for `object-contain` letterboxing, using `getVideoContentRect()` with `videoEl.videoWidth/videoHeight`. Without this, drawings would misalign between the host and viewers on different screen sizes.

### Random Mode

When active, the Electron app fetches the [aukspot/dles](https://github.com/aukspot/dles) JSON at session start (696+ daily games), shuffles the full list, and takes 20 random entries as the session's game array. That list is broadcast to all viewers via `SessionSync` so both apps operate on the same set throughout the session. Falls back to the hardcoded rotation if the fetch fails.

### WebRTC Signalling

Supabase Realtime broadcast channels handle WebRTC signalling (offers, answers, and ICE candidates) between the host and viewers. The channel is only needed for the initial handshake; once connected the stream is fully peer-to-peer.

---

## Deployment

### Web App

Deploys automatically on push to `main`.

- **Build command:** `cd apps/web && npm run build` (set manually in Vercel dashboard; Turborepo auto-detection overrides the default otherwise)
- **Output directory:** `apps/web/dist`
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`

### Electron App

Triggered only on `v*` tag pushes. The workflow never fires on branch pushes.

```bash
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

Web-only changes push to `main` only. Any changes to `apps/electron/` or `packages/shared/` require a version tag. electron-builder produces `DlesNight-Setup-*.exe` and `latest.yml` at `apps/electron/dist-installer/`. Auto-updates are handled by `electron-updater` pointing at GitHub Releases.

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

TURN variables are optional and fall back to STUN-only if not set.

> **Important:** Do not set `ELECTRON_RUN_AS_NODE=1` as a system environment variable. This causes Electron to run as plain Node.js and breaks the entire app. If `electron.app` is undefined, check for this variable first.

### Running

```bash
# Web app
cd apps/web && npm run dev

# Electron app
cd apps/electron && npm run dev
```

### Building the Electron Installer

Requires Windows with Developer Mode enabled (Settings > System > For developers).

```bash
cd apps/electron && npm run build:win
```

The installer is output to `apps/electron/dist-installer/` and is not committed to the repository.

---

## Known Issues

- **Stream requires reconnect on first join.** If a viewer connects before Julie starts streaming, they need to click Reconnect after she starts. The viewer's initial offer fires before the stream exists. A dedicated "stream started" event is the planned fix.
- **Mobile layout is broken in portrait mode.** The toolbar covers the stream and proportions are off. A responsive pass is planned.
- **ICE failures on strict NAT.** Without a TURN relay, WebRTC connections can fail for users behind symmetric NAT. The Reconnect button is the manual workaround. The free Metered.ca TURN tier is capped at 500MB/month.
- **Opera GX black screen.** Disabled GPU compositing in Opera GX can produce a black screen. Switching to Chrome resolves it.
- **Windows Defender warning.** The installer is unsigned, which is expected for a private app. Click "More info" then "Run anyway".
- **Windows 11 visual regressions.** DWM shadow and rounded corners are disabled due to `transparent: true` on the main `BrowserWindow`.

---

## Planned Features

### Dle Manager
A visual game selector built into the Electron app. Organised by aukspot category with toggles to control which games are in the active rotation and drag-to-reorder support. Persists to Supabase and syncs to viewers at session start.

### Drinking Mode
Pop-ups triggered by specific in-game events or terms during the session.

### Chaos Mode
Random events, time limits, distracting auto-notes, and general mayhem.

### Mobile Layout Polish
Responsive pass for portrait mobile: collapsible sidebar, repositioned toolbar, proper proportions.

---

## Acknowledgements

- Julie, for being the host, product owner, and QA tester simultaneously, and for designing the branding. Oh yeah, also my wife.
- [aukspot/dles](https://github.com/aukspot/dles), the open-source index of 696+ daily games that powers Random Mode
