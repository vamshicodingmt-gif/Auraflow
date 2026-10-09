"""Global hotkeys: double-tap or hold a trigger key, and Esc to cancel.

The detectors are small state machines driven by (key name, pressed, timestamp),
which keeps the timing rules unit-testable. ``GlobalHotkeys`` connects them to the
pynput keyboard listener.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

from .keys import key_matches, key_name_from_pynput

log = logging.getLogger(__name__)

EVENT_DOUBLE_TAP = "double_tap"
EVENT_HOLD_START = "hold_start"
EVENT_HOLD_STOP = "hold_stop"
EVENT_CANCEL = "cancel"

TAP_MAX_HOLD_S = 0.35  # a tap is shorter than this...
TAP_MAX_GAP_S = 0.45  # ...and the next tap starts within this window


class Detector(Protocol):
    def feed(self, name: str, pressed: bool, now: float) -> str | None: ...


class DoubleTapDetector:
    """Emits EVENT_DOUBLE_TAP when the trigger is tapped twice in quick succession.

    A tap only counts when no other key was pressed while the trigger was down,
    so shortcuts such as Ctrl+C never look like taps.
    """

    def __init__(
        self,
        trigger: str,
        *,
        max_hold: float = TAP_MAX_HOLD_S,
        max_gap: float = TAP_MAX_GAP_S,
    ) -> None:
        self.trigger = trigger
        self._max_hold = max_hold
        self._max_gap = max_gap
        self._down_at: float | None = None
        self._tainted = False
        self._first_released: float | None = None
        self._second_pending = False

    def feed(self, name: str, pressed: bool, now: float) -> str | None:
        if not key_matches(self.trigger, name):
            if pressed:
                if self._down_at is not None:
                    self._tainted = True
                self._first_released = None  # any other key breaks a pending pair
            return None

        if pressed:
            if self._down_at is not None:
                return None  # auto-repeat while the key is held
            self._down_at = now
            self._tainted = False
            released = self._first_released
            self._second_pending = released is not None and (now - released) <= self._max_gap
            self._first_released = None
            return None

        if self._down_at is None:
            return None
        held_for = now - self._down_at
        self._down_at = None
        clean = not self._tainted and held_for <= self._max_hold
        if not clean:
            self._second_pending = False
            self._first_released = None
            return None
        if self._second_pending:
            self._second_pending = False
            return EVENT_DOUBLE_TAP
        self._first_released = now
        return None


class HoldDetector:
    """Emits EVENT_HOLD_START when the trigger goes down and EVENT_HOLD_STOP when it comes up."""

    def __init__(self, trigger: str) -> None:
        self.trigger = trigger
        self._down = False

    def feed(self, name: str, pressed: bool, now: float) -> str | None:
        if not key_matches(self.trigger, name):
            return None
        if pressed and not self._down:
            self._down = True
            return EVENT_HOLD_START
        if not pressed and self._down:
            self._down = False
            return EVENT_HOLD_STOP
        return None


class GlobalHotkeys:
    """Owns the pynput listener and turns raw key events into VoiceFlow events.

    ``on_event(event, key_name)`` is called on the listener thread, so the handler
    should only queue work for the UI thread.
    """

    def __init__(
        self,
        on_event: Callable[[str, str], None],
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._on_event = on_event
        self._clock = clock
        self._lock = threading.Lock()
        self._listener: Any = None
        self._trigger = "ctrl_l"
        self._detector: Detector = DoubleTapDetector(self._trigger)
        self._recording = False
        self._capture: Callable[[str], None] | None = None
        self._ignore_until = 0.0

    def configure(self, mode: str, trigger: str) -> None:
        with self._lock:
            self._trigger = trigger
            self._detector = HoldDetector(trigger) if mode == "hold" else DoubleTapDetector(trigger)

    def set_recording(self, active: bool) -> None:
        """While recording, Esc cancels the dictation."""
        with self._lock:
            self._recording = active

    def ignore_for(self, seconds: float) -> None:
        """Drop key events for a short time, so our own synthetic Cmd+V / Ctrl+V is not heard."""
        with self._lock:
            self._ignore_until = self._clock() + seconds

    def capture_next_key(self, callback: Callable[[str], None]) -> None:
        with self._lock:
            self._capture = callback

    def cancel_capture(self) -> None:
        with self._lock:
            self._capture = None

    def start(self) -> None:
        if self._listener is not None:
            return
        from pynput import keyboard  # imported lazily: pynput needs a display server on Linux

        listener = keyboard.Listener(
            on_press=lambda key: self._dispatch(key, True),
            on_release=lambda key: self._dispatch(key, False),
        )
        listener.daemon = True
        listener.start()
        self._listener = listener

    def stop(self) -> None:
        listener, self._listener = self._listener, None
        if listener is not None:
            listener.stop()

    def _dispatch(self, key: object, pressed: bool) -> None:
        name = key_name_from_pynput(key)
        if not name:
            return
        now = self._clock()
        capture_callback: Callable[[str], None] | None = None
        event: tuple[str, str] | None = None
        with self._lock:
            if pressed and self._capture is not None:
                capture_callback, self._capture = self._capture, None
            elif now < self._ignore_until:
                return
            elif pressed and self._recording and key_matches("esc", name):
                event = (EVENT_CANCEL, name)
            else:
                kind = self._detector.feed(name, pressed, now)
                if kind is not None:
                    event = (kind, name)
        if capture_callback is not None:
            capture_callback(name)
        elif event is not None:
            self._on_event(*event)
