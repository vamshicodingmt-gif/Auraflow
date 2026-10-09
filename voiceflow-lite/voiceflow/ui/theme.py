"""Colours, fonts and ttk styling shared by every window."""

from __future__ import annotations

import sys
import tkinter as tk
from tkinter import ttk

COLORS: dict[str, str] = {
    "bg": "#0F1115",
    "surface": "#171A21",
    "surface_alt": "#1E222B",
    "border": "#2A2F3A",
    "text": "#E6E8EE",
    "muted": "#8A93A6",
    "accent": "#7DD3FC",
    "accent_hover": "#A5E3FF",
    "accent_text": "#0B0D10",
    "record": "#F43F5E",
    "processing": "#FBBF24",
    "ok": "#34D399",
    "error": "#FB7185",
}


def ui_family() -> str:
    if sys.platform == "darwin":
        return "Helvetica Neue"
    if sys.platform == "win32":
        return "Segoe UI"
    return "DejaVu Sans"


def mono_family() -> str:
    if sys.platform == "darwin":
        return "Menlo"
    if sys.platform == "win32":
        return "Consolas"
    return "DejaVu Sans Mono"


def apply_theme(root: tk.Misc) -> None:
    """Dark styling for ttk widgets. The 'clam' base theme looks the same on every OS."""
    c = COLORS
    style = ttk.Style(root)
    if "clam" in style.theme_names():
        style.theme_use("clam")
    font = (ui_family(), 11)
    style.configure(".", background=c["bg"], foreground=c["text"], font=font)
    style.configure("App.TFrame", background=c["bg"])
    style.configure("Card.TFrame", background=c["surface"])
    style.configure("TLabel", background=c["bg"], foreground=c["text"])
    style.configure("Title.TLabel", background=c["bg"], foreground=c["text"], font=(ui_family(), 22, "bold"))
    style.configure("Section.TLabel", background=c["bg"], foreground=c["text"], font=(ui_family(), 12, "bold"))
    style.configure("Muted.TLabel", background=c["bg"], foreground=c["muted"])
    style.configure("Error.TLabel", background=c["bg"], foreground=c["error"])
    style.configure(
        "CardHeading.TLabel", background=c["surface"], foreground=c["text"], font=(ui_family(), 12, "bold")
    )
    style.configure("CardMuted.TLabel", background=c["surface"], foreground=c["muted"])
    style.configure(
        "CardOk.TLabel", background=c["surface"], foreground=c["ok"], font=(ui_family(), 11, "bold")
    )
    style.configure(
        "CardWarn.TLabel", background=c["surface"], foreground=c["processing"], font=(ui_family(), 11, "bold")
    )
    style.configure(
        "CardError.TLabel", background=c["surface"], foreground=c["error"], font=(ui_family(), 11, "bold")
    )
    style.configure(
        "TButton",
        background=c["surface_alt"],
        foreground=c["text"],
        bordercolor=c["border"],
        lightcolor=c["surface_alt"],
        darkcolor=c["surface_alt"],
        focuscolor=c["surface_alt"],
        padding=(14, 7),
    )
    style.map(
        "TButton",
        background=[("active", c["border"]), ("disabled", c["surface"])],
        foreground=[("disabled", c["muted"])],
    )
    style.configure(
        "Accent.TButton",
        background=c["accent"],
        foreground=c["accent_text"],
        bordercolor=c["accent"],
        lightcolor=c["accent"],
        darkcolor=c["accent"],
        focuscolor=c["accent"],
        font=(ui_family(), 11, "bold"),
        padding=(16, 7),
    )
    style.map(
        "Accent.TButton",
        background=[("active", c["accent_hover"]), ("disabled", c["surface_alt"])],
        foreground=[("disabled", c["muted"])],
    )
    for widget in ("TCheckbutton", "TRadiobutton"):
        style.configure(widget, background=c["bg"], foreground=c["text"], focuscolor=c["bg"])
        style.map(widget, background=[("active", c["bg"])])
    style.configure(
        "TEntry",
        fieldbackground=c["surface"],
        foreground=c["text"],
        insertcolor=c["text"],
        bordercolor=c["border"],
        lightcolor=c["border"],
        darkcolor=c["border"],
        padding=5,
    )
    style.configure(
        "TCombobox",
        fieldbackground=c["surface"],
        foreground=c["text"],
        background=c["surface_alt"],
        arrowcolor=c["text"],
        bordercolor=c["border"],
        lightcolor=c["border"],
        darkcolor=c["border"],
        padding=4,
    )
    style.map(
        "TCombobox",
        fieldbackground=[("readonly", c["surface"])],
        foreground=[("readonly", c["text"])],
        selectbackground=[("readonly", c["surface"])],
        selectforeground=[("readonly", c["text"])],
    )
    style.configure("TNotebook", background=c["bg"], borderwidth=0)
    style.configure("TNotebook.Tab", background=c["surface"], foreground=c["muted"], padding=(14, 7))
    style.map(
        "TNotebook.Tab",
        background=[("selected", c["surface_alt"])],
        foreground=[("selected", c["text"])],
    )
    root.option_add("*TCombobox*Listbox.background", c["surface"])
    root.option_add("*TCombobox*Listbox.foreground", c["text"])
    root.option_add("*TCombobox*Listbox.selectBackground", c["accent"])
    root.option_add("*TCombobox*Listbox.selectForeground", c["accent_text"])
    if isinstance(root, tk.Tk):
        root.configure(background=c["bg"])
