"""Application controller.

Owns the dictation state machine (idle -> recording -> processing -> idle) and
connects the hotkey listener, microphone, Gemini pipeline, clipboard paste and the
Tk windows. Everything that touches Tk runs on the main thread. Background threads
hand their results back through ``post``.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import tkinter as tk
from collections.abc import Callable

from .audio import AudioClip, AudioError, Recorder
from .config import Settings, load_settings, save_settings
from .gemini import GeminiClient, GeminiError
from .hotkeys import EVENT_CANCEL, EVENT_DOUBLE_TAP, EVENT_HOLD_START, EVENT_HOLD_STOP, GlobalHotkeys
from .keystore import KeyInfo, resolve_gemini_key
from .macos import activate_pid, frontmost_pid
from .paste import ClipboardPaster
from .pipeline import DictationResult, PipelineError, run_pipeline
from .ui.main_window import MainWindow
from .ui.overlay import Overlay
from .ui.settings_window import SettingsWindow
from .ui.theme import apply_theme

log = logging.getLogger(__name__)

POLL_MS = 30
IDLE = "idle"
RECORDING = "recording"
PROCESSING = "processing"
ERROR_LINGER_S = 3.2
DONE_LINGER_S = 1.2
FOCUS_SETTLE_S = 0.15  # give the target app a moment to regain focus before pasting
SELF_EVENT_GUARD_S = 0.8  # ignore our own synthetic Cmd+V / Ctrl+V key events


def _short(message: str, limit: int = 32) -> str:
    return message if len(message) <= limit else message[: limit - 1].rstrip() + "…"


class Controller:
    def __init__(self, root: tk.Tk, settings: Settings) -> None:
        self.root = root
        self.settings = settings
        self.state = IDLE
        self._inbox: queue.Queue[Callable[[], None]] = queue.Queue()
        self._recorder: Recorder | None = None
        self._target_pid: int | None = None
        self._paster = ClipboardPaster()
        self._hotkeys = GlobalHotkeys(self._on_listener_event)
        self._settings_window: SettingsWindow | None = None
        self.overlay = Overlay(root)
        self.overlay.set_enabled(settings.show_overlay)
        self.window = MainWindow(root, self)

    # ----- lifecycle -------------------------------------------------------------------------
    def start(self) -> None:
        self._hotkeys.configure(self.settings.hotkey_mode, self.settings.trigger_key)
        try:
            self._hotkeys.start()
        except Exception as exc:  # pynput missing, no display, or refused by the OS
            log.exception("Global hotkeys could not start")
            self.window.set_notice(
                f"Global hotkeys are unavailable ({exc}). Grant Input Monitoring and "
                "Accessibility, then restart.",
                error=True,
            )
        self.window.refresh()
        self.root.after(POLL_MS, self._poll)

    def quit(self) -> None:
        if self._recorder is not None:
            self._recorder.cancel()
            self._recorder = None
        self._hotkeys.stop()
        self.root.destroy()

    # ----- thread hand-off -------------------------------------------------------------------
    def post(self, task: Callable[[], None]) -> None:
        """Queue work for the main thread. Safe to call from any thread."""
        self._inbox.put(task)

    def _on_listener_event(self, event: str, key_name: str) -> None:
        log.debug("hotkey %s (%s)", event, key_name)
        self.post(lambda: self._handle_hotkey(event))

    def _poll(self) -> None:
        while True:
            try:
                task = self._inbox.get_nowait()
            except queue.Empty:
                break
            try:
                task()
            except Exception:
                log.exception("UI task failed")
        recorder = self._recorder
        if self.state == RECORDING and recorder is not None:
            if recorder.limit_reached.is_set():
                log.info("Maximum recording length reached; finishing the dictation")
                self.stop_recording()
            else:
                self.overlay.tick(recorder.levels)
        else:
            self.overlay.tick(None)
        self.root.after(POLL_MS, self._poll)

    # ----- hotkeys ---------------------------------------------------------------------------
    def _handle_hotkey(self, event: str) -> None:
        if event == EVENT_DOUBLE_TAP:
            self.toggle_recording()
        elif event == EVENT_HOLD_START:
            self.start_recording()
        elif event == EVENT_HOLD_STOP:
            if self.state == RECORDING:
                self.stop_recording()
        elif event == EVENT_CANCEL:
            self.cancel_recording()

    def capture_trigger(self, callback: Callable[[str], None]) -> None:
        """Record the next key the user presses and pass its name to ``callback`` on the UI thread."""
        self._hotkeys.capture_next_key(lambda name: self.post(lambda: callback(name)))

    def cancel_capture(self) -> None:
        self._hotkeys.cancel_capture()

    # ----- recording -------------------------------------------------------------------------
    def toggle_recording(self) -> None:
        if self.state == RECORDING:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self) -> None:
        if self.state == RECORDING:
            return
        if self.state == PROCESSING:
            self.overlay.flash("Still working on the last one…")
            return
        if not resolve_gemini_key().present:
            self._report_error("Add your Gemini API key in Settings first.")
            return
        recorder = Recorder(self.settings.input_device, self.settings.max_recording_seconds)
        try:
            recorder.start()
        except AudioError as exc:
            self._report_error(str(exc))
            return
        self._recorder = recorder
        self._target_pid = frontmost_pid()
        self.state = RECORDING
        self._hotkeys.set_recording(True)
        self.window.set_state(RECORDING)
        self.overlay.show_recording()

    def stop_recording(self) -> None:
        recorder = self._recorder
        if self.state != RECORDING or recorder is None:
            return
        self._recorder = None
        self._hotkeys.set_recording(False)
        try:
            clip = recorder.stop()
        except AudioError as exc:
            self.state = IDLE
            self.window.set_state(IDLE)
            self._report_error(str(exc))
            return
        key = resolve_gemini_key()
        self.state = PROCESSING
        self.window.set_state(PROCESSING)
        self.overlay.show_processing("Transcribing…")
        worker = threading.Thread(
            target=self._process,
            args=(clip, self.settings, key),
            name="voiceflow-pipeline",
            daemon=True,
        )
        worker.start()

    def cancel_recording(self) -> None:
        recorder = self._recorder
        if recorder is None:
            return
        self._recorder = None
        recorder.cancel()
        self._hotkeys.set_recording(False)
        self._target_pid = None
        self.state = IDLE
        self.window.set_state(IDLE)
        self.overlay.show_result("Cancelled", kind="muted", linger=0.9)

    # ----- pipeline (worker thread) ----------------------------------------------------------
    def _process(self, clip: AudioClip, settings: Settings, key: KeyInfo) -> None:
        def progress(message: str) -> None:
            self.post(lambda: self.overlay.set_text(message))

        try:
            result = run_pipeline(clip, settings, GeminiClient(key.key), progress)
        except (PipelineError, GeminiError) as exc:
            message = str(exc)
            self.post(lambda: self._finish_error(message))
        except Exception as exc:  # keep the app alive on unexpected failures
            log.exception("Dictation pipeline failed")
            message = f"Unexpected error: {exc}"
            self.post(lambda: self._finish_error(message))
        else:
            self.post(lambda: self._deliver(result, settings))

    # ----- delivery (main thread) ------------------------------------------------------------
    def _deliver(self, result: DictationResult, settings: Settings) -> None:
        self.state = IDLE
        self.window.set_state(IDLE)
        self.window.set_last_result(result.text, result.warning)
        target, self._target_pid = self._target_pid, None
        try:
            if settings.auto_paste:
                if activate_pid(target):
                    time.sleep(FOCUS_SETTLE_S)
                self._hotkeys.ignore_for(SELF_EVENT_GUARD_S)
                self._paster.paste(result.text, restore_clipboard=settings.restore_clipboard)
                self.overlay.show_result("Pasted", kind="ok", linger=DONE_LINGER_S)
            else:
                self._paster.copy(result.text)
                self.overlay.show_result("Copied", kind="ok", linger=DONE_LINGER_S)
        except Exception as exc:  # clipboard or keystroke injection failed
            log.exception("Paste failed")
            self.window.set_notice(
                f"Could not paste automatically ({exc}). The text is on your clipboard.",
                error=True,
            )
            self._safe_copy(result.text)
            self.overlay.show_result("Copied, paste failed", kind="error", linger=ERROR_LINGER_S)

    def _safe_copy(self, text: str) -> None:
        try:
            self._paster.copy(text)
        except Exception:
            log.exception("Clipboard copy failed")

    def _finish_error(self, message: str) -> None:
        self.state = IDLE
        self._target_pid = None
        self.window.set_state(IDLE)
        self._report_error(message)

    def _report_error(self, message: str) -> None:
        log.warning("%s", message)
        self.window.set_notice(message, error=True)
        self.overlay.show_result(_short(message), kind="error", linger=ERROR_LINGER_S)

    # ----- settings --------------------------------------------------------------------------
    def open_settings(self) -> None:
        window = self._settings_window
        if window is not None and window.exists():
            window.focus()
            return
        self._settings_window = SettingsWindow(self.root, self)

    def apply_settings(self, new_settings: Settings) -> None:
        self.settings = new_settings.sanitized()
        self.overlay.set_enabled(self.settings.show_overlay)
        self._hotkeys.configure(self.settings.hotkey_mode, self.settings.trigger_key)
        try:
            save_settings(self.settings)
        except OSError as exc:
            log.error("Could not save settings: %s", exc)
            self.window.set_notice(f"Could not save settings: {exc}", error=True)
        self.window.refresh()

    def test_connection(self, api_key: str, model: str, on_done: Callable[[str, bool], None]) -> None:
        """Run the Gemini round-trip off the UI thread; ``on_done(message, ok)`` runs on the UI thread."""

        def worker() -> None:
            try:
                reply = GeminiClient(api_key).test_connection(model)
                outcome: tuple[str, bool] = (f"{model} replied: {reply}", True)
            except GeminiError as exc:
                outcome = (str(exc), False)
            except Exception as exc:
                outcome = (f"Unexpected error: {exc}", False)
            message, ok = outcome
            self.post(lambda: on_done(message, ok))

        threading.Thread(target=worker, name="voiceflow-connection-test", daemon=True).start()


def launch() -> int:
    root = tk.Tk()
    apply_theme(root)
    controller = Controller(root, load_settings())
    controller.start()
    root.mainloop()
    return 0
