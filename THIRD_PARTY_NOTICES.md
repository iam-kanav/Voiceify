# Third-party notices

Voiceify is licensed under the [Apache License 2.0](LICENSE). It builds on the open-source projects below, whose licenses are all permissive and compatible with Apache-2.0.

## AI models (downloaded at runtime, not distributed with Voiceify)

Models are fetched from Hugging Face on the user's request and stay under their own licenses.

| Model | Author | License |
|---|---|---|
| [Qwen3-TTS](https://huggingface.co/collections/Qwen/qwen3-tts) (CustomVoice, VoiceDesign, Base; 0.6B and 1.7B) | Alibaba Qwen team | Apache-2.0 |
| [Qwen3-ASR](https://huggingface.co/collections/Qwen/qwen3-asr) (0.6B and 1.7B) | Alibaba Qwen team | Apache-2.0 |
| [MLX conversions](https://huggingface.co/mlx-community) of the above | mlx-community | Apache-2.0 (inherited) |
| [qwen3-tts-emotion-tags](https://huggingface.co/SpragAI/qwen3-tts-emotion-tags) (optional community fine-tune) | SpragAI | Apache-2.0 |

## Inference runtime (installed on first launch)

| Component | License |
|---|---|
| [MLX](https://github.com/ml-explore/mlx) | MIT |
| [mlx-audio](https://github.com/Blaizzy/mlx-audio) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT OR Apache-2.0 |
| [CPython](https://www.python.org/) | PSF License |
| [NumPy](https://numpy.org/) | BSD-3-Clause |
| [soundfile](https://github.com/bastibe/python-soundfile) | BSD-3-Clause |

## Application

| Component | License |
|---|---|
| [Electron](https://www.electronjs.org/) (includes Chromium and Node.js; their notices ship inside the app bundle) | MIT |
| [React](https://react.dev/) | MIT |
| [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [Zod](https://zod.dev/) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Motion](https://motion.dev/) | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | MIT |
| [Lucide](https://lucide.dev/) icons | ISC |
| [Inter](https://rsms.me/inter/) typeface (via Fontsource) | SIL Open Font License 1.1 |

Build tooling ([Vite](https://vite.dev/), [electron-vite](https://electron-vite.org/), [electron-builder](https://www.electron.build/): MIT; [TypeScript](https://www.typescriptlang.org/): Apache-2.0) is used only at build time.
