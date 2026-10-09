from __future__ import annotations

import numpy as np
import pytest

from voiceflow.audio import AudioClip
from voiceflow.config import Settings
from voiceflow.gemini import GeminiError
from voiceflow.pipeline import PipelineError, run_pipeline


class FakeClient:
    def __init__(
        self,
        transcript: str = "um so hello there",
        cleaned: str = "Hello there.",
        refine_error: Exception | None = None,
    ) -> None:
        self.transcript = transcript
        self.cleaned = cleaned
        self.refine_error = refine_error
        self.transcribe_calls: list[dict] = []
        self.refine_calls: list[dict] = []

    def transcribe(self, wav_bytes, *, model, verbatim, vocabulary=(), language="auto"):
        self.transcribe_calls.append(
            {
                "wav": wav_bytes,
                "model": model,
                "verbatim": verbatim,
                "vocabulary": list(vocabulary),
                "language": language,
            }
        )
        return self.transcript

    def refine(self, *, model, system_instruction, user_text, thinking_level=None):
        self.refine_calls.append({"model": model, "system": system_instruction, "user": user_text})
        if self.refine_error is not None:
            raise self.refine_error
        return self.cleaned


def speech(seconds: float = 1.0, amplitude: float = 0.1) -> AudioClip:
    return AudioClip(samples=np.full(int(16_000 * seconds), amplitude, dtype=np.float32), sample_rate=16_000)


def test_full_pipeline_transcribes_then_cleans():
    settings = Settings(cleanup_style="polished", dictionary=["VoiceFlow"], language="en-US")
    client = FakeClient()
    progress: list[str] = []
    result = run_pipeline(speech(), settings, client, progress.append)
    assert result.text == "Hello there."
    assert result.raw == "um so hello there"
    assert result.cleaned is True
    assert result.warning == ""
    assert progress == ["Transcribing…", "Cleaning up…"]

    transcription = client.transcribe_calls[0]
    assert transcription["verbatim"] is True
    assert transcription["vocabulary"] == ["VoiceFlow"]
    assert transcription["language"] == "en-US"
    assert transcription["wav"][:4] == b"RIFF"
    assert "Style: polished" in client.refine_calls[0]["system"]
    assert "<transcript>" in client.refine_calls[0]["user"]


def test_cleanup_disabled_uses_smart_transcription_and_skips_refine():
    client = FakeClient(transcript="Hello there.")
    result = run_pipeline(speech(), Settings(cleanup_enabled=False), client)
    assert result.text == "Hello there."
    assert result.cleaned is False
    assert client.transcribe_calls[0]["verbatim"] is False
    assert client.refine_calls == []


def test_cleanup_failure_falls_back_to_the_raw_transcript():
    client = FakeClient(refine_error=GeminiError("Gemini rate limit or quota reached."))
    result = run_pipeline(speech(), Settings(), client)
    assert result.text == "um so hello there"
    assert result.cleaned is False
    assert "rate limit" in result.warning


def test_empty_cleanup_output_falls_back_to_the_raw_transcript():
    result = run_pipeline(speech(), Settings(), FakeClient(cleaned="   "))
    assert result.text == "um so hello there"
    assert "raw transcript" in result.warning


def test_silence_and_short_clips_never_reach_the_api():
    client = FakeClient()
    with pytest.raises(PipelineError, match="No sound"):
        run_pipeline(speech(amplitude=0.0), Settings(), client)
    with pytest.raises(PipelineError, match="too short"):
        run_pipeline(speech(seconds=0.1), Settings(), client)
    assert client.transcribe_calls == []


def test_blank_transcript_is_reported():
    with pytest.raises(PipelineError, match="No speech"):
        run_pipeline(speech(), Settings(), FakeClient(transcript="  "))
