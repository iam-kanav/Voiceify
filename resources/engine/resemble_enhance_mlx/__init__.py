"""resemble-enhance-mlx: Apple MLX port of resemble-enhance (denoise + enhance).

Vendored from https://huggingface.co/multimodalart/resemble-enhance-mlx (revision
1edb76415d18554f6e35f13edf9c22e33c47ce7d, MIT), a port of
https://github.com/resemble-ai/resemble-enhance (MIT, © 2023 Resemble AI; see LICENSE).

Changes made for Voiceify:
  - alias_free.py: the anti-aliasing up/down-sampling filters run as shifted, weighted
    slices instead of grouped (transposed) convolutions. Same output (max diff < 1e-6),
    about half the peak memory: MLX's grouped conv path materialized huge intermediates.
  - infer.py: 10 s chunks by default (memory stays ~5 GB at any length instead of
    ~13 GB per 30 s chunk), progress / cancel callbacks, `denoise()`, `configure()`.
  - lcfm.py: evaluates each ODE step (bounded graph, real progress) and rejects "rk4",
    which the port did not implement (it ran midpoint math with rk4's step count).
  - serial.py: only reconstructs classes from this package.

    from resemble_enhance_mlx import load, enhance
    import soundfile as sf

    model = load("resemble-enhance-mlx.safetensors", lambd=0.5)
    wav, sr = sf.read("noisy.wav", dtype="float32")
    out, out_sr = enhance(model, wav, sr)
    sf.write("clean.wav", out, out_sr)
"""
from .infer import load, enhance, denoise, configure, Cancelled

__all__ = ["load", "enhance", "denoise", "configure", "Cancelled"]
