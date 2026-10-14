<img src="build/icon.png" width="96" height="96" alt="">

# Voiceify

A local, multi-model voice studio. Open-source voice models run on your own computer, with no cloud and no accounts; models, voices and audio never leave the machine. The first supported provider is **Qwen3-TTS** (plus Qwen3-ASR for transcription), and the catalog, engine and UI are built to add more.

**Platforms:** macOS on Apple Silicon today (models run on the GPU via **MLX**). The app shell, downloader, runtime installer and UI are platform-neutral, so a Windows/Linux port needs a non-MLX inference backend (see *Porting* below).

> The UI is a temporary ElevenLabs-inspired design for testing features. All styling lives in design tokens (`src/renderer/src/styles.css`), so a redesign won't touch feature code.

## Features

| | |
|---|---|
| **Text to Speech** (start screen) | Built-in model voices, 10 languages, streaming playback (~300 ms to first audio), natural-language style instructions, temperature / top-p / top-k / repetition penalty. No length limit: long text is split into segments automatically. |
| **Create Voice** | *Design*: describe a voice in words → several previews → save. *Clone*: drop any audio or video file, or record from the mic. It's auto-transcribed and cloned; with no transcript it falls back to timbre-only (x-vector) mode. |
| **Voices** | Built-in, cloned and designed voices, with previews |
| **History** | Every generation saved as WAV: replay, save a copy, reveal in Finder, reopen in Text to Speech |
| **Models** | Grouped by what they do (Built-in Voices, Voice Cloning, Voice Design, Transcription), each in Large/Small and Full precision / 8 / 6 / 5 / 4-bit, with plain-language explanations, recommendations based on your computer's memory, and speed measured on your own machine. Community fine-tunes and any Hugging Face repo can be added. |
| **Agents & MCP** | Built-in MCP server (Streamable HTTP and a stdio bridge) plus a REST API, with copy-paste configs for Claude Code, Codex, OpenCode, Cursor, Claude Desktop, VS Code, Zed and Gemini CLI |

## Run it

```bash
npm install
npm run dev          # launches the app; first run is a setup wizard (engine + models)
npm run dist:mac     # builds dist/Voiceify-<version>-arm64.dmg
npm run dist:dir     # builds dist/mac-arm64/Voiceify.app (faster, no DMG)
```

On first launch a setup wizard installs the app's own inference runtime into `~/Library/Application Support/Voiceify/engine` (uv → CPython 3.12 → `mlx-audio`, about 350 MB). Your system Python is never touched.

## Model guide

| In the app | Open-source model | What it's for |
|---|---|---|
| Built-in Voices · Large | Qwen3-TTS 1.7B CustomVoice | 9 built-in voices + style instructions (emotion, tone, pace) |
| Built-in Voices · Small | Qwen3-TTS 0.6B CustomVoice | Same voices, faster and lighter, no style instructions |
| Voice Design | Qwen3-TTS 1.7B VoiceDesign | Invent a voice from a written description |
| Voice Cloning · Large / Small | Qwen3-TTS 1.7B / 0.6B Base | Copy a voice from 3+ seconds of audio; also speaks saved designed voices |
| Transcription · Small / Large | Qwen3-ASR 0.6B / 1.7B | Fills in clone transcripts automatically |

Every model comes in **Full precision** and **8 / 6 / 5 / 4-bit** versions. Fewer bits mean a smaller download, less memory and faster speech, at some cost to expressiveness; 8-bit is near-indistinguishable from full precision. Recommendations adapt to the computer's memory (≤8 GB → Small 8-bit, ≤24 GB → Large 8-bit, more → Full precision), and the Models page shows the speed actually measured on your machine. For reference, the official Qwen3-TTS-12Hz-1.7B-Base model card reports 1.24 WER on Seed-TTS test-en.

## Connect an agent

With the app running, the MCP server listens on `http://127.0.0.1:47821/mcp`:

```bash
claude mcp add --transport http voiceify http://127.0.0.1:47821/mcp
```

Stdio-only clients use the bundled bridge, which also launches the app if it isn't running:

```json
{ "command": "/Applications/Voiceify.app/Contents/MacOS/Voiceify",
  "args": ["/Applications/Voiceify.app/Contents/Resources/mcp/stdio-bridge.mjs"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" } }
```

Tools: `text_to_speech`, `list_voices`, `design_voice`, `clone_voice`, `transcribe_audio`, `play_audio`, `list_history`, `list_models`, `install_model`, `get_status`. The **Agents & MCP** page shows the exact config for each client.

REST: `POST /api/tts` (`?format=wav` returns audio), `GET /api/voices|models|history|status`, `GET /api/audio/:id`. The server binds to 127.0.0.1 only and rejects cross-origin browser requests.

## Architecture

```
src/
  shared/            types, model catalog + recommendations, preset voices, IPC contract
  main/              Electron main process
    engine/          runtime installer (uv/venv) + JSON-over-stdio client for the Python sidecar
    models/          HF downloader (parallel ranged chunks, resumable), convert, registry
    library/         voices + history stores
    services/        studio.ts: the one API that IPC, REST and MCP all call
    api/             local HTTP server: /mcp (MCP SDK) + /api/*
  preload/           typed window.studio bridge
  renderer/          React 19 + Tailwind 4 + Motion
    app/registry.tsx feature registry: sidebar, routing, code-splitting
    features/*       one folder per page
resources/
  engine/server.py   MLX inference sidecar (single worker thread, LRU model cache, streaming)
  mcp/stdio-bridge.mjs
```

### Adding a model provider

1. Add a `Provider` and its variants to `src/shared/catalog.ts` (`provider`, `task`, `capabilities`, `source`).
2. Teach the engine to load and run it (`resources/engine/server.py`: `ModelCache.get` + a handler).
3. The Models page, onboarding, recommendations, TTS model picker and MCP `list_models` pick it up from the catalog.

### Adding a feature (e.g. Sound Effects)

1. **UI:** create `src/renderer/src/features/sound-effects/index.tsx` and point its entry in `app/registry.tsx` at it (`status: 'ready'`).
2. **Engine:** add a handler to `HANDLERS` in `resources/engine/server.py` (e.g. `"sfx.generate"`).
3. **Models:** add catalog entries in `src/shared/catalog.ts` with a new `task`.
4. **Service + agents:** add a function in `src/main/services/`, an IPC method in `src/shared/ipc.ts`, and optionally an MCP tool in `src/main/api/mcp.ts`.

### Porting to Windows / Linux

Already platform-aware: paths come from Electron's `userData`; the runtime installer downloads the right `uv` build per OS/CPU and uses `Scripts/python.exe` on Windows; the downloader, catalog, MCP/REST server and UI have no macOS dependencies. What's missing is an inference backend: `SystemInfo.backend` is `'mlx'` on Apple Silicon and `null` elsewhere. Add a backend (e.g. PyTorch + CUDA/DirectML, or ONNX), install it in `runtime.ts`, load it in `server.py`, and add matching catalog sources.

## Data

Everything lives in Electron's per-user data folder (`~/Library/Application Support/Voiceify/` on macOS): `engine/`, `models/`, `voices/`, `history/`, `data/*.json`. For testing, `VOICEIFY_USER_DATA=/some/dir` runs a throwaway profile.

## License

App code: Apache-2.0. Qwen3-TTS and Qwen3-ASR weights: Apache-2.0 (Alibaba Qwen team).
