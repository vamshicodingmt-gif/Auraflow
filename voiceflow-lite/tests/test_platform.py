from __future__ import annotations

import sys

from voiceflow import macos, permissions


def test_linux_reports_only_the_display_server(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    checks = permissions.check_permissions()
    assert [check.key for check in checks] == ["display"]
    assert checks[0].state == "unknown"


def test_macos_helpers_are_inert_off_macos(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert macos.frontmost_pid() is None
    assert macos.activate_pid(1234) is False
    assert macos.microphone_status() is None
    assert macos.accessibility_granted() is None
    assert macos.input_monitoring_granted() is None
