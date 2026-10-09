from __future__ import annotations

import base64
import json

import pytest
import requests

from voiceflow.gemini import GeminiClient, GeminiError, extract_text, friendly_http_message


class FakeResponse:
    def __init__(self, status_code: int = 200, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text or (json.dumps(payload) if payload is not None else "")

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        if self._payload is None:
            raise ValueError("not JSON")
        return self._payload


class FakeSession:
    def __init__(self, *responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def post(self, url, *, headers, json, timeout):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        item = self._responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def interaction(text: str) -> dict:
    return {
        "id": "i1",
        "status": "completed",
        "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}],
    }


def test_extract_text_reads_model_output_only():
    payload = {
        "steps": [
            {"type": "thought", "content": [{"type": "text", "text": "private"}]},
            {"type": "model_output", "content": [{"type": "text", "text": " Hello "}, {"type": "text", "text": "world"}]},
        ]
    }
    assert extract_text(payload) == "Hello world"
    assert extract_text({"output_text": "direct"}) == "direct"
    assert extract_text({}) == ""


def test_transcribe_request_shape():
    session = FakeSession(FakeResponse(200, interaction(" hello there ")))
    client = GeminiClient(api_key="AQ.test-key-0123456789", session=session, sleep=lambda _s: None)
    wav = b"RIFF-fake-wav"
    vocabulary = ["VoiceFlow", "pytest"] + [f"term{i}" for i in range(150)]
    text = client.transcribe(
        wav,
        model="gemini-3.5-transcribe",
        verbatim=True,
        vocabulary=vocabulary,
        language="en-US",
    )
    assert text == "hello there"
    call = session.calls[0]
    assert call["url"].endswith("/interactions")
    assert call["headers"]["x-goog-api-key"] == "AQ.test-key-0123456789"
    body = call["json"]
    assert body["model"] == "gemini-3.5-transcribe"
    assert body["store"] is False
    audio = body["input"][0]
    assert audio["type"] == "audio"
    assert audio["mime_type"] == "audio/wav"
    assert base64.b64decode(audio["data"]) == wav
    config = body["generation_config"]["transcription_config"]
    assert config["mode"] == {"type": "verbatim"}
    assert config["language_codes"] == ["en-US"]
    assert len(config["custom_vocabulary"]) == 100


def test_smart_mode_and_auto_language_omit_optional_fields():
    session = FakeSession(FakeResponse(200, interaction("ok")))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    client.transcribe(b"x", model="model-one", verbatim=False)
    config = session.calls[0]["json"]["generation_config"]["transcription_config"]
    assert config["mode"] == "smart"
    assert "language_codes" not in config
    assert "custom_vocabulary" not in config


def test_refine_request_uses_system_instruction_and_minimal_thinking():
    session = FakeSession(FakeResponse(200, interaction("Cleaned.")))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    result = client.refine(
        model="gemini-3.5-flash-lite",
        system_instruction="SYSTEM",
        user_text="<transcript>x</transcript>",
    )
    assert result == "Cleaned."
    body = session.calls[0]["json"]
    assert body["system_instruction"] == "SYSTEM"
    assert body["input"] == [{"type": "text", "text": "<transcript>x</transcript>"}]
    assert body["generation_config"]["thinking_level"] == "minimal"


def test_rate_limit_is_retried_with_backoff():
    sleeps: list[float] = []
    session = FakeSession(
        FakeResponse(429, {"error": {"message": "quota"}}),
        FakeResponse(200, interaction("ok")),
    )
    client = GeminiClient("k" * 20, session=session, sleep=sleeps.append)
    assert client.refine(model="gemini-3.5-flash-lite", system_instruction="s", user_text="u") == "ok"
    assert len(session.calls) == 2
    assert sleeps == [0.8]


def test_bad_key_fails_once_with_a_clear_message():
    session = FakeSession(
        FakeResponse(403, {"error": {"message": "API key not valid", "status": "PERMISSION_DENIED"}})
    )
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    with pytest.raises(GeminiError) as info:
        client.refine(model="gemini-3.5-flash-lite", system_instruction="s", user_text="u")
    assert "API key" in str(info.value)
    assert info.value.retryable is False
    assert info.value.status == 403
    assert len(session.calls) == 1


def test_bad_request_includes_the_api_message():
    session = FakeSession(FakeResponse(400, {"error": {"message": "Unsupported audio"}}))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    with pytest.raises(GeminiError, match="Unsupported audio"):
        client.transcribe(b"x", model="model-one", verbatim=True)


def test_timeouts_and_network_errors_give_up_after_retries():
    session = FakeSession(requests.Timeout("slow"), requests.Timeout("slow"), requests.Timeout("slow"))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    with pytest.raises(GeminiError, match="too long"):
        client.refine(model="model-one", system_instruction="s", user_text="u")
    assert len(session.calls) == 3

    offline = FakeSession(
        requests.ConnectionError("down"),
        requests.ConnectionError("down"),
        requests.ConnectionError("down"),
    )
    client = GeminiClient("k" * 20, session=offline, sleep=lambda _s: None)
    with pytest.raises(GeminiError, match="Could not reach Gemini"):
        client.refine(model="model-one", system_instruction="s", user_text="u")


def test_failed_status_payload_is_an_error():
    session = FakeSession(FakeResponse(200, {"status": "failed", "error": {"message": "bad audio"}}))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    with pytest.raises(GeminiError, match="bad audio"):
        client.refine(model="model-one", system_instruction="s", user_text="u")


def test_connection_test_requires_text():
    session = FakeSession(FakeResponse(200, {"steps": []}))
    client = GeminiClient("k" * 20, session=session, sleep=lambda _s: None)
    with pytest.raises(GeminiError, match="without any text"):
        client.test_connection("gemini-3.5-flash-lite")


def test_friendly_messages():
    assert "API key" in friendly_http_message(401)
    assert "rate limit" in friendly_http_message(429).lower()
    assert "temporarily" in friendly_http_message(503)


def test_base_url_can_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("VOICEFLOW_GEMINI_BASE_URL", "http://localhost:9999/v1beta/")
    assert GeminiClient("k" * 20).base_url == "http://localhost:9999/v1beta/"


def test_client_repr_never_shows_the_key():
    assert "k" * 20 not in repr(GeminiClient("k" * 20))


def test_real_http_round_trip_against_local_server(mock_gemini):
    base_url, seen = mock_gemini
    client = GeminiClient("AQ.test-key-0123456789", base_url=base_url)
    reply = client.refine(model="gemini-3.5-flash-lite", system_instruction="s", user_text="u")
    assert reply == "This is a test of the VoiceFlow pipeline."
    assert seen[0]["path"] == "/v1beta/interactions"
    assert seen[0]["key"] == "AQ.test-key-0123456789"
