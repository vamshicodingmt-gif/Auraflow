from __future__ import annotations

from pathlib import Path

import numpy as np

from voiceflow.__main__ import main
from voiceflow.audio import AudioClip


def write_tone_wav(path: Path) -> Path:
    rate = 16_000
    t = np.arange(rate) / rate
    clip = AudioClip(samples=(0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sample_rate=rate)
    path.write_bytes(clip.to_wav_bytes())
    return path


def test_transcribe_file_prints_only_the_cleaned_text(isolated_environment, mock_gemini, monkeypatch, capsys):
    base_url, seen = mock_gemini
    monkeypatch.setenv("VOICEFLOW_GEMINI_BASE_URL", base_url)
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.test-key-0123456789")
    wav = write_tone_wav(isolated_environment / "clip.wav")

    assert main(["--transcribe-file", str(wav)]) == 0

    captured = capsys.readouterr()
    assert captured.out == "This is a test of the VoiceFlow pipeline.\n"
    assert "AQ.test-key" not in captured.out + captured.err
    assert [item["path"] for item in seen] == ["/v1beta/interactions", "/v1beta/interactions"]
    assert seen[0]["key"] == "AQ.test-key-0123456789"
    assert seen[0]["body"]["generation_config"]["transcription_config"]["mode"] == {"type": "verbatim"}
    assert seen[1]["body"]["system_instruction"].startswith("You are the cleanup engine")


def test_check_reports_a_missing_key_without_crashing(capsys):
    assert main(["--check"]) == 1
    assert "missing" in capsys.readouterr().out


def test_check_key_without_a_key_fails_cleanly(capsys):
    assert main(["--check-key"]) == 1
    assert "No Gemini key" in capsys.readouterr().err


def test_transcribe_missing_file_fails_cleanly(isolated_environment, monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.test-key-0123456789")
    assert main(["--transcribe-file", str(isolated_environment / "nope.wav")]) == 1
    assert "Could not read" in capsys.readouterr().err


def test_version_flag(capsys):
    assert main(["--version"]) == 0
    assert "0.1.0" in capsys.readouterr().out
