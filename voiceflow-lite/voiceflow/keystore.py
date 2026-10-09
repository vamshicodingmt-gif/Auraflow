"""Gemini API key discovery and secure storage.

Lookup order (the first non-empty value wins):

1. The ``GEMINI_API_KEY`` environment variable.
2. The operating-system keychain entry saved from the Settings window
   (macOS Keychain, Windows Credential Manager, or Secret Service on Linux).
3. A ``.env`` file with ``GEMINI_API_KEY=...``. It is read from ``$VOICEFLOW_ENV_FILE``
   when set, otherwise from the current directory and then the project root.
   The file is git-ignored.

The key is never logged or printed in full.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT

log = logging.getLogger(__name__)

KEY_ENV_VAR = "GEMINI_API_KEY"
ENV_FILE_VAR = "VOICEFLOW_ENV_FILE"
KEYCHAIN_SERVICE = "VoiceFlow-Lite"
KEYCHAIN_ACCOUNT = "gemini-api-key"
_SOURCE_TEXT = {
    "environment": "the GEMINI_API_KEY environment variable",
    "keychain": "the system keychain",
    "dotenv": "a .env file",
}


class KeystoreError(RuntimeError):
    """The system keychain is missing or refused the request."""


@dataclass(frozen=True)
class KeyInfo:
    key: str = field(default="", repr=False)
    source: str = ""

    @property
    def present(self) -> bool:
        return bool(self.key)

    def masked(self) -> str:
        if not self.key:
            return ""
        if len(self.key) <= 10:
            return "*" * len(self.key)
        return f"{self.key[:4]}…{self.key[-4:]}"

    def describe(self) -> str:
        return _SOURCE_TEXT.get(self.source, "nowhere yet")


def is_plausible_key(key: str) -> bool:
    """Shape check only. Gemini keys start with AQ. (current) or AIza (legacy); both are accepted."""
    candidate = key.strip()
    return 16 <= len(candidate) <= 200 and not any(char.isspace() for char in candidate)


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse KEY=VALUE lines. Supports comments, ``export``, quotes and trailing comments."""
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        name, separator, raw_value = line.partition("=")
        name = name.strip()
        if not separator or not name:
            continue
        value = raw_value.strip()
        if value[:1] in ("'", '"'):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        elif " #" in value:
            value = value.split(" #", 1)[0].strip()
        values[name] = value
    return values


def dotenv_candidates() -> list[Path]:
    override = os.environ.get(ENV_FILE_VAR, "").strip()
    if override:
        return [Path(override).expanduser()]
    candidates = [Path.cwd() / ".env", PROJECT_ROOT / ".env"]
    unique: list[Path] = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def read_dotenv_key(paths: list[Path] | None = None) -> str:
    for path in paths if paths is not None else dotenv_candidates():
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        value = parse_dotenv(text).get(KEY_ENV_VAR, "").strip()
        if value:
            return value
    return ""


def _keyring() -> Any:
    try:
        import keyring
    except ImportError:
        return None
    return keyring


def keychain_available() -> bool:
    module = _keyring()
    if module is None:
        return False
    try:
        backend = module.get_keyring()
    except Exception:  # no usable backend
        return False
    name = f"{type(backend).__module__}.{type(backend).__name__}".lower()
    return "fail" not in name and "null" not in name


def keychain_get() -> str:
    module = _keyring()
    if module is None:
        return ""
    try:
        return str(module.get_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) or "").strip()
    except Exception:  # no backend, or the keychain is locked
        log.debug("Keychain lookup failed", exc_info=True)
        return ""


def keychain_store(key: str) -> None:
    module = _keyring()
    if module is None:
        raise KeystoreError("The 'keyring' package is not installed.")
    try:
        module.set_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.strip())
    except Exception as exc:
        raise KeystoreError(f"Could not save the key to the system keychain ({exc}).") from exc


def keychain_forget() -> None:
    module = _keyring()
    if module is None:
        return
    try:
        module.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    except Exception:  # nothing stored, or no backend
        log.debug("Nothing to remove from the keychain", exc_info=True)


def resolve_gemini_key() -> KeyInfo:
    env_value = os.environ.get(KEY_ENV_VAR, "").strip()
    if env_value:
        return KeyInfo(env_value, "environment")
    stored = keychain_get()
    if stored:
        return KeyInfo(stored, "keychain")
    from_file = read_dotenv_key()
    if from_file:
        return KeyInfo(from_file, "dotenv")
    return KeyInfo()
