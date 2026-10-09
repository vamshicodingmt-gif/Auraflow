# AuraFlow · Goth Edition

Gothic voice dictation for macOS, Windows and Linux. Press **Option + Space** on macOS (or **Alt + Space** elsewhere), speak, and AuraFlow transcribes your words with Gemini, polishes them, and pastes the result into whatever app has your cursor.

- Obsidian black, blood-red accents, blackletter headings, and a dark right-click tray menu
- A floating recording pill with a live waveform, a pulsing red tray icon while you record, and optional sound cues
- Speech-to-text with `gemini-3.5-transcribe` (smart formatting and your custom vocabulary), then a refinement pass that streams in
- Six output styles: **Clean**, **Formal**, **Casual**, **Email**, **Bullets**, **Verbatim**
- Spoken formatting: "new line", "new paragraph", "comma", "question mark", "scratch that" and friends
- Local history with search, copy and delete; offline cleanup if the network drops
- Bring-your-own Gemini key, stored encrypted with your OS keychain

The app is built with Electron, TypeScript and Vite. Everything runs from this repository.

---

## Quick start

Requirements: **Node.js 22.12 or newer** and npm. Installing Electron downloads its runtime (about 100 MB) once.

```bash
git clone https://github.com/vamshicodingmt-gif/Auraflow.git
cd Auraflow
npm install
npm run dev
```

`npm run dev` starts the renderer dev server, rebuilds the main process when files change, and launches AuraFlow. On first launch the **Settings** window opens so you can paste your Gemini key.

### Get a Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/app/apikey) and create a key.
2. In AuraFlow, open **Settings → Engine**, paste the key, and press **Save key**. AuraFlow runs a quick test call and reports the result.

You can also provide the key through the environment instead: `GEMINI_API_KEY=... npm run dev`. AuraFlow never reads `.env` files; use your shell or your OS environment.

## Using AuraFlow

1. Click into any text field in any app.
2. Press **Option + Space** (macOS) or **Alt + Space** (Windows/Linux). The pill appears and starts listening.
3. Speak. Press the hotkey again to stop. Press **Esc** to cancel.
4. The pill shows *Transcribing* → *Polishing* (the text streams in) → *Pasted*. Your previous clipboard is restored afterwards.

Clicking the tray icon opens the dashboard. Right-clicking it opens the styled menu: **Status**, **Open Dashboard**, **Settings**, **Check for Updates**, **Quit Flow (Goth Edition)**. On Linux desktops that don't report tray clicks, the same items appear in the native menu.

### Settings at a glance

| Section | What it controls |
| --- | --- |
| Engine | Gemini key (test, replace, remove), refinement model: Flash-Lite (fastest, default), Flash, or 3.8 Flash (highest quality) |
| Hotkey | Click the shortcut and press the new combination. Invalid or taken combinations are rejected and the old one stays active |
| Output | Output style, language hint (auto-detect by default), custom vocabulary (up to 100 terms recommended) |
| Behaviour | Auto-paste, restore clipboard, sound cues, keep history, launch at login, pill position, longest recording (1, 2 or 5 minutes) |
| Microphone | Input device and a live level meter |
| Permissions | Status of microphone and Accessibility access, with shortcuts to the system settings |

### Your data

AuraFlow stores its files in the standard per-user data folder:

- macOS: `~/Library/Application Support/AuraFlow/`
- Windows: `%APPDATA%\AuraFlow\`
- Linux: `~/.config/AuraFlow/`

It keeps `settings.json`, `history.json` (turn off *Keep history* to stop saving), and `secrets.json`, which holds your API key encrypted with the OS keychain when one is available. Audio is recorded only while you dictate and is sent to Google Gemini for transcription. Requests are sent with `store: false`, which tells the Interactions API not to keep them for later retrieval. Recordings are held in memory only and are never written to disk.

---

## Permissions

- **Microphone** is requested the first time you dictate. macOS shows the prompt once; grant it to AuraFlow.
- **Accessibility (macOS only)** is needed for auto-paste, because AuraFlow sends Command+V through System Events. Enable AuraFlow under *System Settings → Privacy & Security → Accessibility*. Settings → Permissions has a shortcut. Without it, dictation still works and the text is left on your clipboard.
- **Linux auto-paste** uses `xdotool` on X11 (install it with your package manager). Wayland sessions fall back to copy-only.
- **Windows** pastes with PowerShell's `SendKeys`. Some elevated (administrator) windows ignore synthetic keys; the text stays on the clipboard in that case.

## Building installers

```bash
npm run dist          # current operating system
npm run dist:mac      # DMG and ZIP (arm64 + x64)
npm run dist:win      # NSIS installer (with desktop and Start Menu shortcuts) and a portable .exe
npm run dist:linux    # AppImage and .deb
```

Artifacts land in `release/`. Builds are **unsigned** unless you configure signing: on macOS, right-click the app and choose *Open* the first time; on Windows, SmartScreen may warn until the installer is signed. Code-signing and notarization settings live in `electron-builder.yml` and can be supplied through electron-builder's standard environment variables (`CSC_LINK`, `APPLE_ID` and friends).

The workflows in `.github/workflows/` run the tests and typecheck on every push and pull request, and package all three platforms when a `v*` tag is pushed.

## Icons and branding

The mark is a gothic dagger cross: a blood-red blade and hilt on an obsidian disc. `scripts/generate_icons.py` draws every icon from one geometry definition:

- `build/icon.icns` (macOS app icon), `build/icon.ico` (Windows, 16 to 256 px), `build/icons/*.png` (Linux)
- `assets/tray/tray_icon*.png`: a monochrome template for the macOS menu bar, which macOS tints for light and dark menu bars
- `assets/tray/tray_color*.png`: the Windows and Linux tray icon
- `assets/tray/tray_recording_*`: six-frame pulsing red glow used while recording
- `assets/brand/*.svg`: vector sources

Regenerate with `pip install pillow` and then `python3 scripts/generate_icons.py`.

The palette and typography are inspired by a dark streetwear-gothic direction: `#0A0A0A` and `#121212` surfaces, `#E50914` / `#8B0000` accents, white and ash text, UnifrakturMaguntia headings, Archivo labels, Inter body text and JetBrains Mono for transcripts. The fonts ship inside the app (SIL Open Font License), so nothing is fetched at runtime. The app does not use any third-party brand names, logos or trademarks.

---

## How it works

```
hotkey ─► main process ─► recording pill (renderer)
                              │  AudioWorklet → 16 kHz mono PCM → WAV
                              ▼
          Gemini: gemini-3.5-transcribe (smart mode + custom vocabulary)
                              │
                              ▼   (skipped for Verbatim)
          Gemini: refinement model, streamed over SSE, style + vocabulary rules
                              │   (falls back to offline rule-based cleanup on failure)
                              ▼
          clipboard write → platform paste shortcut → restore previous clipboard
                              │
                              ▼
          history.json · dashboard · tray status
```

Project layout:

```
src/
  main/      Electron main process: windows, tray, hotkey, dictation state machine,
             paste, settings/history/secret stores, IPC, updates, permissions
  preload/   Sandboxed bridge that exposes a typed window.auraflow API
  shared/    Gemini client, prompts, WAV encoding, SSE parser, hotkey and settings logic
  renderer/  Pill, dashboard, settings and tray UIs (Vite multi-page app)
tests/       Vitest suites, including main-process smoke tests against a fake electron module
scripts/     Dev runner, bundler, icon generator
build/       App icons and macOS entitlements used by electron-builder
assets/      Tray icons and brand vectors
```

`gemini-code-1786681235121.html` is the original single-file web prototype. It is kept for reference and is not used by the app.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run AuraFlow from source with hot reload for the UI |
| `npm run dev:web` | Browser preview of the UI on port 5173, with a clearly labelled in-memory stand-in for the Electron bridge |
| `npm test` | Run the unit and smoke tests |
| `npm run typecheck` | Strict TypeScript checks for the main process and the renderer |
| `npm run build` | Typecheck, bundle the main and preload processes, and build the renderer |
| `npm start` | Build, then launch the built app with `electron .` |
| `npm run dist*` | Package installers (see above) |
| `npm run icons` | Regenerate icons (needs Python and Pillow) |

Environment variables: `GEMINI_API_KEY` (fallback key), `AURAFLOW_DEV_PORT` (dev server port, default 5173), `AURAFLOW_SANDBOX=1` (keep Chromium's sandbox on Linux during `npm run dev`; AuraFlow disables it there by default because npm installs cannot set the sandbox helper's permissions).

## Known limitations

- Dictation is **toggle based** (press to start, press to stop). Electron's global shortcuts do not report key release, so push-to-talk is not available yet.
- Text is pasted when the recording finishes. Live partial captions would need the streaming `gemini-3.5-transcribe-live` endpoint, which this version does not use.
- Recordings are capped at 5 minutes so each request stays under Gemini's 20 MB inline-audio limit.
- On macOS, Option + Space is also the non-breaking-space shortcut in some apps. Choose another combination in Settings if that matters to you.
- Linux tray icons need an AppIndicator-compatible desktop; GNOME users may need the AppIndicator extension.

## Development status

The unit and smoke tests (`npm test`), strict typechecks, production builds, and the browser-rendered UI were verified during development. The packaged apps, real microphone capture, auto-paste into other applications, and live Gemini calls still need a first run on your machine. `npm run dev` is the quickest way to check them.

## License

No license has been chosen yet. Add one before distributing the source or binaries.
