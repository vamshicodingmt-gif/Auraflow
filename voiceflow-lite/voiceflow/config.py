"""Settings model, validation and per-user file locations.

Settings are stored as JSON in the per-user config directory. API keys are never
written there; see ``keystore.py``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from . import APP_NAME
from .keys import normalize_key_name

log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent

CLEANUP_STYLES: dict[str, str] = {
    "casual": "Casual",
    "balanced": "Balanced",
    "polished": "Polished",
    "code": "Code-focused",
}
HOTKEY_MODES: dict[str, str] = {
    "double_tap": "Double-tap to start / stop",
    "hold": "Hold to talk",
}
DEFAULT_TRANSCRIBE_MODEL = "gemini-3.5-transcribe"
DEFAULT_CLEANUP_MODEL = "gemini-3.5-flash-lite"
RECORDING_LIMIT_CHOICES: tuple[int, ...] = (60, 120, 300)
MIN_RECORDING_SECONDS = 5
MAX_RECORDING_SECONDS = 600
MAX_DICTIONARY_ENTRIES = 100
MAX_TERM_LENGTH = 60

_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$")
_LANGUAGE_RE = re.compile(r"^(?:auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$")
_TRIGGER_RE = re.compile(r"^[a-z0-9_]{1,24}$")


def is_valid_model(name: str) -> bool:
    return bool(_MODEL_RE.match(name.strip()))


def is_valid_language(tag: str) -> bool:
    return bool(_LANGUAGE_RE.match(tag.strip()))


def is_valid_trigger(name: str) -> bool:
    return bool(_TRIGGER_RE.match(name))


def clean_dictionary(value: Any) -> list[str]:
    """Trim, collapse spaces, and drop blanks and case-insensitive duplicates."""
    items: list[Any]
    if isinstance(value, str):
        items = value.splitlines()
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        return []
    seen: set[str] = set()
    terms: list[str] = []
    for item in items:
        if not isinstance(item, str):
            continue
        term = " ".join(item.split())[:MAX_TERM_LENGTH]
        folded = term.casefold()
        if not term or folded in seen:
            continue
        seen.add(folded)
        terms.append(term)
        if len(terms) >= MAX_DICTIONARY_ENTRIES:
            break
    return terms


def _choice(value: Any, options: Mapping[str, str], default: str) -> str:
    return value if isinstance(value, str) and value in options else default


def _flag(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _text(value: Any, default: str, max_length: int) -> str:
    return value.strip()[:max_length] if isinstance(value, str) else default


def _pattern(value: Any, pattern: re.Pattern[str], default: str) -> str:
    if isinstance(value, str) and pattern.match(value.strip()):
        return value.strip()
    return default


def _trigger(value: Any, default: str) -> str:
    if not isinstance(value, str):
        return default
    name = normalize_key_name(value)
    return name if is_valid_trigger(name) else default


def _integer(value: Any, default: int, low: int, high: int) -> int:
    if isinstance(value, bool):
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


@dataclass
class Settings:
    hotkey_mode: str = "double_tap"
    trigger_key: str = "ctrl_l"
    input_device: str = ""  # "" means the system default microphone
    cleanup_enabled: bool = True
    cleanup_style: str = "balanced"
    transcribe_model: str = DEFAULT_TRANSCRIBE_MODEL
    cleanup_model: str = DEFAULT_CLEANUP_MODEL
    language: str = "auto"  # "auto" or a BCP-47 tag such as "en-US"
    auto_paste: bool = True
    restore_clipboard: bool = True
    show_overlay: bool = True
    max_recording_seconds: int = 120
    dictionary: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> Settings:
        """Build settings from loaded JSON. Anything invalid falls back to its default."""
        raw: Mapping[str, Any] = data if isinstance(data, Mapping) else {}
        defaults = cls()
        return cls(
            hotkey_mode=_choice(raw.get("hotkey_mode"), HOTKEY_MODES, defaults.hotkey_mode),
            trigger_key=_trigger(raw.get("trigger_key"), defaults.trigger_key),
            input_device=_text(raw.get("input_device"), defaults.input_device, 200),
            cleanup_enabled=_flag(raw.get("cleanup_enabled"), defaults.cleanup_enabled),
            cleanup_style=_choice(raw.get("cleanup_style"), CLEANUP_STYLES, defaults.cleanup_style),
            transcribe_model=_pattern(raw.get("transcribe_model"), _MODEL_RE, defaults.transcribe_model),
            cleanup_model=_pattern(raw.get("cleanup_model"), _MODEL_RE, defaults.cleanup_model),
            language=_pattern(raw.get("language"), _LANGUAGE_RE, defaults.language),
            auto_paste=_flag(raw.get("auto_paste"), defaults.auto_paste),
            restore_clipboard=_flag(raw.get("restore_clipboard"), defaults.restore_clipboard),
            show_overlay=_flag(raw.get("show_overlay"), defaults.show_overlay),
            max_recording_seconds=_integer(
                raw.get("max_recording_seconds"),
                defaults.max_recording_seconds,
                MIN_RECORDING_SECONDS,
                MAX_RECORDING_SECONDS,
            ),
            dictionary=clean_dictionary(raw.get("dictionary")),
        )

    def sanitized(self) -> Settings:
        return Settings.from_dict(asdict(self))


def config_dir() -> Path:
    """Per-user folder for settings.json. Override with the VOICEFLOW_HOME variable."""
    override = os.environ.get("VOICEFLOW_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / APP_NAME
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "voiceflow-lite"


def settings_path() -> Path:
    return config_dir() / "settings.json"


def load_settings(path: Path | None = None) -> Settings:
    target = path or settings_path()
    try:
        raw = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        return Settings()
    except OSError as exc:
        log.warning("Could not read settings (%s); using defaults.", exc)
        return Settings()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("Settings file is not valid JSON; using defaults.")
        return Settings()
    return Settings.from_dict(data)


def save_settings(settings: Settings, path: Path | None = None) -> Path:
    """Write settings atomically (temporary file, then rename)."""
    target = path or settings_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(asdict(settings.sanitized()), indent=2, ensure_ascii=False) + "\n"
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(payload, encoding="utf-8")
    os.replace(temporary, target)
    return target
