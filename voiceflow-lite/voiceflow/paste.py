"""Clipboard handling and the platform paste shortcut."""

from __future__ import annotations

import logging
import sys
import threading
import time
from collections.abc import Callable

import pyperclip

log = logging.getLogger(__name__)

CLIPBOARD_SETTLE_S = 0.08
RESTORE_DELAY_S = 1.0


def send_paste_shortcut() -> None:
    """Press Cmd+V on macOS or Ctrl+V on Windows and Linux in whichever app has focus."""
    from pynput.keyboard import Controller, Key  # imported lazily: pynput needs a display on Linux

    keyboard = Controller()
    modifier = Key.cmd if sys.platform == "darwin" else Key.ctrl
    with keyboard.pressed(modifier):
        keyboard.press("v")
        keyboard.release("v")


def _schedule(delay: float, task: Callable[[], None]) -> None:
    timer = threading.Timer(delay, task)
    timer.daemon = True
    timer.start()


class ClipboardPaster:
    """Copies text and pastes it. The collaborators are injectable so tests can replace them."""

    def __init__(
        self,
        *,
        copy: Callable[[str], None] = pyperclip.copy,
        read: Callable[[], str] = pyperclip.paste,
        send_shortcut: Callable[[], None] = send_paste_shortcut,
        schedule: Callable[[float, Callable[[], None]], None] = _schedule,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._copy = copy
        self._read = read
        self._send = send_shortcut
        self._schedule = schedule
        self._sleep = sleep

    def copy(self, text: str) -> None:
        self._copy(text)

    def paste(self, text: str, *, restore_clipboard: bool) -> None:
        """Put ``text`` on the clipboard, press paste, then optionally restore the old text clipboard."""
        previous = ""
        if restore_clipboard:
            try:
                previous = self._read() or ""
            except Exception:  # the clipboard may hold an image or other non-text data
                previous = ""
        self._copy(text)
        self._sleep(CLIPBOARD_SETTLE_S)
        self._send()
        if restore_clipboard and previous:
            self._schedule(RESTORE_DELAY_S, lambda: self._restore(previous))

    def _restore(self, previous: str) -> None:
        try:
            self._copy(previous)
        except Exception:
            log.warning("Could not restore the previous clipboard text.")
