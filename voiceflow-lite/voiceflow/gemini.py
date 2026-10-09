"""Client for the Gemini Interactions API, using plain REST calls.

Two requests are made per dictation:

* ``transcribe`` sends the recorded WAV to ``gemini-3.5-transcribe``.
* ``refine`` sends the raw transcript to a fast text model for cleanup.

The request shapes match the ones used elsewhere in this repository, so no SDK is
required. Set ``VOICEFLOW_GEMINI_BASE_URL`` to route requests through a proxy or a
local test server.
"""

from __future__ import annotations

import base64
import logging
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import requests

from . import __version__

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
BASE_URL_ENV_VAR = "VOICEFLOW_GEMINI_BASE_URL"
MAX_VOCABULARY_TERMS = 100
MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024
TRANSCRIBE_TIMEOUT_S = 150.0
TEXT_TIMEOUT_S = 60.0
TEST_TIMEOUT_S = 30.0
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
BACKOFF_SECONDS = (0.8, 2.0)
THINKING_LEVEL_BY_MODEL: dict[str, str] = {
    "gemini-3.5-flash-lite": "minimal",
    "gemini-3.5-flash": "minimal",
    "gemini-3.8-flash": "low",
}
USER_AGENT = f"VoiceFlow-Lite/{__version__}"


class GeminiError(Exception):
    """A failure that can be shown to the user as it is."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        reason: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason
        self.retryable = retryable


def friendly_http_message(status: int, api_message: str = "") -> str:
    detail = api_message.strip()
    if status == 400:
        return f"Gemini rejected the request: {detail}" if detail else "Gemini rejected the request."
    if status in (401, 403):
        return "Gemini rejected your API key. Check it in Settings or in your .env file."
    if status == 404:
        suffix = f" ({detail})" if detail else ""
        return f"That Gemini model is not available to this key{suffix}."
    if status == 429:
        return "Gemini rate limit or quota reached. Wait a moment and try again."
    if status >= 500:
        return "Gemini is temporarily unavailable. Try again in a moment."
    return detail or f"Gemini request failed (HTTP {status})."


def extract_text(payload: Mapping[str, Any]) -> str:
    """Pull the model's text out of an Interactions resource."""
    direct = payload.get("output_text")
    if isinstance(direct, str):
        return direct.strip()
    pieces: list[str] = []
    for step in payload.get("steps") or []:
        if not isinstance(step, Mapping) or step.get("type") != "model_output":
            continue
        for part in step.get("content") or []:
            if isinstance(part, Mapping) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    pieces.append(text)
    return "".join(pieces).strip()


def _raise_if_failed(payload: Mapping[str, Any]) -> None:
    if payload.get("status") != "failed":
        return
    error = payload.get("error")
    message = error.get("message") if isinstance(error, Mapping) else None
    suffix = f": {message}" if isinstance(message, str) and message else "."
    raise GeminiError(f"Gemini could not process the request{suffix}", reason="failed")


def _error_from_response(response: Any) -> GeminiError:
    api_message = ""
    reason: str | None = None
    try:
        data: Any = response.json()
    except ValueError:
        data = None
        api_message = str(response.text or "")[:200]
    if isinstance(data, Mapping):
        error = data.get("error")
        if isinstance(error, Mapping):
            api_message = str(error.get("message") or "")
            status_name = error.get("status")
            reason = str(status_name) if status_name else None
    status = int(response.status_code)
    return GeminiError(
        friendly_http_message(status, api_message),
        status=status,
        reason=reason,
        retryable=status in RETRY_STATUSES,
    )


@dataclass
class GeminiClient:
    api_key: str = field(repr=False)
    base_url: str = field(
        default_factory=lambda: os.environ.get(BASE_URL_ENV_VAR, "").strip() or DEFAULT_BASE_URL
    )
    max_retries: int = 2
    session: Any = None
    sleep: Callable[[float], None] = time.sleep

    def transcribe(
        self,
        wav_bytes: bytes,
        *,
        model: str,
        verbatim: bool,
        vocabulary: Sequence[str] = (),
        language: str = "auto",
    ) -> str:
        """Transcribe a 16 kHz mono WAV. ``verbatim`` keeps fillers so the cleanup stage can remove them."""
        if len(wav_bytes) > MAX_INLINE_AUDIO_BYTES:
            raise GeminiError("That recording is too large to send in one request. Try a shorter dictation.")
        transcription: dict[str, Any] = {"mode": {"type": "verbatim"} if verbatim else "smart"}
        if language and language.lower() != "auto":
            transcription["language_codes"] = [language]
        terms = [term for term in vocabulary if term][:MAX_VOCABULARY_TERMS]
        if terms:
            transcription["custom_vocabulary"] = terms
        body = {
            "model": model,
            "input": [
                {
                    "type": "audio",
                    "data": base64.b64encode(wav_bytes).decode("ascii"),
                    "mime_type": "audio/wav",
                }
            ],
            "generation_config": {"transcription_config": transcription},
            "store": False,
        }
        return extract_text(self._post(body, timeout=TRANSCRIBE_TIMEOUT_S))

    def refine(
        self,
        *,
        model: str,
        system_instruction: str,
        user_text: str,
        thinking_level: str | None = None,
    ) -> str:
        body = {
            "model": model,
            "input": [{"type": "text", "text": user_text}],
            "system_instruction": system_instruction,
            "generation_config": {
                "thinking_level": thinking_level or THINKING_LEVEL_BY_MODEL.get(model, "minimal"),
            },
            "store": False,
        }
        return extract_text(self._post(body, timeout=TEXT_TIMEOUT_S))

    def test_connection(self, model: str) -> str:
        """Round-trip a tiny prompt. Returns the model's reply and the latency."""
        body = {
            "model": model,
            "input": [{"type": "text", "text": "Reply with the single word: OK"}],
            "generation_config": {"thinking_level": THINKING_LEVEL_BY_MODEL.get(model, "minimal")},
            "store": False,
        }
        started = time.monotonic()
        reply = extract_text(self._post(body, timeout=TEST_TIMEOUT_S))
        if not reply:
            raise GeminiError(
                "Gemini answered without any text. Try a different cleanup model.",
                reason="empty",
            )
        return f"{reply[:80]} ({time.monotonic() - started:.1f}s)"

    def _post(self, body: Mapping[str, Any], *, timeout: float) -> dict[str, Any]:
        if self.session is None:
            self.session = requests.Session()
        url = f"{self.base_url.rstrip('/')}/interactions"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-goog-api-key": self.api_key,
            "User-Agent": USER_AGENT,
        }
        attempt = 0
        while True:
            try:
                response = self.session.post(url, headers=headers, json=body, timeout=timeout)
            except requests.Timeout as exc:
                if attempt < self.max_retries:
                    self._backoff(attempt)
                    attempt += 1
                    continue
                raise GeminiError(
                    "Gemini took too long to respond. Try a shorter dictation.",
                    reason="timeout",
                    retryable=True,
                ) from exc
            except requests.RequestException as exc:
                if attempt < self.max_retries:
                    self._backoff(attempt)
                    attempt += 1
                    continue
                raise GeminiError(
                    "Could not reach Gemini. Check your internet connection.",
                    reason="network",
                    retryable=True,
                ) from exc

            if response.ok:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise GeminiError(
                        "Gemini returned a response that could not be read.", reason="decode"
                    ) from exc
                if not isinstance(payload, dict):
                    raise GeminiError("Gemini returned an unexpected response.", reason="decode")
                _raise_if_failed(payload)
                return payload

            error = _error_from_response(response)
            if error.retryable and attempt < self.max_retries:
                self._backoff(attempt)
                attempt += 1
                continue
            raise error

    def _backoff(self, attempt: int) -> None:
        delay = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
        log.info("Gemini is busy; retrying in %.1f s", delay)
        self.sleep(delay)
