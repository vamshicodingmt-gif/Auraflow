"""Shared fixtures. Tests never touch the network, the real keychain or an audio device."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from voiceflow import keystore


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("VOICEFLOW_HOME", str(tmp_path / "config"))
    monkeypatch.setenv("VOICEFLOW_ENV_FILE", str(tmp_path / "missing.env"))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("VOICEFLOW_GEMINI_BASE_URL", raising=False)
    monkeypatch.setattr(keystore, "keychain_get", lambda: "")
    monkeypatch.chdir(tmp_path)
    return tmp_path


class _MockGemini(BaseHTTPRequestHandler):
    """Answers like the Interactions API: transcripts for audio, cleaned text for text input."""

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        self.server.seen.append(  # type: ignore[attr-defined]
            {"path": self.path, "key": self.headers.get("x-goog-api-key"), "body": body}
        )
        if "transcription_config" in body.get("generation_config", {}):
            text = "um so this is a test of the voice flow thing"
        else:
            text = "This is a test of the VoiceFlow pipeline."
        payload = json.dumps(
            {
                "id": "test",
                "status": "completed",
                "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}],
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: Any) -> None:
        return


@pytest.fixture
def mock_gemini(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[str, list[dict[str, Any]]]]:
    """Start a local stand-in for the Gemini API. Yields (base_url, recorded requests)."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _MockGemini)
    server.seen = []  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1beta", server.seen  # type: ignore[attr-defined]
    finally:
        server.shutdown()
        server.server_close()
