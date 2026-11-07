#!/usr/bin/env python3
"""
Poppy's Kokoro voice (Kokoro-82M on the ONNX runtime).

Copied from Persephone's server/tts_engine.py and turned into a small sidecar
that Poppy's main process starts once and keeps running.

Usage:  python3 kokoro_tts.py <model-dir>

Protocol (one JSON object per line):
  stdout  {"event": "downloading"}                 model files are being fetched
          {"event": "ready"}                       loaded and warmed up
          {"event": "error", "error": "..."}       can't start; the process exits
          {"id": 1, "ok": true, "seconds": 1.8}    a request finished
          {"id": 1, "ok": false, "error": "..."}
  stdin   {"id": 1, "text": "...", "voice": "af_heart", "speed": 1.0, "out": "/tmp/x.wav"}

Output is 16-bit mono 24 kHz WAV, written to the "out" path.
Anything libraries print goes to stderr, so stdout stays clean JSON.
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path
from urllib.request import urlretrieve

_OUT = sys.stdout
sys.stdout = sys.stderr  # stray prints from libraries must not break the protocol

SAMPLE_RATE = 24_000
DEFAULT_VOICE = "af_heart"
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"
_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

# English voices from Persephone's catalog (af/am = American, bf/bm = British).
VALID_VOICES = {
    "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_aoede",
    "am_adam", "am_michael", "am_liam", "am_puck",
    "bf_emma", "bf_alice", "bf_isabella",
    "bm_george", "bm_daniel", "bm_fable",
}


def send(obj: dict) -> None:
    _OUT.write(json.dumps(obj) + "\n")
    _OUT.flush()


def lang_for_voice(voice_id: str) -> str:
    """Kokoro's `create()` takes an eSpeak lang code."""
    return "en-gb" if voice_id.startswith(("bf_", "bm_")) else "en-us"


def download_if_missing(model_dir: Path) -> None:
    for url, name in ((_MODEL_URL, MODEL_FILE), (_VOICES_URL, VOICES_FILE)):
        path = model_dir / name
        if path.exists() and path.stat().st_size > 1_000_000:
            continue
        send({"event": "downloading", "file": name})
        part = path.with_suffix(path.suffix + ".part")
        try:
            urlretrieve(url, part)
            part.replace(path)
        except Exception:
            part.unlink(missing_ok=True)
            raise


def write_wav(path: str, pcm, sr: int) -> None:
    import numpy as np

    pcm_i16 = (pcm * 32767.0).clip(-32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm_i16.tobytes())


def main() -> int:
    if len(sys.argv) < 2:
        send({"event": "error", "error": "usage: kokoro_tts.py <model-dir>"})
        return 2
    model_dir = Path(sys.argv[1]).expanduser()
    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        import numpy as np
        from kokoro_onnx import Kokoro
    except Exception as exc:
        send({"event": "error", "error": f"kokoro-onnx isn't installed for {sys.executable} ({exc})"})
        return 1

    try:
        download_if_missing(model_dir)
        kokoro = Kokoro(str(model_dir / MODEL_FILE), str(model_dir / VOICES_FILE))
        kokoro.create("Hi.", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")  # warm-up
    except Exception as exc:
        send({"event": "error", "error": f"Kokoro couldn't load: {exc}"})
        return 1
    send({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = str(req.get("text") or "").strip()
            if not text:
                raise ValueError("empty text")
            voice = req.get("voice") or DEFAULT_VOICE
            if voice not in VALID_VOICES:
                voice = DEFAULT_VOICE
            speed = min(2.0, max(0.5, float(req.get("speed") or 1.0)))
            pcm, sr = kokoro.create(text=text, voice=voice, speed=speed, lang=lang_for_voice(voice))
            if pcm.size == 0:
                raise RuntimeError("Kokoro returned no audio")
            pcm = pcm.astype(np.float32, copy=False)
            # Peak safety: a few voices come close to clipping on emphatic syllables.
            peak = float(np.abs(pcm).max())
            if peak > 0.98:
                pcm = pcm * (0.95 / peak)
            sr = sr or SAMPLE_RATE
            write_wav(str(req["out"]), pcm, sr)
            send({"id": req_id, "ok": True, "seconds": round(len(pcm) / sr, 2)})
        except Exception as exc:
            send({"id": req_id, "ok": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
