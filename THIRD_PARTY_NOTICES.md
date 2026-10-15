# Third-party notices

Voiceify is licensed under the [Apache License 2.0](LICENSE). It builds on the open-source projects below, whose licenses are all permissive and compatible with Apache-2.0 (Pocket TTS weights are CC-BY-4.0, which requires the attribution given here).

## AI models (downloaded at runtime, not distributed with Voiceify)

Models are fetched from Hugging Face on the user's request and stay under their own licenses.

| Model | Author | License |
|---|---|---|
| [Qwen3-TTS](https://huggingface.co/collections/Qwen/qwen3-tts) (CustomVoice, VoiceDesign, Base; 0.6B and 1.7B) | Alibaba Qwen team | Apache-2.0 |
| [Qwen3-ASR](https://huggingface.co/collections/Qwen/qwen3-asr) (0.6B and 1.7B) | Alibaba Qwen team | Apache-2.0 |
| [MLX conversions](https://huggingface.co/mlx-community) of the above | mlx-community | Apache-2.0 (inherited) |
| [qwen3-tts-emotion-tags](https://huggingface.co/SpragAI/qwen3-tts-emotion-tags) (optional community fine-tune) | SpragAI | Apache-2.0 |
| [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (2B), via [mlx-community conversions](https://huggingface.co/mlx-community/VoxCPM2-8bit) (optional) | OpenBMB | Apache-2.0 |
| [Pocket TTS](https://huggingface.co/kyutai/pocket-tts) (100M), via [mlx-community conversions](https://huggingface.co/mlx-community/pocket-tts) | Kyutai | CC-BY-4.0 |
| [Whisper Large v3](https://huggingface.co/openai/whisper-large-v3) and [Large v3 Turbo](https://huggingface.co/openai/whisper-large-v3-turbo), via [mlx-community conversions](https://huggingface.co/mlx-community/whisper-large-v3-turbo-8bit); tokenizer files from the OpenAI repositories (optional) | OpenAI | MIT |
| Pocket TTS tokenizer and built-in voice embeddings ([kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), [voice sources](https://huggingface.co/kyutai/tts-voices)) | Kyutai | CC-BY-4.0 (see voice repository for per-voice licenses) |

| [Stable Audio 3 Small SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx), official MLX weights from [stabilityai/stable-audio-3-optimized](https://huggingface.co/stabilityai/stable-audio-3-optimized) (optional) | Stability AI | [Stability AI Community License](https://stability.ai/community-license-agreement); bundled T5Gemma text encoder under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms) |

| [Resemble Enhance](https://huggingface.co/ResembleAI/resemble-enhance), via the [MLX port](https://huggingface.co/multimodalart/resemble-enhance-mlx) of its weights (optional) | Resemble AI (port: multimodalart) | MIT |

**Powered by Stability AI.** This Stability AI Model is licensed under the Stability AI Community License, Copyright © Stability AI Ltd. All Rights Reserved. The license text, the Gemma Terms of Use and Stability AI's NOTICE are downloaded with the model into its folder. Use is free for research, non-commercial use, and commercial use by individuals and organizations with under US $1,000,000 in annual revenue; commercial users must register at https://stability.ai/community-license, and larger organizations need an enterprise license from Stability AI. Use must follow Stability AI's [Acceptable Use Policy](https://stability.ai/use-policy).

Kyutai asks that Pocket TTS not be used for voice impersonation or cloning without explicit and lawful consent, misinformation, or fraud. Voiceify users are responsible for complying with these terms.

## Inference runtime (installed on first launch)

| Component | License |
|---|---|
| [MLX](https://github.com/ml-explore/mlx) | MIT |
| [mlx-audio](https://github.com/Blaizzy/mlx-audio) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT OR Apache-2.0 |
| [CPython](https://www.python.org/) | PSF License |
| [NumPy](https://numpy.org/) | BSD-3-Clause |
| [soundfile](https://github.com/bastibe/python-soundfile) | BSD-3-Clause |
| [SentencePiece](https://github.com/google/sentencepiece) | Apache-2.0 |
| [Requests](https://github.com/psf/requests) | Apache-2.0 |
| [Hugging Face Transformers](https://github.com/huggingface/transformers) (tokenizers for Whisper; installed with mlx-audio) | Apache-2.0 |
| [resemble-enhance-mlx](https://huggingface.co/multimodalart/resemble-enhance-mlx) inference code, port of [resemble-enhance](https://github.com/resemble-ai/resemble-enhance) (vendored in `resources/engine/resemble_enhance_mlx/` with the memory and safety changes listed in its `__init__.py`; license included) | MIT, © 2023 Resemble AI |
| [Stable Audio 3 MLX inference code](https://github.com/Stability-AI/stable-audio-3/tree/main/optimized/mlx) (vendored unmodified in `resources/engine/sa3/`, license included) | MIT, © 2026 Stability AI |

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
