from __future__ import annotations

import numpy as np
import pytest

from voiceflow.audio import TARGET_RATE, AudioClip, level_from_rms, load_wav_clip


def tone(seconds: float = 1.0, rate: int = 16_000, amplitude: float = 0.2) -> AudioClip:
    t = np.arange(int(seconds * rate)) / rate
    samples = (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    return AudioClip(samples=samples, sample_rate=rate)


def test_duration_and_peak():
    clip = tone(seconds=0.5, amplitude=0.3)
    assert clip.duration == pytest.approx(0.5)
    assert clip.peak == pytest.approx(0.3, abs=1e-3)


def test_resampling_changes_length_not_duration():
    clip = tone(seconds=1.0, rate=48_000)
    assert len(clip.resampled(TARGET_RATE)) == TARGET_RATE


def test_wav_bytes_are_16khz_mono_and_round_trip(tmp_path):
    clip = tone(seconds=0.25, rate=44_100)
    path = tmp_path / "clip.wav"
    path.write_bytes(clip.to_wav_bytes())
    loaded = load_wav_clip(path)
    assert loaded.sample_rate == TARGET_RATE
    assert loaded.duration == pytest.approx(0.25, abs=0.001)
    assert loaded.peak == pytest.approx(0.2, abs=0.02)


def test_wav_header_is_correct():
    import io
    import wave

    data = tone(seconds=0.1).to_wav_bytes()
    with wave.open(io.BytesIO(data), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getframerate() == TARGET_RATE


def test_level_meter_mapping():
    assert level_from_rms(0.0) == 0.0
    assert level_from_rms(1.0) == 1.0
    assert 0.0 < level_from_rms(0.05) < 1.0
    assert level_from_rms(1e-7) == 0.0


def test_empty_clip_is_safe():
    empty = AudioClip(samples=np.zeros(0, dtype=np.float32), sample_rate=16_000)
    assert empty.duration == 0.0
    assert empty.peak == 0.0
    assert len(empty.resampled()) == 0
    assert empty.to_wav_bytes()[:4] == b"RIFF"
