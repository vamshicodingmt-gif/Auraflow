from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from voiceflow.config import (
    DEFAULT_TRANSCRIBE_MODEL,
    MAX_DICTIONARY_ENTRIES,
    MAX_RECORDING_SECONDS,
    Settings,
    clean_dictionary,
    config_dir,
    load_settings,
    save_settings,
    settings_path,
)


def test_defaults_are_already_valid():
    assert Settings().sanitized() == Settings()


def test_invalid_values_fall_back_to_defaults():
    settings = Settings.from_dict(
        {
            "hotkey_mode": "tap-dance",
            "trigger_key": "!!",
            "cleanup_style": "rap",
            "max_recording_seconds": 99999,
            "auto_paste": "yes",
            "language": "klingon??",
            "transcribe_model": "x",
        }
    )
    assert settings.hotkey_mode == "double_tap"
    assert settings.trigger_key == "ctrl_l"
    assert settings.cleanup_style == "balanced"
    assert settings.max_recording_seconds == MAX_RECORDING_SECONDS
    assert settings.auto_paste is True
    assert settings.language == "auto"
    assert settings.transcribe_model == DEFAULT_TRANSCRIBE_MODEL


def test_trigger_names_are_normalised():
    assert Settings.from_dict({"trigger_key": "Right Option / Alt"}).trigger_key == "alt_r"
    assert Settings.from_dict({"trigger_key": "F8"}).trigger_key == "f8"
    assert Settings.from_dict({"trigger_key": "Left Control"}).trigger_key == "ctrl_l"


def test_dictionary_is_cleaned():
    assert clean_dictionary(["  Kubernetes ", "kubernetes", "", "VoiceFlow", "pytest  fixture"]) == [
        "Kubernetes",
        "VoiceFlow",
        "pytest fixture",
    ]
    assert clean_dictionary("alpha\nbeta\n\ngamma") == ["alpha", "beta", "gamma"]
    assert len(clean_dictionary([f"term{i}" for i in range(MAX_DICTIONARY_ENTRIES + 20)])) == (
        MAX_DICTIONARY_ENTRIES
    )
    assert clean_dictionary(42) == []


def test_save_and_load_round_trip(tmp_path: Path):
    path = tmp_path / "settings.json"
    original = Settings(
        cleanup_style="code",
        dictionary=["pytest"],
        input_device="USB Microphone",
        max_recording_seconds=300,
    )
    save_settings(original, path)
    assert load_settings(path) == original


def test_missing_or_corrupt_files_use_defaults(tmp_path: Path):
    assert load_settings(tmp_path / "nope.json") == Settings()
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert load_settings(broken) == Settings()


def test_config_dir_honours_override(isolated_environment: Path):
    assert config_dir() == isolated_environment / "config"
    assert settings_path() == isolated_environment / "config" / "settings.json"


def test_api_key_is_never_stored_in_settings():
    assert "api_key" not in asdict(Settings())
