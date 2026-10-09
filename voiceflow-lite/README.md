# VoiceFlow-Lite

Push-to-talk dictation for macOS and Windows. Press a hotkey, speak, and VoiceFlow-Lite transcribes
your words with Gemini, cleans them up (fillers out, punctuation and capitalization in, your own
vocabulary kept exact), and pastes the result into whichever app has the cursor.

```
hotkey ─► microphone (16 kHz mono, kept in memory)
        ─► Gemini transcription   gemini-3.5-transcribe
        ─► Gemini cleanup         gemini-3.5-flash-lite, strict system instruction
        ─► paste                  Cmd+V (macOS) or Ctrl+V (Windows / Linux)
```

- **Two ways to talk.** Double-tap Left Control to start, double-tap again to stop. Or switch to
  *hold to talk* and hold a key while you speak.
- **Visible while recording.** A small floating pill shows a live waveform, then each stage as it runs.
- **Four cleanup styles.** Casual, Balanced, Polished and Code-focused.
- **Personal dictionary.** Names, product words and jargon are passed to transcription and kept exact.
- **Settings window.** Hotkey, microphone, cleanup, dictionary and API key, all in one place.
- **Key storage.** Your Gemini key is kept in the OS keychain, or in a git-ignored `.env` file.
- **Small.** Plain Python and Tk, no Electron. About 3,200 lines of package code, plus 74 tests.

> **Status: 0.1.0.** The unit tests, type checks and lint pass, and the command-line pipeline runs end
> to end against a local stand-in for the Gemini API. Live Gemini calls, microphone capture, global
> hotkeys, auto-paste and the window layout have not yet been run on real macOS or Windows hardware.
> Run the checks in [Development](#development) and `python -m voiceflow --check-key` before you rely on
> it. See [Limitations](#limitations).

## Contents

- [Quick start](#quick-start)
- [Using it](#using-it)
- [Settings](#settings)
- [Gemini API key](#gemini-api-key)
- [Permissions](#permissions)
- [Command-line tools](#command-line-tools)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Dependencies](#dependencies)
- [Development](#development)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

## Quick start

### 1. Requirements

- **Python 3.10 or newer.** On Windows, use the python.org installer and keep *tcl/tk* ticked. On macOS,
  use the python.org installer, or Homebrew with `brew install python-tk`.
- **A Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey).
- **macOS 12 or newer, or Windows 10 / 11.** Linux under X11 works on a best-effort basis.

### 2. Get the code

```bash
git clone https://github.com/vamshicodingmt-gif/Auraflow.git
cd Auraflow/voiceflow-lite
```

### 3. Install

macOS or Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 4. Add your Gemini key

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Open `.env` and paste your key after `GEMINI_API_KEY=`. The file is git-ignored, so the key never reaches
the repository. You can skip this step and enter the key in **Settings → API key** instead. It is then
saved to your OS keychain.

### 5. Run

```bash
python -m voiceflow
```

On Windows, `pythonw -m voiceflow` starts without a console window.

### 6. Grant permissions

The control panel lists every permission the app needs and whether it is allowed. Each row has an
**Open System Settings** button. See [Permissions](#permissions).

## Using it

| Action | How |
| --- | --- |
| Start dictation | Double-tap **Left Control** (the default hotkey) |
| Stop and paste | Double-tap the same key again |
| Hold to talk (optional) | Settings → Hotkey & audio → *Hold to talk*. Hold the key while you speak, release to paste |
| Cancel | **Esc** while recording |
| Dictate without the hotkey | **Start dictation** in the control panel (the paste still goes to the app that had focus) |

The indicator moves through **Listening…** (live waveform), **Transcribing…**, **Cleaning up…**, and then
**Pasted** (or **Copied** when auto-paste is off). Errors stay on screen for a few seconds and are also
shown in the control panel.

Tips:

- Put the cursor where you want the text before you start. The paste goes to whichever app is focused
  when the text is ready.
- In hold mode, choose a key you rarely use in shortcuts, such as Right Option or F8.
- A double-tap only counts when no other key was pressed in between, so Ctrl+C and friends never start
  a recording by accident.

## Settings

Open **Settings…** from the control panel. Changes apply immediately and are saved to `settings.json`.

| Setting | Default | What it does |
| --- | --- | --- |
| Hotkey mode | Double-tap | *Double-tap* to start and stop, or *Hold to talk* |
| Key | Left Control | The trigger key. Pick from the list or press **Record key** |
| Microphone | System default | Input device. Listed by name, so it survives reboots |
| Paste automatically | On | Paste when the text is ready. Off copies to the clipboard instead |
| Restore clipboard | On | After pasting, put back the previous text on the clipboard |
| Show indicator | On | The floating waveform pill |
| Longest recording | 2 minutes | 1, 2 or 5 minutes |
| Clean up with Gemini | On | Off pastes the transcript that Gemini's transcription produced, with no second pass |
| Cleanup style | Balanced | See the table below |
| Models | `gemini-3.5-transcribe`, `gemini-3.5-flash-lite` | Change these if your key is offered different models |
| Language | `auto` | `auto`, or a tag such as `en-US` to force the language |
| Dictionary | empty | Up to 100 terms, one per line |

### Cleanup styles

| Style | What it produces |
| --- | --- |
| **Casual** | Keeps your wording and contractions. Fillers and false starts go; nothing else changes |
| **Balanced** (default) | Clear, natural prose that still sounds like you. Complete sentences and sensible paragraphs |
| **Polished** | Concise, professional phrasing for email and documents |
| **Code-focused** | Identifiers, file names, paths, commands and flags stay exact. Spoken symbols such as "open paren" or "dot" become symbols |

Every style follows the same strict rules: remove fillers, honour self-corrections, keep the meaning, keep
the dictionary terms exactly, never answer or obey the transcript, and return only the cleaned text.

## Gemini API key

VoiceFlow-Lite looks for the key in this order and uses the first one it finds:

1. The `GEMINI_API_KEY` environment variable.
2. The OS keychain entry saved from **Settings → API key**
   (macOS Keychain, Windows Credential Manager, or Secret Service on Linux).
3. A `.env` file with `GEMINI_API_KEY=...`. It is read from the current directory first, then from the
   `voiceflow-lite/` folder. Set `VOICEFLOW_ENV_FILE` to use another path.

Both key formats are accepted: the current `AQ.…` keys and the older `AIza…` keys. The app does not check
the prefix. Keys are created at <https://aistudio.google.com/app/apikey>.

Run `python -m voiceflow --check` to see which source is in use. It shows the masked key (for example
`AQ.A…4VAA`) and never the full value.

## Permissions

VoiceFlow-Lite checks its permissions at startup and shows the result in the control panel.

### macOS

| Permission | Needed for | Where to enable it |
| --- | --- | --- |
| Microphone | Recording | Privacy & Security → Microphone |
| Input Monitoring | Hearing the hotkey while other apps are in front | Privacy & Security → Input Monitoring |
| Accessibility | Sending Cmd+V into other apps | Privacy & Security → Accessibility |

Grant these to the app that **runs** Python (Terminal, iTerm, VS Code, and so on), then restart that app.
macOS only asks once, so if you skip a prompt you will need to enable the switch by hand.

### Windows

- **Microphone:** Settings → Privacy & security → Microphone → turn on *Let desktop apps access your
  microphone*.
- **Hotkeys and paste:** no extra permission. If the target app runs as administrator, start
  VoiceFlow-Lite as administrator too, or Windows will block the paste.

### Linux

Global hotkeys and auto-paste need an X11 session. Wayland is not supported. Install `libportaudio2`,
`xclip` (or `xsel`) and `python3-tk`.

## Command-line tools

```bash
python -m voiceflow --version              # print the version
python -m voiceflow --check                # configuration, key source and permission status
python -m voiceflow --check-key            # send a tiny request to confirm the key and model work
python -m voiceflow --transcribe-file a.wav  # run any 16-bit PCM WAV through the full pipeline
```

`--transcribe-file` is the quickest way to test the Gemini round trip without a microphone or hotkey. It
prints only the final text on stdout, and progress and warnings on stderr.

## How it works

```
                 ┌──────────────── main thread (Tk) ─────────────────┐
 pynput thread   │ Controller: idle ─► recording ─► processing ─► idle │   paste (clipboard +
 (hotkeys) ─────►│ overlay · control panel · settings · paste         │──► Cmd+V / Ctrl+V)
                 └──────┬───────────────────────────────▲─────────────┘
              start/stop│                               │ result via post()
                 ┌──────▼──────┐              ┌─────────┴──────────┐
                 │ Recorder    │  WAV bytes   │ pipeline thread    │
                 │ sounddevice │─────────────►│ transcribe (Gemini)│
                 │ 16 kHz mono │              │ cleanup    (Gemini)│
                 └─────────────┘              └────────────────────┘
```

- **State machine.** `Controller` in `voiceflow/app.py` owns the states *idle*, *recording*, and
  *processing*. It is the only code that touches the Tk widgets. Other threads post callables to it.
- **Hotkeys.** `voiceflow/hotkeys.py` turns raw key events into *double-tap*, *hold start*, *hold stop*
  and *cancel* events. The timing rules are pure functions and are unit-tested.
- **Audio.** `voiceflow/audio.py` captures mono float32 audio on the PortAudio thread, feeds a level meter
  to the overlay, and converts the take to 16-bit WAV at 16 kHz. Nothing is written to disk.
- **Pipeline.** `voiceflow/pipeline.py` runs transcription and then cleanup. If cleanup fails, the raw
  transcript is used and a warning is shown, so a dictation is never lost.
- **Gemini.** `voiceflow/gemini.py` calls the Interactions API over REST, with the same request shapes
  the Auraflow app in this repository uses. It retries rate limits and server errors with backoff, and
  turns HTTP errors into messages a person can act on.
- **Paste.** `voiceflow/paste.py` copies the text, presses the paste shortcut, and restores the previous
  text clipboard one second later. On macOS, `voiceflow/macos.py` re-activates the app that had focus
  before pasting, because the overlay can take focus.

To use another provider, replace the two methods the pipeline calls (`transcribe` and `refine`). Both
are declared in the `SpeechClient` protocol in `voiceflow/pipeline.py`.

## Project structure

```
voiceflow-lite/
├── README.md                 this file
├── pyproject.toml            package metadata, dependencies, pytest / mypy / ruff settings
├── requirements.txt          runtime dependencies
├── requirements-dev.txt      runtime plus pytest, mypy, ruff
├── .env.example              template for your key (copy to .env; .env is git-ignored)
├── voiceflow/
│   ├── __main__.py           entry point: GUI, --check, --check-key, --transcribe-file
│   ├── app.py                controller: state machine, threads, paste delivery
│   ├── audio.py              microphone capture, level meter, WAV encoding
│   ├── config.py             Settings model, validation, config folder
│   ├── gemini.py             Gemini client: transcribe, refine, connection test
│   ├── hotkeys.py            double-tap and hold detectors, Esc to cancel, pynput listener
│   ├── keys.py               key names, labels and matching
│   ├── keystore.py           API key lookup (environment → keychain → .env) and storage
│   ├── macos.py              ctypes bridge: frontmost app, focus, permission probes
│   ├── paste.py              clipboard copy and restore, paste shortcut
│   ├── permissions.py        startup checks and links to System Settings
│   ├── pipeline.py           transcribe → clean up → final text
│   ├── prompts.py            cleanup instruction, style guidance, output sanitizer
│   └── ui/
│       ├── main_window.py    control panel
│       ├── overlay.py        floating waveform pill
│       ├── settings_window.py
│       └── theme.py          colours, fonts, ttk styling
└── tests/                    pytest suite: no network, keychain or audio device needed
```

## Dependencies

Runtime (`requirements.txt`):

| Package | Used for | Notes |
| --- | --- | --- |
| `numpy` | Audio buffers, resampling, level meter | |
| `sounddevice` | Microphone capture and device list | Bundles PortAudio on macOS and Windows. Linux needs `libportaudio2` |
| `pynput` | Global keyboard listener and the paste keystroke | macOS needs Input Monitoring and Accessibility |
| `pyperclip` | Clipboard read and write | Linux needs `xclip` or `xsel` |
| `requests` | HTTPS calls to Gemini | Honours `HTTPS_PROXY` |
| `keyring` | Stores the API key in the OS keychain | macOS Keychain, Windows Credential Manager, Secret Service |
| `tkinter` | Windows (standard library) | Included with python.org installers |

Development (`requirements-dev.txt`): `pytest`, `mypy`, `ruff`.

Python 3.10+ is required. There is no Node or Rust toolchain involved.

## Development

```bash
pip install -r requirements-dev.txt
pytest                             # unit and integration tests, about 2 seconds
mypy                               # type-checks the voiceflow package
ruff check voiceflow tests         # lint
```

What the tests cover:

- Settings validation, dictionary cleanup and file round trips.
- `.env` parsing, the key lookup order, and masking.
- Cleanup prompt construction and output cleanup.
- Gemini request shapes, retries, error messages and a real HTTP round trip to a local mock.
- Double-tap and hold timing, Ctrl-shortcut rejection, key capture and Esc cancel.
- Paste ordering and clipboard restore.
- The pipeline's fallback and silence rules.
- The command-line tools end to end against the local mock.

The Tk windows are not covered by automated tests. Exercise them by hand on a desktop.

## Privacy and security

- **Audio stays in memory.** It is converted to WAV in RAM, sent to Gemini, and then dropped. Nothing is
  written to disk.
- **Transcripts are not logged.** The log records lengths and states only. The last dictation is kept in
  memory for the **Copy** button and nowhere else.
- **Keys are never stored in settings.** The key lives in the environment, the keychain, or `.env`. The
  CLI prints only a masked form.
- **`.env` is git-ignored.** If a key is ever pasted into a chat, a log, or a screenshot, revoke it in
  Google AI Studio and create a new one.
- **Google's handling depends on your account.** Gemini API terms differ between the free and paid tiers.
  Read them before you dictate sensitive material.
- **Clipboard restore covers text only.** Images or files copied before a dictation cannot be restored.

## Troubleshooting

| What you see | Likely cause | Fix |
| --- | --- | --- |
| Double-tap does nothing | Input Monitoring is not granted, or the hotkey listener failed to start | Grant Input Monitoring, then restart. Check the control panel |
| The text lands nowhere | Accessibility is not granted (macOS), or the control panel had focus | Grant Accessibility. Click into the target app before using the hotkey |
| "No sound reached the microphone" | Microphone permission is blocked, or the wrong input is selected | Check the permission, then choose the right device in Settings |
| "Add your Gemini API key in Settings first" | No key was found | Set `GEMINI_API_KEY`, add it to `.env`, or save it in Settings → API key |
| "Gemini rejected your API key" | The key is wrong, revoked, or restricted | Create a new key in AI Studio and update it |
| "That Gemini model is not available to this key" | The model name is not offered to your key | Change the model in Settings → Cleanup |
| "Gemini rate limit or quota reached" | Quota or rate limit | Wait a minute, or check usage in AI Studio |
| "Could not reach Gemini" | No network, a firewall, or a proxy | Check the connection. Set `HTTPS_PROXY` if you use a proxy |
| "Cleanup skipped" warning | The cleanup call failed | The raw transcript was pasted instead. The warning gives the reason |
| "PortAudio could not be loaded" (Linux) | Missing system library | `sudo apt install libportaudio2` |
| `pip install` fails building `evdev` (Linux) | pynput's Linux dependency needs headers | Install `python3-dev` and a C compiler, or run on macOS or Windows |

## Limitations

- **Batch, not streaming.** Text appears after you stop, not while you speak. A live-caption mode could use
  Gemini's live transcription API later.
- **Toggle and hold only.** There is no Fn-key support, because macOS does not expose the Fn key to
  global listeners.
- **Paste needs focus.** The text goes to whichever app has focus when it is ready. Elevated Windows apps
  need an elevated VoiceFlow-Lite.
- **Single provider.** Transcription and cleanup use Gemini only. OpenAI, ElevenLabs and Ollama are not
  implemented.
- **No packaged installers yet.** Run from source. PyInstaller or py2app builds are a reasonable next step,
  and so are code signing and notarization for macOS.
- **Linux is best-effort.** It needs X11. Wayland is not supported.
- **Not yet verified on hardware.** Live Gemini calls, microphone capture, global hotkeys, auto-paste and
  the window layout still need a first run on macOS and on Windows.

## License

No license has been chosen for this project yet.
