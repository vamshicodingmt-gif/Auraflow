"""Control panel: status, permissions, the last dictation and quick actions."""

from __future__ import annotations

import tkinter as tk
from functools import partial
from tkinter import ttk
from typing import TYPE_CHECKING

from .. import APP_NAME
from ..keys import describe_trigger
from ..keystore import resolve_gemini_key
from ..permissions import PermissionStatus, check_permissions, open_system_settings
from .theme import COLORS, mono_family

if TYPE_CHECKING:
    from ..app import Controller

_STATE_TEXT = {
    "granted": "Allowed",
    "denied": "Blocked",
    "undetermined": "Not asked yet",
    "unknown": "Check manually",
    "not_needed": "Not needed",
}
_STATE_STYLE = {
    "granted": "CardOk.TLabel",
    "denied": "CardError.TLabel",
    "undetermined": "CardWarn.TLabel",
    "unknown": "CardWarn.TLabel",
    "not_needed": "CardMuted.TLabel",
}
_NEEDS_ACTION = ("denied", "undetermined", "unknown")


class MainWindow:
    def __init__(self, root: tk.Tk, controller: Controller) -> None:
        self._root = root
        self._ctl = controller
        root.title(APP_NAME)
        root.geometry("640x660")
        root.minsize(580, 580)
        root.protocol("WM_DELETE_WINDOW", controller.quit)

        outer = ttk.Frame(root, style="App.TFrame", padding=22)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text=APP_NAME, style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="Push-to-talk dictation with Gemini transcription and cleanup",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(2, 16))

        status = ttk.Frame(outer, style="Card.TFrame", padding=16)
        status.pack(fill="x")
        self._status_var = tk.StringVar(value="Ready")
        ttk.Label(status, textvariable=self._status_var, style="CardHeading.TLabel").pack(anchor="w")
        self._hint_var = tk.StringVar(value="")
        ttk.Label(status, textvariable=self._hint_var, style="CardMuted.TLabel").pack(anchor="w", pady=(4, 0))
        self._key_var = tk.StringVar(value="")
        ttk.Label(
            status,
            textvariable=self._key_var,
            style="CardMuted.TLabel",
            wraplength=560,
            justify="left",
        ).pack(anchor="w", pady=(8, 0))
        self._notice_var = tk.StringVar(value="")
        self._notice = ttk.Label(
            status,
            textvariable=self._notice_var,
            style="CardMuted.TLabel",
            wraplength=560,
            justify="left",
        )
        self._notice.pack(anchor="w", pady=(8, 0))

        permissions = ttk.Frame(outer, style="Card.TFrame", padding=16)
        permissions.pack(fill="x", pady=(14, 0))
        ttk.Label(permissions, text="Permissions", style="CardHeading.TLabel").pack(anchor="w")
        self._perm_box = ttk.Frame(permissions, style="Card.TFrame")
        self._perm_box.pack(fill="x", pady=(6, 0))

        result = ttk.Frame(outer, style="Card.TFrame", padding=16)
        result.pack(fill="both", expand=True, pady=(14, 0))
        header = ttk.Frame(result, style="Card.TFrame")
        header.pack(fill="x")
        ttk.Label(header, text="Last dictation", style="CardHeading.TLabel").pack(side="left")
        ttk.Button(header, text="Copy", command=self._copy_result).pack(side="right")
        self._result = tk.Text(
            result,
            height=6,
            wrap="word",
            background=COLORS["surface_alt"],
            foreground=COLORS["text"],
            insertbackground=COLORS["text"],
            relief="flat",
            padx=10,
            pady=8,
            font=(mono_family(), 11),
            highlightthickness=1,
            highlightbackground=COLORS["border"],
            highlightcolor=COLORS["accent"],
            state="disabled",
        )
        self._result.pack(fill="both", expand=True, pady=(10, 0))

        footer = ttk.Frame(outer, style="App.TFrame")
        footer.pack(fill="x", pady=(16, 0))
        self._toggle = ttk.Button(
            footer,
            text="Start dictation",
            style="Accent.TButton",
            command=controller.toggle_recording,
        )
        self._toggle.pack(side="left")
        ttk.Button(footer, text="Settings…", command=controller.open_settings).pack(side="left", padx=(10, 0))
        ttk.Button(footer, text="Quit", command=controller.quit).pack(side="right")

        self.refresh()

    def refresh(self) -> None:
        """Re-read the key, hotkey and permission state."""
        settings = self._ctl.settings
        self._hint_var.set(f"{describe_trigger(settings.hotkey_mode, settings.trigger_key)} · Esc cancels")
        key = resolve_gemini_key()
        if key.present:
            self._key_var.set(f"Gemini key {key.masked()} · from {key.describe()}")
        else:
            self._key_var.set("No Gemini key yet. Open Settings → API key, or add GEMINI_API_KEY to a .env file.")
        self._render_permissions(check_permissions())

    def set_state(self, state: str) -> None:
        if state == "recording":
            self._status_var.set("Listening… speak now")
            self._toggle.configure(text="Stop dictation", state="normal")
        elif state == "processing":
            self._status_var.set("Transcribing and cleaning up…")
            self._toggle.configure(text="Working…", state="disabled")
        else:
            self._status_var.set("Ready")
            self._toggle.configure(text="Start dictation", state="normal")

    def set_notice(self, text: str, *, error: bool = False) -> None:
        self._notice_var.set(text)
        self._notice.configure(style="CardError.TLabel" if error else "CardMuted.TLabel")

    def set_last_result(self, text: str, warning: str = "") -> None:
        self._result.configure(state="normal")
        self._result.delete("1.0", "end")
        self._result.insert("1.0", text)
        self._result.configure(state="disabled")
        if warning:
            self.set_notice(warning)

    def _render_permissions(self, checks: list[PermissionStatus]) -> None:
        for child in self._perm_box.winfo_children():
            child.destroy()
        for check in checks:
            row = ttk.Frame(self._perm_box, style="Card.TFrame")
            row.pack(fill="x", pady=4)
            head = ttk.Frame(row, style="Card.TFrame")
            head.pack(fill="x")
            ttk.Label(head, text=check.title, style="CardHeading.TLabel").pack(side="left")
            ttk.Label(
                head,
                text=_STATE_TEXT.get(check.state, check.state),
                style=_STATE_STYLE.get(check.state, "CardMuted.TLabel"),
            ).pack(side="left", padx=(10, 0))
            ttk.Label(
                row,
                text=check.detail,
                style="CardMuted.TLabel",
                wraplength=560,
                justify="left",
            ).pack(anchor="w", pady=(2, 0))
            if check.state in _NEEDS_ACTION and check.settings_url:
                ttk.Button(
                    row,
                    text="Open System Settings",
                    command=partial(open_system_settings, check.settings_url),
                ).pack(anchor="w", pady=(4, 0))

    def _copy_result(self) -> None:
        text = self._result.get("1.0", "end-1c")
        if text:
            self._root.clipboard_clear()
            self._root.clipboard_append(text)
