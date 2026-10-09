"""Keyboard key names shared by the hotkey listener, the settings UI and the tests.

Names follow pynput's ``Key`` enum (``ctrl_l``, ``alt_r``, ``f8`` and so on).
Single characters are stored lowercase (``"a"``). Generic modifiers such as
``"ctrl"`` match either side of the keyboard.
"""

from __future__ import annotations

import re
from typing import Any

KEY_LABELS: dict[str, str] = {
    "ctrl_l": "Left Control",
    "ctrl_r": "Right Control",
    "ctrl": "Control (either side)",
    "alt_l": "Left Option / Alt",
    "alt_r": "Right Option / Alt",
    "alt": "Option / Alt (either side)",
    "alt_gr": "AltGr",
    "shift_l": "Left Shift",
    "shift_r": "Right Shift",
    "cmd_l": "Left Command / Win",
    "cmd_r": "Right Command / Win",
    "cmd": "Command / Win (either side)",
    "caps_lock": "Caps Lock",
    "esc": "Escape",
    "space": "Space",
    "tab": "Tab",
    **{f"f{number}": f"F{number}" for number in range(1, 13)},
}

# Keys offered in the Settings dropdown. Any other key can be captured with "Record key".
TRIGGER_CHOICES: tuple[tuple[str, str], ...] = (
    ("Left Control", "ctrl_l"),
    ("Right Control", "ctrl_r"),
    ("Left Option / Alt", "alt_l"),
    ("Right Option / Alt", "alt_r"),
    ("Right Shift", "shift_r"),
    ("F8", "f8"),
    ("F9", "f9"),
    ("F10", "f10"),
    ("F12", "f12"),
)

_ALIASES: dict[str, str] = {
    "left_ctrl": "ctrl_l",
    "left_control": "ctrl_l",
    "lctrl": "ctrl_l",
    "control_l": "ctrl_l",
    "right_ctrl": "ctrl_r",
    "right_control": "ctrl_r",
    "rctrl": "ctrl_r",
    "control_r": "ctrl_r",
    "left_alt": "alt_l",
    "left_option": "alt_l",
    "left_option_alt": "alt_l",
    "option_l": "alt_l",
    "option": "alt",
    "right_alt": "alt_r",
    "right_option": "alt_r",
    "right_option_alt": "alt_r",
    "option_r": "alt_r",
    "left_shift": "shift_l",
    "right_shift": "shift_r",
    "left_cmd": "cmd_l",
    "left_command": "cmd_l",
    "left_win": "cmd_l",
    "command_l": "cmd_l",
    "right_cmd": "cmd_r",
    "right_command": "cmd_r",
    "right_win": "cmd_r",
    "command_r": "cmd_r",
    "win": "cmd",
    "windows": "cmd",
    "command": "cmd",
    "escape": "esc",
    "capslock": "caps_lock",
}

_GENERIC_MODIFIERS = ("ctrl", "alt", "shift", "cmd")


def normalize_key_name(raw: str) -> str:
    """Turn user text such as "Right Option", "ctrl-l" or "F8" into a key name."""
    name = re.sub(r"[^a-z0-9]+", "_", raw.strip().lower()).strip("_")
    return _ALIASES.get(name, name)


def key_from_text(text: str) -> str:
    """Resolve a dropdown label or typed text (for example "Left Control" or "f5") to a key name."""
    wanted = text.strip().casefold()
    for name, label in KEY_LABELS.items():
        if label.casefold() == wanted:
            return name
    return normalize_key_name(text)


def key_label(name: str) -> str:
    return KEY_LABELS.get(name, name)


def describe_trigger(mode: str, name: str) -> str:
    """Short sentence for the hotkey, for example "Double-tap Left Control"."""
    label = key_label(name)
    return f"Hold {label}" if mode == "hold" else f"Double-tap {label}"


def key_matches(trigger: str, event_name: str) -> bool:
    if trigger == event_name:
        return True
    return trigger in _GENERIC_MODIFIERS and event_name.startswith(trigger + "_")


def key_name_from_pynput(key: Any) -> str:
    """Name for a pynput key object. Enum members carry ``.name``; characters carry ``.char``."""
    name = getattr(key, "name", None)
    if isinstance(name, str) and name:
        return name
    char = getattr(key, "char", None)
    if isinstance(char, str) and char:
        return char.lower()
    vk = getattr(key, "vk", None)
    return f"vk{vk}" if vk is not None else ""
