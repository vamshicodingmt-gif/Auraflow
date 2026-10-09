"""Turns a recorded clip into the text that gets pasted.

Stage 1 transcribes the audio with Gemini's transcription model. Stage 2, when
cleanup is on, rewrites the transcript with a fast text model under a strict
system instruction. If cleanup fails, the raw transcript is used instead so the
dictation is never lost.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from .audio import AudioClip
from .config import Settings
from .gemini import GeminiError
from .prompts import build_cleanup_instruction, clean_model_output, wrap_transcript

log = logging.getLogger(__name__)

MIN_RECORDING_SECONDS = 0.4
SILENCE_PEAK = 0.004  # about -48 dBFS; quieter than this means the microphone is effectively silent


class PipelineError(Exception):
    """The recording produced nothing usable."""


class SpeechClient(Protocol):
    def transcribe(
        self,
        wav_bytes: bytes,
        *,
        model: str,
        verbatim: bool,
        vocabulary: Sequence[str] = (),
        language: str = "auto",
    ) -> str: ...

    def refine(
        self,
        *,
        model: str,
        system_instruction: str,
        user_text: str,
        thinking_level: str | None = None,
    ) -> str: ...


@dataclass(frozen=True)
class DictationResult:
    text: str  # what gets pasted
    raw: str  # the transcript before cleanup
    cleaned: bool  # True when the cleanup stage produced the text
    warning: str = ""


def run_pipeline(
    clip: AudioClip,
    settings: Settings,
    client: SpeechClient,
    progress: Callable[[str], None] | None = None,
) -> DictationResult:
    report = progress or (lambda _message: None)
    if clip.duration < MIN_RECORDING_SECONDS:
        raise PipelineError("That was too short to transcribe.")
    if clip.peak < SILENCE_PEAK:
        raise PipelineError("No sound reached the microphone. Check the input device and microphone permission.")

    report("Transcribing…")
    raw = client.transcribe(
        clip.to_wav_bytes(),
        model=settings.transcribe_model,
        verbatim=settings.cleanup_enabled,
        vocabulary=settings.dictionary,
        language=settings.language,
    ).strip()
    if not raw:
        raise PipelineError("No speech was detected.")
    log.info("Transcribed %.1f s of audio into %d characters", clip.duration, len(raw))

    if not settings.cleanup_enabled:
        return DictationResult(text=raw, raw=raw, cleaned=False)

    report("Cleaning up…")
    instruction = build_cleanup_instruction(settings.cleanup_style, settings.dictionary)
    try:
        polished = client.refine(
            model=settings.cleanup_model,
            system_instruction=instruction,
            user_text=wrap_transcript(raw),
        )
    except GeminiError as exc:
        log.warning("Cleanup skipped: %s", exc)
        return DictationResult(text=raw, raw=raw, cleaned=False, warning=f"Cleanup skipped: {exc}")

    text = clean_model_output(polished, raw)
    if not text:
        return DictationResult(
            text=raw,
            raw=raw,
            cleaned=False,
            warning="Cleanup returned nothing, so the raw transcript was used.",
        )
    return DictationResult(text=text, raw=raw, cleaned=True)
