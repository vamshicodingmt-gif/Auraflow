"""Microphone capture, live level metering and WAV encoding.

Audio stays in memory. It is converted to 16 kHz mono 16-bit WAV, the format the
transcription model expects, and is never written to disk.
"""

from __future__ import annotations

import io
import logging
import math
import threading
import time
import wave
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

TARGET_RATE = 16_000
BLOCK_MS = 30
LEVEL_HISTORY = 24


class AudioError(RuntimeError):
    """The microphone could not be opened or read."""


@dataclass(frozen=True)
class AudioClip:
    samples: np.ndarray  # float32, mono, nominally in [-1, 1]
    sample_rate: int

    @property
    def duration(self) -> float:
        return len(self.samples) / self.sample_rate if self.sample_rate else 0.0

    @property
    def peak(self) -> float:
        return float(np.max(np.abs(self.samples))) if len(self.samples) else 0.0

    def resampled(self, rate: int = TARGET_RATE) -> np.ndarray:
        if self.sample_rate == rate or len(self.samples) == 0:
            return self.samples.astype(np.float32, copy=False)
        new_length = max(1, round(len(self.samples) * rate / self.sample_rate))
        source_index = np.arange(len(self.samples))
        target_index = np.linspace(0, len(self.samples) - 1, new_length)
        return np.interp(target_index, source_index, self.samples).astype(np.float32)

    def to_wav_bytes(self, rate: int = TARGET_RATE) -> bytes:
        pcm = np.clip(self.resampled(rate), -1.0, 1.0)
        data = (pcm * 32767.0).astype("<i2").tobytes()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(data)
        return buffer.getvalue()


def level_from_rms(rms: float) -> float:
    """Map RMS amplitude to a 0..1 meter value on a decibel scale (-55 dB..-10 dB)."""
    if rms <= 1e-6:
        return 0.0
    decibels = 20.0 * math.log10(rms)
    return min(1.0, max(0.0, (decibels + 55.0) / 45.0))


def load_wav_clip(path: str | Path) -> AudioClip:
    """Read a PCM WAV file (8, 16 or 32-bit) as a mono float clip."""
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    if width == 1:
        data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        data = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise AudioError(f"Unsupported WAV sample width: {width} bytes")
    if channels > 1:
        usable = len(data) - len(data) % channels
        data = data[:usable].reshape(-1, channels).mean(axis=1)
    return AudioClip(samples=data.astype(np.float32), sample_rate=rate)


_API_RANK = (("wasapi", 0), ("coreaudio", 0), ("alsa", 0), ("directsound", 1), ("mme", 2))


def _api_rank(api_name: str) -> int:
    lowered = api_name.lower()
    for fragment, rank in _API_RANK:
        if fragment in lowered:
            return rank
    return 3


def _load_sounddevice() -> Any:
    """Import sounddevice lazily. It needs the PortAudio library, which the macOS and Windows wheels bundle."""
    try:
        import sounddevice
    except (OSError, ImportError) as exc:
        raise AudioError(f"Audio input is unavailable because PortAudio could not be loaded ({exc}).") from exc
    return sounddevice


def list_input_devices() -> list[str]:
    sd = _load_sounddevice()

    names: list[str] = []
    for device in sd.query_devices():
        if device["max_input_channels"] > 0:
            name = str(device["name"]).strip()
            if name and name not in names:
                names.append(name)
    return names


def _resolve_device(name: str) -> int | None:
    """Find an input device by name. Exact matches win, then the best host API. None means default."""
    wanted = name.strip().casefold()
    if not wanted:
        return None
    sd = _load_sounddevice()

    hostapis = sd.query_hostapis()
    best: tuple[tuple[int, int], int] | None = None
    for index, device in enumerate(sd.query_devices()):
        if device["max_input_channels"] <= 0:
            continue
        device_name = str(device["name"]).casefold()
        if device_name == wanted:
            match_rank = 0
        elif wanted in device_name:
            match_rank = 1
        else:
            continue
        api_name = str(hostapis[device["hostapi"]]["name"])
        key = (match_rank, _api_rank(api_name))
        if best is None or key < best[0]:
            best = (key, index)
    if best is None:
        log.warning("Input device %r was not found; using the system default.", name)
        return None
    return best[1]


def _quiet_stop(stream: Any) -> None:
    try:
        stream.stop()
        stream.close()
    except Exception:
        log.debug("Error while closing the input stream", exc_info=True)


def _quiet_close(stream: Any) -> None:
    try:
        stream.close()
    except Exception:
        log.debug("Error while closing a failed input stream", exc_info=True)


class Recorder:
    """Records from one input device until ``stop()`` or ``cancel()`` is called."""

    def __init__(self, device_name: str = "", max_seconds: float = 120.0) -> None:
        self._device_name = device_name
        self._max_seconds = max(1.0, float(max_seconds))
        self._lock = threading.Lock()
        self._blocks: list[np.ndarray] = []
        self._captured = 0
        self._max_samples = 0
        self._rate = TARGET_RATE
        self._stream: Any = None
        self._started_at = 0.0
        self._level = 0.0
        self.levels: deque[float] = deque([0.0] * LEVEL_HISTORY, maxlen=LEVEL_HISTORY)
        self.limit_reached = threading.Event()

    @property
    def running(self) -> bool:
        return self._stream is not None

    def start(self) -> None:
        if self.running:
            return
        sd = _load_sounddevice()

        device = _resolve_device(self._device_name)
        rates = [TARGET_RATE]
        try:
            native = round(float(sd.query_devices(device, "input")["default_samplerate"]))
        except Exception:  # some drivers do not report a default rate
            native = 0
        if native and native != TARGET_RATE:
            rates.append(native)

        stream: Any = None
        last_error: Exception | None = None
        for rate in rates:
            self._reset(rate)
            candidate: Any = None
            try:
                candidate = sd.InputStream(
                    device=device,
                    channels=1,
                    samplerate=rate,
                    dtype="float32",
                    blocksize=max(64, rate * BLOCK_MS // 1000),
                    callback=self._on_audio,
                )
                candidate.start()
            except Exception as exc:  # PortAudioError, or a sample rate the device refuses
                last_error = exc
                if candidate is not None:
                    _quiet_close(candidate)
                continue
            stream = candidate
            break

        if stream is None:
            raise AudioError(
                f"Could not open the microphone ({last_error}). "
                "Choose another input device in Settings and check microphone permission."
            )
        self._stream = stream
        self._started_at = time.monotonic()

    def _reset(self, rate: int) -> None:
        with self._lock:
            self._blocks = []
            self._captured = 0
            self._rate = rate
            self._max_samples = int(self._max_seconds * rate)
        self._level = 0.0
        self.limit_reached.clear()

    def _on_audio(self, indata: Any, frames: int, time_info: Any, status: Any) -> None:
        """Runs on the PortAudio thread. Keep it short: copy, meter, store."""
        mono = np.array(indata[:, 0], dtype=np.float32, copy=True)
        rms = float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0
        self._level = max(level_from_rms(rms), self._level * 0.75)
        self.levels.append(self._level)
        with self._lock:
            room = self._max_samples - self._captured
            if room <= 0:
                return
            take = mono[:room]
            self._blocks.append(take)
            self._captured += take.size
            if self._captured >= self._max_samples:
                self.limit_reached.set()

    def stop(self) -> AudioClip:
        stream, self._stream = self._stream, None
        if stream is None:
            raise AudioError("Recording was not running.")
        _quiet_stop(stream)
        with self._lock:
            blocks, self._blocks = self._blocks, []
            rate = self._rate
        samples = np.concatenate(blocks) if blocks else np.zeros(0, dtype=np.float32)
        return AudioClip(samples=samples, sample_rate=rate)

    def cancel(self) -> None:
        if self.running:
            self.stop()  # the captured audio is discarded by the caller
