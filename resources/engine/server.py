"""
Voiceify inference engine.

A long-lived sidecar process owned by the Electron main process. It speaks newline-delimited
JSON over stdio:

  request   {"id": "1", "method": "tts.generate", "params": {...}}
  response  {"id": "1", "result": {...}}  |  {"id": "1", "error": {"message": "..."}}
  event     {"id": "1", "event": "chunk", "data": {...}}       (streamed while a job runs)
  log       {"event": "log", "data": "..."}                    (unsolicited)

All MLX work happens on a single worker thread (MLX/Metal is not thread-safe); the stdin thread
only enqueues jobs and handles control messages (cancel, ping) immediately.

Adding a new capability (sound effects, voice changer, …) = add a handler to HANDLERS.
"""

from __future__ import annotations

import base64
import gc
import json
import os
import queue
import re
import sys
import threading
import time
import traceback
from collections import OrderedDict
from typing import Any, Callable, Dict

# Reserve the real stdout for the protocol; anything libraries print goes to stderr.
_PROTO = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

ENGINE_VERSION = "0.1.0"
_write_lock = threading.Lock()


def send(msg: Dict[str, Any]) -> None:
    line = json.dumps(msg, separators=(",", ":"), ensure_ascii=False)
    with _write_lock:
        _PROTO.write(line + "\n")
        _PROTO.flush()


def log(text: str) -> None:
    send({"event": "log", "data": text})


# --------------------------------------------------------------------------------------------
# Lazy heavy imports so `ping` answers instantly while MLX initialises in the background.
# --------------------------------------------------------------------------------------------

_mx = None
_np = None


def mx():
    global _mx
    if _mx is None:
        import mlx.core as m

        _mx = m
    return _mx


def np():
    global _np
    if _np is None:
        import numpy as n

        _np = n
    return _np


# --------------------------------------------------------------------------------------------
# Model cache (LRU). On a 16 GB Mac we keep one model resident by default.
# --------------------------------------------------------------------------------------------


class ModelCache:
    def __init__(self) -> None:
        self.models: "OrderedDict[str, Any]" = OrderedDict()
        self.max_loaded = 1

    def get(self, path: str, kind: str):
        key = f"{kind}:{path}"
        if key in self.models:
            self.models.move_to_end(key)
            return self.models[key]
        while len(self.models) >= max(1, self.max_loaded):
            old_key, _ = self.models.popitem(last=False)
            log(f"Unloading {old_key}")
            self._free()
        log(f"Loading {kind} model from {path}")
        t0 = time.time()
        if kind == "asr":
            from mlx_audio.stt.utils import load_model as load_stt

            model = load_stt(path)
        else:
            from mlx_audio.tts.utils import load_model as load_tts

            if model_type(path) == "pocket_tts":
                use_local_pocket_files(path)
            model = load_tts(path)
        log(f"Loaded in {time.time() - t0:.1f}s")
        self.models[key] = model
        return model

    def unload(self, path: str | None = None) -> None:
        if path is None:
            self.models.clear()
        else:
            for key in [k for k in self.models if k.endswith(f":{path}")]:
                del self.models[key]
        self._free()

    def loaded(self):
        return [k.split(":", 1)[1] for k in self.models]

    @staticmethod
    def _free() -> None:
        gc.collect()
        try:
            mx().clear_cache()
        except Exception:
            pass


CACHE = ModelCache()


def model_type(path: str) -> str:
    try:
        with open(os.path.join(path, "config.json"), encoding="utf-8") as f:
            return str(json.load(f).get("model_type", ""))
    except Exception:
        return ""


_pocket_dir: list = [None]
_pocket_hooked = [False]


def use_local_pocket_files(path: str) -> None:
    """Pocket TTS fetches its tokenizer and voice embeddings from Hugging Face on demand.
    Voiceify downloads them next to the model, so resolve those hf:// paths to local files and
    keep everything offline."""
    from pathlib import Path

    _pocket_dir[0] = Path(path)
    if _pocket_hooked[0]:
        return
    import mlx_audio.tts.models.pocket_tts.conditioners as conditioners
    import mlx_audio.tts.models.pocket_tts.pocket_tts as pocket
    import mlx_audio.tts.models.pocket_tts.utils as utils

    original = utils.download_if_necessary

    def resolve(remote):
        base = _pocket_dir[0]
        if base is not None and isinstance(remote, str) and remote.startswith("hf://"):
            name = remote.split("@", 1)[0].rsplit("/", 1)[-1]
            for candidate in (base / name, base / "embeddings" / name):
                if candidate.exists():
                    return candidate
        return original(remote)

    utils.download_if_necessary = conditioners.download_if_necessary = pocket.download_if_necessary = resolve
    _pocket_hooked[0] = True


# --------------------------------------------------------------------------------------------
# Jobs
# --------------------------------------------------------------------------------------------


class Job:
    def __init__(self, id: str, method: str, params: Dict[str, Any]):
        self.id = id
        self.method = method
        self.params = params
        self.cancelled = False

    def emit(self, event: str, data: Any) -> None:
        send({"id": self.id, "event": event, "data": data})


JOBS: Dict[str, Job] = {}
WORK: "queue.Queue[Job]" = queue.Queue()


def to_pcm16(audio) -> bytes:
    n = np()
    a = n.asarray(audio, dtype=n.float32).reshape(-1)
    a = n.clip(a, -1.0, 1.0)
    return (a * 32767.0).astype(n.int16).tobytes()


_SENTENCE_END = re.compile(r"(?<=[.!?。！？…])\s+|(?<=[。！？])")


def segment_text(text: str, max_chars: int = 400) -> str:
    """Split arbitrarily long text into model-sized segments (one per line).

    Newlines are kept as hard breaks; long paragraphs are split at sentence boundaries so
    each segment stays well inside the model's token budget. There is no overall length limit.
    """
    out = []
    for para in text.split("\n"):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            out.append(para)
            continue
        chunk = ""
        for sentence in _SENTENCE_END.split(para):
            sentence = sentence.strip()
            if not sentence:
                continue
            while len(sentence) > max_chars:  # a single run-on "sentence"
                cut = sentence.rfind(" ", 0, max_chars)
                cut = cut if cut > max_chars // 2 else max_chars
                if chunk:
                    out.append(chunk)
                    chunk = ""
                out.append(sentence[:cut].strip())
                sentence = sentence[cut:].strip()
            if chunk and len(chunk) + 1 + len(sentence) > max_chars:
                out.append(chunk)
                chunk = sentence
            else:
                chunk = f"{chunk} {sentence}".strip()
        if chunk:
            out.append(chunk)
    return "\n".join(out)


def handle_tts_generate(job: Job) -> Dict[str, Any]:
    p = job.params
    n = np()
    model = CACHE.get(p["model_path"], "tts")
    sr = int(model.sample_rate)
    stream = bool(p.get("stream", True))

    # Everything except these is a model setting the main process mapped from the provider's
    # parameter list (temperature, top_p, lsd_decode_steps, …), so pass it straight through.
    reserved = {"model_path", "text", "out_path", "stream", "provider", "language", "voice", "instruct",
                "ref_audio", "ref_text", "streaming_interval"}
    settings = {k: v for k, v in p.items() if k not in reserved and v is not None}
    pocket = p.get("provider") == "pocket-tts" or model_type(p["model_path"]) == "pocket_tts"

    kwargs: Dict[str, Any] = dict(
        stream=True,
        streaming_interval=float(p.get("streaming_interval", 0.48)),
        **settings,
    )
    if pocket:
        # Pocket TTS handles long text itself and speaks one language.
        _pocket_dir[0] = __import__("pathlib").Path(p["model_path"])
        kwargs["text"] = " ".join(p["text"].split())
        if p.get("voice"):
            kwargs["voice"] = str(p["voice"]).lower()
    else:
        kwargs.update(
            text=segment_text(p["text"]),
            lang_code=(p.get("language") or "auto").lower(),
            max_tokens=int(p.get("max_tokens", 4096)),
            split_pattern="\n",
        )
        if p.get("voice"):
            kwargs["voice"] = p["voice"]
        if p.get("instruct"):
            kwargs["instruct"] = p["instruct"]
    if p.get("ref_audio"):
        kwargs["ref_audio"] = p["ref_audio"]
        if p.get("ref_text") and not pocket:
            kwargs["ref_text"] = p["ref_text"]

    try:
        mx().reset_peak_memory()
    except Exception:
        pass

    t0 = time.time()
    first_chunk_at = None
    pieces = []
    tokens = 0
    gen = model.generate(**kwargs)
    try:
        for r in gen:
            if job.cancelled:
                break
            audio = n.asarray(r.audio, dtype=n.float32).reshape(-1)
            if audio.size == 0:
                continue
            tokens += int(getattr(r, "token_count", 0) or 0)
            pieces.append(audio)
            if first_chunk_at is None:
                first_chunk_at = time.time() - t0
            if stream:
                job.emit("chunk", {"pcm": base64.b64encode(to_pcm16(audio)).decode("ascii"), "sr": sr})
    finally:
        gen.close()

    if job.cancelled:
        return {"cancelled": True}
    if not pieces:
        raise RuntimeError("The model produced no audio. Try different text or settings.")

    audio = n.concatenate(pieces)
    elapsed = time.time() - t0
    out_path = p["out_path"]
    write_wav(out_path, audio, sr)
    if not stream:
        job.emit("chunk", {"pcm": base64.b64encode(to_pcm16(audio)).decode("ascii"), "sr": sr})

    duration = len(audio) / sr
    peak = 0.0
    try:
        peak = mx().get_peak_memory() / 1e9
    except Exception:
        pass
    return {
        "path": out_path,
        "duration": duration,
        "sample_rate": sr,
        "processing_time": elapsed,
        "first_chunk": first_chunk_at,
        "rtf": elapsed / duration if duration else 0,
        "tokens": tokens,
        "peak_memory_gb": peak,
    }


def write_wav(path: str, audio, sr: int) -> None:
    import soundfile as sf

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    sf.write(tmp, audio, sr, subtype="PCM_16", format="WAV")
    os.replace(tmp, path)


def handle_asr_transcribe(job: Job) -> Dict[str, Any]:
    """Speech → text. Returns the full text plus timestamped segments (for subtitles).

    `language` is what the model expects: a Whisper ISO code ("en") or a Qwen3-ASR language
    name ("English"); omitted = auto-detect. `task` = "translate" makes Whisper write English.
    """
    p = job.params
    model = CACHE.get(p["model_path"], "asr")
    language = p.get("language") or None
    if language == "auto":
        language = None
    t0 = time.time()

    from mlx_audio.stt.utils import load_audio

    audio = load_audio(p["audio_path"])
    duration = int(audio.shape[0]) / 16000

    if model_type(p["model_path"]) == "whisper":
        out = model.generate(
            audio,
            language=language,
            task=p.get("task") or "transcribe",
            verbose=None,
            # Stops Whisper from inventing text during long silences.
            hallucination_silence_threshold=2.0,
            word_timestamps=True,
        )
    else:
        out = model.generate(
            audio,
            language=language,
            # Passages of ~30 s (cut at quiet moments) give usable timestamps on long files.
            chunk_duration=30.0,
            max_tokens=int(8192 + duration * 20),
        )
    if isinstance(out, list):
        out = out[0] if out else None

    segments = []
    for seg in getattr(out, "segments", None) or []:
        text = str(seg.get("text", "")).strip()
        if text:
            segments.append({"start": float(seg.get("start", 0)), "end": float(seg.get("end", 0)), "text": text})
    text = (getattr(out, "text", "") or "").strip()
    if not text and segments:
        text = " ".join(s["text"] for s in segments)
    detected = getattr(out, "language", None)
    if isinstance(detected, list):
        detected = detected[0] if detected else None
    return {
        "text": text,
        "segments": segments,
        "language": detected,
        "duration": duration,
        "processing_time": time.time() - t0,
    }


def handle_convert(job: Job) -> Dict[str, Any]:
    """Convert a PyTorch Qwen3-TTS checkpoint (e.g. a community fine-tune) to MLX."""
    from mlx_audio.convert import convert

    p = job.params
    q_bits = p.get("q_bits")
    job.emit("progress", {"message": "Converting weights to MLX…"})
    convert(
        hf_path=p["src_path"],
        mlx_path=p["out_path"],
        quantize=bool(q_bits),
        q_bits=int(q_bits) if q_bits else None,
        model_domain="tts",
    )
    return {"path": p["out_path"]}


def handle_load(job: Job) -> Dict[str, Any]:
    CACHE.get(job.params["model_path"], job.params.get("kind", "tts"))
    return {"loaded": CACHE.loaded()}


def handle_unload(job: Job) -> Dict[str, Any]:
    CACHE.unload(job.params.get("model_path"))
    return {"loaded": CACHE.loaded()}


def handle_warmup(job: Job) -> Dict[str, Any]:
    import mlx.core  # noqa: F401
    import mlx_audio  # noqa: F401
    from importlib.metadata import version

    return {"mlx": version("mlx"), "mlx_audio": version("mlx-audio")}


HANDLERS: Dict[str, Callable[[Job], Dict[str, Any]]] = {
    "tts.generate": handle_tts_generate,
    "asr.transcribe": handle_asr_transcribe,
    "models.convert": handle_convert,
    "models.load": handle_load,
    "models.unload": handle_unload,
    "engine.warmup": handle_warmup,
}


def worker() -> None:
    while True:
        job = WORK.get()
        try:
            if job.cancelled:
                send({"id": job.id, "result": {"cancelled": True}})
                continue
            handler = HANDLERS.get(job.method)
            if handler is None:
                raise ValueError(f"Unknown method: {job.method}")
            result = handler(job)
            send({"id": job.id, "result": result})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            send({"id": job.id, "error": {"message": str(e) or e.__class__.__name__}})
        finally:
            JOBS.pop(job.id, None)


def main() -> None:
    threading.Thread(target=worker, daemon=True, name="mlx-worker").start()
    send({"event": "ready", "data": {"version": ENGINE_VERSION, "pid": os.getpid()}})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            log(f"Bad message: {raw[:200]}")
            continue
        mid = str(msg.get("id", ""))
        method = msg.get("method", "")
        params = msg.get("params") or {}
        if method == "ping":
            send({"id": mid, "result": {"version": ENGINE_VERSION, "loaded": CACHE.loaded()}})
        elif method == "cancel":
            target = JOBS.get(str(params.get("job_id")))
            if target:
                target.cancelled = True
            send({"id": mid, "result": {"ok": bool(target)}})
        elif method == "config":
            if "max_loaded" in params:
                CACHE.max_loaded = int(params["max_loaded"])
            send({"id": mid, "result": {"ok": True}})
        elif method == "shutdown":
            send({"id": mid, "result": {"ok": True}})
            break
        else:
            job = Job(mid, method, params)
            JOBS[mid] = job
            WORK.put(job)


if __name__ == "__main__":
    main()
