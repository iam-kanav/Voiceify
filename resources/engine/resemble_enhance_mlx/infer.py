"""Torch-free inference entry points: load the MLX package and enhance/denoise audio.

Mirrors resemble_enhance.inference: resample to 44.1 kHz, split into overlapping
chunks, run the model per chunk, and crossfade-merge. Resampling uses scipy
polyphase (kaiser) rather than torchaudio's sinc_interp_kaiser, so the resample
step is a close approximation, not bit-identical, for non-44.1k input.
"""
import math
import numpy as np
import mlx.core as mx
from scipy.signal import resample_poly
from . import serial

WAV_RATE = 44100


class Cancelled(Exception):
    pass


def load(path, lambd=0.5):
    """Load a resemble-enhance-mlx safetensors into a torch-free EnhancerM."""
    em = serial.load(path)
    em.lambd = lambd
    return em


def configure(em, nfe=32, solver="midpoint", lambd=0.5, tau=0.5):
    """Same knobs as resemble_enhance.enhancer.inference.enhance."""
    if not 0 < nfe <= 128:
        raise ValueError(f"nfe must be in (0, 128], got {nfe}")
    if solver not in ("midpoint", "euler"):
        raise ValueError(f"solver must be 'midpoint' or 'euler', got {solver!r}")
    em.lambd = float(min(max(lambd, 0.0), 1.0))
    em.lcfm.cfm.nfe = int(nfe)
    em.lcfm.cfm.method = solver
    em.lcfm.eval_tau = float(min(max(tau, 0.0), 1.0))
    return em


def _resample(x, sr):
    if sr == WAV_RATE:
        return x
    g = math.gcd(WAV_RATE, sr)
    return resample_poly(x, WAV_RATE // g, sr // g, window=("kaiser", 14.77)).astype(np.float32)


def _merge(chunks, chunk_len, hop_len, length):
    sig_len = (len(chunks) - 1) * hop_len + chunk_len
    overlap = chunk_len - hop_len
    out = np.zeros(sig_len, dtype=np.float32)
    fadein = np.concatenate([np.linspace(0, 1, overlap, dtype=np.float32), np.ones(hop_len, np.float32)])
    fadeout = np.concatenate([np.ones(hop_len, np.float32), np.linspace(1, 0, overlap, dtype=np.float32)])
    for i, c in enumerate(chunks):
        if len(c) < chunk_len:
            c = np.pad(c, (0, chunk_len - len(c)))
        if i == 0:
            c = c * fadeout
        elif i == len(chunks) - 1:
            c = c * fadein
        else:
            c = c * fadein * fadeout
        s = i * hop_len
        out[s:s + chunk_len] += c[: len(out[s:s + chunk_len])]
    return out[:length]


def _run(fn, dwav, sr, chunk_seconds, overlap_seconds, on_progress=None, cancelled=None):
    """Resample to 44.1 kHz, run `fn` on overlapping chunks, crossfade-merge (as upstream)."""
    dwav = _resample(np.asarray(dwav, np.float32), sr)
    chunk_len = int(WAV_RATE * chunk_seconds)
    hop_len = chunk_len - int(WAV_RATE * overlap_seconds)
    starts = list(range(0, max(1, len(dwav)), hop_len))
    n_chunks = next((i + 1 for i, s in enumerate(starts) if s + chunk_len >= len(dwav)), len(starts))
    outs = []
    for i, start in enumerate(starts[:n_chunks]):
        if cancelled is not None and cancelled():
            raise Cancelled()
        seg = dwav[start:start + chunk_len]
        length = len(seg)
        am = np.abs(seg).max()
        am = am if am > 1e-7 else 1e-7
        seg = np.pad(seg / am, (0, 441))
        o = np.array(fn(mx.array(seg), i, n_chunks))[0][:length] * am
        outs.append(o)
    hwav = _merge(outs, chunk_len, hop_len, length=len(dwav)) if len(outs) > 1 else outs[0][: len(dwav)]
    return hwav, WAV_RATE


def enhance(em, dwav, sr, chunk_seconds=10.0, overlap_seconds=1.0, on_progress=None, cancelled=None):
    """Denoise + enhance. dwav: 1D np.float32. Returns (wav_44100, 44100).

    on_progress(done, total) is called after every ODE step; cancelled() is polled
    between steps and chunks.
    """
    def fn(seg, i, n):
        def on_step(step, steps):
            if cancelled is not None and cancelled():
                raise Cancelled()
            if on_progress is not None:
                on_progress(i * steps + step, n * steps)
        em.lcfm.cfm.on_step = on_step
        try:
            return em(seg)
        finally:
            em.lcfm.cfm.on_step = None
    return _run(fn, dwav, sr, chunk_seconds, overlap_seconds, on_progress, cancelled)


def denoise(em, dwav, sr, chunk_seconds=10.0, overlap_seconds=1.0, on_progress=None, cancelled=None):
    """Denoiser only (fast): removes background noise without regenerating the voice."""
    def fn(seg, i, n):
        out = em.denoiser(seg[None])
        mx.eval(out)
        if on_progress is not None:
            on_progress(i + 1, n)
        return out
    return _run(fn, dwav, sr, chunk_seconds, overlap_seconds, on_progress, cancelled)
