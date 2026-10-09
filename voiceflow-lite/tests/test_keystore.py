from __future__ import annotations

from voiceflow import keystore
from voiceflow.keystore import KeyInfo, is_plausible_key, parse_dotenv, read_dotenv_key, resolve_gemini_key

FAKE_KEY = "AQ.Abcdefghijklmnopqrstuvwxyz0123456789"


def test_parse_dotenv_handles_quotes_comments_and_export():
    text = (
        "# a comment\n"
        'export GEMINI_API_KEY="AQ.abc123"  # trailing comment\n'
        "OTHER='x y'\n"
        "EMPTY=\n"
        "NOT_A_PAIR\n"
    )
    assert parse_dotenv(text) == {"GEMINI_API_KEY": "AQ.abc123", "OTHER": "x y", "EMPTY": ""}


def test_plausible_key_shapes_are_accepted_without_prefix_checks():
    assert is_plausible_key(FAKE_KEY)
    assert is_plausible_key("AIzaSyD-1234567890abcdef")  # legacy format still accepted
    assert not is_plausible_key("short")
    assert not is_plausible_key("has spaces in it 1234567890")


def test_masked_hides_the_middle_of_the_key():
    assert KeyInfo(FAKE_KEY, "environment").masked() == "AQ.A…6789"
    assert KeyInfo().masked() == ""
    assert "Abcdefghij" not in KeyInfo(FAKE_KEY, "environment").masked()


def test_key_info_repr_does_not_contain_the_key():
    assert FAKE_KEY not in repr(KeyInfo(FAKE_KEY, "dotenv"))


def test_lookup_order_is_environment_then_keychain_then_dotenv(tmp_path, monkeypatch):
    env_file = tmp_path / "keys.env"
    env_file.write_text("GEMINI_API_KEY=dotenv-value-0000000000\n", encoding="utf-8")
    monkeypatch.setenv("VOICEFLOW_ENV_FILE", str(env_file))
    assert resolve_gemini_key() == KeyInfo("dotenv-value-0000000000", "dotenv")

    monkeypatch.setattr(keystore, "keychain_get", lambda: "keychain-value-000000000")
    assert resolve_gemini_key() == KeyInfo("keychain-value-000000000", "keychain")

    monkeypatch.setenv("GEMINI_API_KEY", "environment-value-00000000")
    assert resolve_gemini_key() == KeyInfo("environment-value-00000000", "environment")


def test_no_key_anywhere_reports_nothing():
    info = resolve_gemini_key()
    assert not info.present
    assert info.describe() == "nowhere yet"


def test_dotenv_candidates_respect_override(tmp_path, monkeypatch):
    target = tmp_path / "custom.env"
    target.write_text("GEMINI_API_KEY=custom-file-key-000000\n", encoding="utf-8")
    monkeypatch.setenv("VOICEFLOW_ENV_FILE", str(target))
    assert read_dotenv_key() == "custom-file-key-000000"
