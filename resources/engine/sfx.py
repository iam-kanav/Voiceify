"""Sound effects with Stable Audio 3 Small SFX (MLX).

Text → T5Gemma → DiT (8-step ping-pong flow sampler) → SAME-S decoder → 44.1 kHz stereo.
Mirrors Stability AI's reference script (stable-audio-3/optimized/mlx/scripts/sa3_mlx.py,
text-to-audio path), keeping all three models resident so repeat generations skip loading.

Model folder layout (written by the Voiceify model manager):
    MLX/t5gemma_f16.npz        text encoder + SentencePiece tokenizer
    MLX/dit_sm-sfx_f16.npz     diffusion transformer (+ conditioner under "cond.")
    MLX/same_s_decoder_f32.npz audio decoder
"""

from __future__ import annotations

import math
import os
from typing import Callable, Optional

import mlx.core as mx
import numpy as np

from sa3.dit_mlx import load_dit
from sa3.same_s_decoder import decode_chunked, load_model as load_decoder
from sa3.sa3_pipeline import (
    apply_prompt_padding,
    build_pingpong_schedule,
    load_conditioner_from_npz,
    patched_decode,
    sample_flow_pingpong,
)
from sa3.t5gemma_mlx import T5Gemma

SAMPLE_RATE = 44100
SAMPLES_PER_LATENT = 4096
MAX_SECONDS = 120.0  # Small SFX is trained for clips up to two minutes
DECODE_CHUNK = (8, 2)  # (chunk, overlap) for SAME-S, as in the reference script


class Cancelled(Exception):
    pass


class StableAudioSFX:
    sample_rate = SAMPLE_RATE

    def __init__(self, path: str):
        mlx_dir = os.path.join(path, "MLX")
        dit_path = os.path.join(mlx_dir, "dit_sm-sfx_f16.npz")
        self.dtype = mx.float16
        self.t5 = T5Gemma.from_npz(os.path.join(mlx_dir, "t5gemma_f16.npz"))
        # The DiT works at any latent length; T_lat only sizes an unused zero buffer.
        self.dit = load_dit(dit_path, T_lat=1, dtype=self.dtype, compile_=False)
        self.padding_emb, self.seconds_embedder = load_conditioner_from_npz(dit_path, prefix="cond.")
        self.decoder = load_decoder(weights_path=os.path.join(mlx_dir, "same_s_decoder_f32.npz"), dtype=mx.float32)

    def _encode(self, prompt: str) -> mx.array:
        embeds, mask = self.t5.encode([prompt], max_len=256)
        return apply_prompt_padding(embeds.astype(self.dtype), mask, self.padding_emb.astype(self.dtype))

    def _decode(self, latents: mx.array) -> np.ndarray:
        """(1, 256, T_lat) fp32 latents → (2, T_lat * 4096) waveform."""
        T = latents.shape[-1]
        chunk, overlap = DECODE_CHUNK
        if T > chunk + 2 * overlap:
            patches = decode_chunked(self.decoder, latents, chunk, overlap)
        elif T % 2 == 0:
            patches = self.decoder(latents)
        elif T > 6:
            patches = decode_chunked(self.decoder, latents, 2, 2)
        else:  # tiny odd length: pad one latent, decode, trim
            patches = self.decoder(mx.concatenate([latents, latents[..., -1:]], axis=-1))[..., : T * 16]
        audio = patched_decode(patches, patch_size=256, channels=2)
        mx.eval(audio)
        return np.array(audio.astype(mx.float32))[0]

    def generate(
        self,
        prompt: str,
        seconds: float,
        count: int = 1,
        steps: int = 8,
        seed: int = 0,
        cfg: float = 1.0,
        negative_prompt: Optional[str] = None,
        on_step: Optional[Callable[[int, int], None]] = None,
    ) -> list[np.ndarray]:
        """Returns `count` variations, each a (2, samples) float32 array in [-1, 1]."""
        seconds = float(min(max(seconds, 0.5), MAX_SECONDS))
        count = int(min(max(count, 1), 4))
        T_lat = max(1, math.ceil(seconds * SAMPLE_RATE / SAMPLES_PER_LATENT))

        cond = self._encode(prompt)
        seconds_embed = self.seconds_embedder(seconds).astype(self.dtype)  # (1, 1, 768)
        cross_attn = mx.concatenate([cond, seconds_embed], axis=1)  # (1, 257, 768)
        global_cond = seconds_embed[:, 0, :]  # (1, 768)
        null_cross = None
        if cfg != 1.0:
            if negative_prompt:
                null_cross = mx.concatenate([self._encode(negative_prompt), seconds_embed], axis=1)
            else:
                null_cross = mx.zeros_like(cross_attn)

        # One sampling pass for all variations: same conditioning, different starting noise.
        rep = lambda a: mx.repeat(a, count, axis=0)
        cross_b, global_b = rep(cross_attn), rep(global_cond)
        null_b = rep(null_cross) if null_cross is not None else None
        mx.eval(cross_b, global_b)

        def model_fn(x, t):
            if null_b is None:
                return self.dit(x, t, cross_b, global_b)
            v = self.dit(
                mx.concatenate([x, x], axis=0),
                mx.concatenate([t, t], axis=0),
                mx.concatenate([cross_b, null_b], axis=0),
                mx.concatenate([global_b, global_b], axis=0),
            )
            cond_v, uncond_v = mx.split(v, 2, axis=0)
            # Guidance in denoised space with adaptive projection (APG = 1), as upstream.
            sigma = t.reshape(-1, 1, 1).astype(mx.float32)
            xf = x.astype(mx.float32)
            cond_d = xf - cond_v.astype(mx.float32) * sigma
            diff = cond_d - (xf - uncond_v.astype(mx.float32) * sigma)
            norm = mx.sqrt((cond_d * cond_d).sum(axis=(-2, -1), keepdims=True))
            unit = cond_d / mx.maximum(norm, 1e-8)
            diff = diff - (diff * unit).sum(axis=(-2, -1), keepdims=True) * unit
            guided = cond_d + (cfg - 1.0) * diff
            return ((xf - guided) / sigma).astype(x.dtype)

        noise = mx.random.normal((count, 256, T_lat), dtype=self.dtype, key=mx.random.key(seed))
        sigmas = build_pingpong_schedule(steps, sigma_max=1.0, use_logsnr_shift=True)
        latents = sample_flow_pingpong(model_fn, noise, sigmas, seed=seed + 1, on_step=on_step)
        mx.eval(latents)

        n = int(round(seconds * SAMPLE_RATE))
        out = []
        for i in range(count):
            audio = self._decode(latents[i : i + 1].astype(mx.float32))[:, :n]
            if not np.isfinite(audio).all():
                raise RuntimeError("The model produced invalid audio. Try again with a different seed.")
            # Peak-normalize to -1 dBFS, as Stability's reference inference does; raw outputs
            # range from barely audible to clipping depending on the prompt.
            peak = float(np.abs(audio).max())
            if peak > 1e-4:
                audio = audio * (0.891 / peak)
            out.append(audio.astype(np.float32))
        return out
