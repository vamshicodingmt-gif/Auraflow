"""Command-line entry point.

    python -m voiceflow                      start the desktop app
    python -m voiceflow --check              show configuration and permission status
    python -m voiceflow --check-key          send a tiny request to verify the Gemini key
    python -m voiceflow --transcribe-file X  run a WAV file through the full pipeline

The GUI imports Tk only when it starts, so the command-line modes work without it.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import wave
from pathlib import Path

from . import APP_NAME, __version__
from .audio import AudioError, load_wav_clip
from .config import CLEANUP_STYLES, config_dir, load_settings, settings_path
from .gemini import GeminiClient, GeminiError
from .keys import describe_trigger
from .keystore import resolve_gemini_key
from .permissions import check_permissions
from .pipeline import PipelineError, run_pipeline

MISSING_KEY_HINT = "No Gemini key found. Set GEMINI_API_KEY, save one in Settings, or add it to .env."


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="voiceflow-lite",
        description="Push-to-talk dictation powered by Gemini.",
    )
    parser.add_argument("--version", action="store_true", help="print the version and exit")
    parser.add_argument("--check", action="store_true", help="show configuration and permission status")
    parser.add_argument("--check-key", action="store_true", help="verify the Gemini API key with a tiny request")
    parser.add_argument(
        "--transcribe-file",
        type=Path,
        metavar="WAV",
        help="transcribe and clean a WAV file, then print the result",
    )
    return parser


def cmd_check() -> int:
    settings = load_settings()
    key = resolve_gemini_key()
    path = settings_path()
    print(f"{APP_NAME} {__version__}")
    print(f"Config folder : {config_dir()}")
    state = "found" if path.exists() else "not created yet; defaults in use"
    print(f"Settings      : {path} ({state})")
    print(f"Hotkey        : {describe_trigger(settings.hotkey_mode, settings.trigger_key)}")
    cleanup = CLEANUP_STYLES[settings.cleanup_style] if settings.cleanup_enabled else "off"
    print(f"Cleanup       : {cleanup}")
    print(f"Models        : transcribe={settings.transcribe_model}  cleanup={settings.cleanup_model}")
    if key.present:
        print(f"Gemini key    : {key.masked()} (from {key.describe()})")
    else:
        print("Gemini key    : missing. Set GEMINI_API_KEY, save one in Settings, or add it to .env")
    print("Permissions:")
    for check in check_permissions():
        print(f"  {check.title:<16} {check.state:<13} {check.detail}")
    return 0 if key.present else 1


def cmd_check_key() -> int:
    key = resolve_gemini_key()
    if not key.present:
        print(MISSING_KEY_HINT, file=sys.stderr)
        return 1
    model = load_settings().cleanup_model
    try:
        reply = GeminiClient(key.key).test_connection(model)
    except GeminiError as exc:
        print(f"Gemini check failed: {exc}", file=sys.stderr)
        return 2
    print(f"OK: {model} replied {reply}")
    return 0


def cmd_transcribe_file(path: Path) -> int:
    key = resolve_gemini_key()
    if not key.present:
        print(MISSING_KEY_HINT, file=sys.stderr)
        return 1
    try:
        clip = load_wav_clip(path)
    except (OSError, wave.Error, AudioError) as exc:
        print(f"Could not read {path}: {exc}", file=sys.stderr)
        return 1
    try:
        result = run_pipeline(
            clip,
            load_settings(),
            GeminiClient(key.key),
            progress=lambda message: print(message, file=sys.stderr),
        )
    except (PipelineError, GeminiError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    print(result.text)
    if result.warning:
        print(f"Warning: {result.warning}", file=sys.stderr)
    return 0


def _enable_dpi_awareness() -> None:
    """Stop Windows from blurring the Tk windows on high-DPI screens."""
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass


def run_gui() -> int:
    if sys.platform == "win32":
        _enable_dpi_awareness()
    from .app import launch

    return launch()


def _configure_logging() -> None:
    level_name = os.environ.get("VOICEFLOW_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level_name, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _configure_logging()
    if args.version:
        print(f"{APP_NAME} {__version__}")
        return 0
    if args.check:
        return cmd_check()
    if args.check_key:
        return cmd_check_key()
    if args.transcribe_file is not None:
        return cmd_transcribe_file(args.transcribe_file)
    return run_gui()


if __name__ == "__main__":
    raise SystemExit(main())
