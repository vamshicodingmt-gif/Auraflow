from __future__ import annotations

from voiceflow.hotkeys import (
    EVENT_CANCEL,
    EVENT_DOUBLE_TAP,
    EVENT_HOLD_START,
    EVENT_HOLD_STOP,
    DoubleTapDetector,
    GlobalHotkeys,
    HoldDetector,
)
from voiceflow.keys import describe_trigger, key_matches, normalize_key_name


class FakeKey:
    """Stands in for a pynput key: enum members expose ``.name``."""

    def __init__(self, name: str) -> None:
        self.name = name


def tap(detector, name: str, start: float, length: float = 0.1) -> list[str]:
    """Press at ``start`` and release ``length`` seconds later. Return any events produced."""
    events = [detector.feed(name, True, start), detector.feed(name, False, start + length)]
    return [event for event in events if event]


def test_double_tap_fires_on_the_second_release():
    detector = DoubleTapDetector("ctrl_l")
    assert tap(detector, "ctrl_l", 0.0) == []
    assert tap(detector, "ctrl_l", 0.3) == [EVENT_DOUBLE_TAP]


def test_a_slow_second_tap_is_not_a_double_tap():
    detector = DoubleTapDetector("ctrl_l")
    assert tap(detector, "ctrl_l", 0.0) == []
    assert tap(detector, "ctrl_l", 1.0) == []


def test_a_long_hold_is_not_a_tap():
    detector = DoubleTapDetector("ctrl_l")
    assert tap(detector, "ctrl_l", 0.0, length=0.6) == []
    assert tap(detector, "ctrl_l", 0.8) == []  # the long press does not pair with this tap


def test_ctrl_shortcut_does_not_count_as_a_tap():
    detector = DoubleTapDetector("ctrl_l")
    events = [
        detector.feed("ctrl_l", True, 0.0),
        detector.feed("c", True, 0.05),
        detector.feed("c", False, 0.1),
        detector.feed("ctrl_l", False, 0.15),
    ]
    assert events == [None, None, None, None]
    assert tap(detector, "ctrl_l", 0.3) == []  # the shortcut did not arm a double tap
    assert tap(detector, "ctrl_l", 0.5) == [EVENT_DOUBLE_TAP]


def test_other_key_between_taps_breaks_the_pair():
    detector = DoubleTapDetector("ctrl_l")
    assert tap(detector, "ctrl_l", 0.0) == []
    detector.feed("a", True, 0.15)  # typing between the taps
    detector.feed("a", False, 0.2)
    assert tap(detector, "ctrl_l", 0.3) == []


def test_auto_repeat_presses_are_ignored():
    detector = DoubleTapDetector("ctrl_l")
    detector.feed("ctrl_l", True, 0.0)
    detector.feed("ctrl_l", True, 0.03)
    detector.feed("ctrl_l", True, 0.06)
    assert detector.feed("ctrl_l", False, 0.1) is None
    assert tap(detector, "ctrl_l", 0.3) == [EVENT_DOUBLE_TAP]


def test_a_third_tap_starts_a_new_sequence():
    detector = DoubleTapDetector("ctrl_l")
    tap(detector, "ctrl_l", 0.0)
    assert tap(detector, "ctrl_l", 0.2) == [EVENT_DOUBLE_TAP]
    assert tap(detector, "ctrl_l", 0.4) == []
    assert tap(detector, "ctrl_l", 0.6) == [EVENT_DOUBLE_TAP]


def test_the_other_control_key_does_not_trigger():
    detector = DoubleTapDetector("ctrl_l")
    assert tap(detector, "ctrl_r", 0.0) == []
    assert tap(detector, "ctrl_r", 0.2) == []


def test_hold_detector_emits_start_and_stop_once():
    hold = HoldDetector("alt_r")
    assert hold.feed("alt_r", True, 0.0) == EVENT_HOLD_START
    assert hold.feed("alt_r", True, 0.05) is None  # key repeat
    assert hold.feed("alt_r", False, 1.0) == EVENT_HOLD_STOP
    assert hold.feed("alt_r", False, 1.1) is None
    assert hold.feed("ctrl_l", True, 1.2) is None


def test_generic_modifier_matches_either_side():
    assert key_matches("ctrl", "ctrl_l")
    assert key_matches("ctrl", "ctrl_r")
    assert not key_matches("ctrl_l", "ctrl_r")
    assert key_matches("f8", "f8")
    assert not key_matches("f8", "f9")


def test_key_names_and_descriptions():
    assert normalize_key_name("Left Control") == "ctrl_l"
    assert normalize_key_name("right-option") == "alt_r"
    assert normalize_key_name("F9") == "f9"
    assert describe_trigger("hold", "alt_r") == "Hold Right Option / Alt"
    assert describe_trigger("double_tap", "ctrl_l") == "Double-tap Left Control"


def test_capture_takes_the_next_key_without_emitting_events():
    events: list[tuple[str, str]] = []
    hotkeys = GlobalHotkeys(lambda event, name: events.append((event, name)), clock=lambda: 0.0)
    hotkeys.configure("double_tap", "ctrl_l")
    captured: list[str] = []
    hotkeys.capture_next_key(captured.append)
    hotkeys._dispatch(FakeKey("f8"), True)
    assert captured == ["f8"]
    assert events == []


def test_escape_cancels_only_while_recording():
    events: list[tuple[str, str]] = []
    hotkeys = GlobalHotkeys(lambda event, name: events.append((event, name)), clock=lambda: 0.0)
    hotkeys.configure("double_tap", "ctrl_l")
    hotkeys._dispatch(FakeKey("esc"), True)
    assert events == []
    hotkeys.set_recording(True)
    hotkeys._dispatch(FakeKey("esc"), True)
    assert events == [(EVENT_CANCEL, "esc")]


def test_double_tap_through_the_listener_path():
    now = [0.0]
    events: list[str] = []
    hotkeys = GlobalHotkeys(lambda event, name: events.append(event), clock=lambda: now[0])
    hotkeys.configure("double_tap", "ctrl_l")
    for start in (0.0, 0.25):
        now[0] = start
        hotkeys._dispatch(FakeKey("ctrl_l"), True)
        now[0] = start + 0.1
        hotkeys._dispatch(FakeKey("ctrl_l"), False)
    assert events == [EVENT_DOUBLE_TAP]


def test_ignore_window_suppresses_our_own_keystrokes():
    now = [0.0]
    events: list[str] = []
    hotkeys = GlobalHotkeys(lambda event, name: events.append(event), clock=lambda: now[0])
    hotkeys.configure("double_tap", "ctrl_l")
    hotkeys.ignore_for(0.8)
    for start in (0.0, 0.25):
        now[0] = start
        hotkeys._dispatch(FakeKey("ctrl_l"), True)
        now[0] = start + 0.1
        hotkeys._dispatch(FakeKey("ctrl_l"), False)
    assert events == []
