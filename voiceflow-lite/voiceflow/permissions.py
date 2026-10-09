"""Startup checks for the operating-system permissions VoiceFlow-Lite needs.

* macOS: Microphone, Input Monitoring (hear the hotkey while other apps are in front)
  and Accessibility (send Cmd+V into other apps).
* Windows: the microphone privacy switch must allow desktop apps.
* Linux: global hotkeys and paste need an X11 session.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from dataclasses import dataclass

from . import macos

log = logging.getLogger(__name__)

MAC_PANES = {
    "microphone": "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    "input_monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    "accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
}
WINDOWS_MIC_PANE = "ms-settings:privacy-microphone"
_WINDOWS_MIC_KEYS = (
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged",
)


@dataclass(frozen=True)
class PermissionStatus:
    key: str
    title: str
    state: str  # granted | denied | undetermined | unknown | not_needed
    detail: str
    settings_url: str = ""


def check_permissions() -> list[PermissionStatus]:
    if sys.platform == "darwin":
        return [_mac_microphone(), _mac_input_monitoring(), _mac_accessibility()]
    if sys.platform == "win32":
        return [_windows_microphone()]
    return [
        PermissionStatus(
            key="display",
            title="Display server",
            state="unknown",
            detail="Global hotkeys and auto-paste need an X11 session on Linux. Wayland is not supported.",
        )
    ]


def _mac_microphone() -> PermissionStatus:
    url = MAC_PANES["microphone"]
    status = macos.microphone_status()
    if status is None:
        return PermissionStatus(
            "microphone",
            "Microphone",
            "unknown",
            "Could not read the microphone permission. If recordings are silent, allow it under "
            "Privacy & Security → Microphone.",
            url,
        )
    if status == 3:
        return PermissionStatus("microphone", "Microphone", "granted", "Microphone access is allowed.", url)
    if status == 0:
        return PermissionStatus(
            "microphone",
            "Microphone",
            "undetermined",
            "macOS asks the first time you dictate. You can also allow it under Privacy & Security → Microphone.",
            url,
        )
    return PermissionStatus(
        "microphone",
        "Microphone",
        "denied",
        "Microphone access is blocked. Allow the app that runs VoiceFlow-Lite (Terminal, iTerm, VS Code…) "
        "under Privacy & Security → Microphone, then restart it.",
        url,
    )


def _mac_flag(key: str, title: str, granted: bool | None, blocked_detail: str, url: str) -> PermissionStatus:
    if granted is None:
        return PermissionStatus(key, title, "unknown", f"Could not read this permission. {blocked_detail}", url)
    if granted:
        return PermissionStatus(key, title, "granted", f"{title} is allowed.", url)
    return PermissionStatus(key, title, "denied", blocked_detail, url)


def _mac_input_monitoring() -> PermissionStatus:
    return _mac_flag(
        "input_monitoring",
        "Input Monitoring",
        macos.input_monitoring_granted(),
        "Needed to hear the hotkey while other apps are in front. Enable it under Privacy & Security → "
        "Input Monitoring, then restart.",
        MAC_PANES["input_monitoring"],
    )


def _mac_accessibility() -> PermissionStatus:
    return _mac_flag(
        "accessibility",
        "Accessibility",
        macos.accessibility_granted(),
        "Needed to press Cmd+V in other apps. Enable it under Privacy & Security → Accessibility, then restart.",
        MAC_PANES["accessibility"],
    )


def _windows_microphone() -> PermissionStatus:
    if sys.platform != "win32":
        return PermissionStatus("microphone", "Microphone", "unknown", "Windows only.", WINDOWS_MIC_PANE)
    import winreg

    readable = False
    blocked = False
    for path in _WINDOWS_MIC_KEYS:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as handle:
                value, _ = winreg.QueryValueEx(handle, "Value")
        except OSError:
            continue
        readable = True
        blocked = blocked or str(value).lower() == "deny"
    if blocked:
        return PermissionStatus(
            "microphone",
            "Microphone",
            "denied",
            "Windows blocks microphone access for desktop apps. Turn on 'Let desktop apps access your "
            "microphone' under Privacy & security → Microphone.",
            WINDOWS_MIC_PANE,
        )
    if readable:
        return PermissionStatus(
            "microphone", "Microphone", "granted", "Microphone access is allowed.", WINDOWS_MIC_PANE
        )
    return PermissionStatus(
        "microphone",
        "Microphone",
        "unknown",
        "Could not read the microphone setting. If recordings are silent, check Privacy & security → Microphone.",
        WINDOWS_MIC_PANE,
    )


def open_system_settings(url: str) -> None:
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", url])
        elif sys.platform == "win32":
            os.startfile(url)
    except OSError:
        log.warning("Could not open %s", url)
