"""Settings dialog: hotkey, microphone, cleanup, personal dictionary and API key."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import TYPE_CHECKING

from .. import APP_NAME
from ..audio import list_input_devices
from ..config import (
    CLEANUP_STYLES,
    DEFAULT_CLEANUP_MODEL,
    HOTKEY_MODES,
    MAX_DICTIONARY_ENTRIES,
    RECORDING_LIMIT_CHOICES,
    Settings,
    is_valid_language,
    is_valid_model,
    is_valid_trigger,
)
from ..keys import TRIGGER_CHOICES, key_from_text, key_label
from ..keystore import (
    KeystoreError,
    is_plausible_key,
    keychain_available,
    keychain_forget,
    keychain_store,
    resolve_gemini_key,
)
from .theme import COLORS, mono_family

if TYPE_CHECKING:
    from ..app import Controller

SYSTEM_DEFAULT_MIC = "System default"
CAPTURE_TIMEOUT_MS = 8000
LIMIT_LABELS = {60: "1 minute", 120: "2 minutes", 300: "5 minutes"}
STYLE_HELP = {
    "casual": "Keeps your wording. Fillers and false starts go; nothing else changes.",
    "balanced": "Clean, natural prose that still sounds like you. Recommended.",
    "polished": "Concise, professional phrasing for email and documents.",
    "code": "For developer work: identifiers, file names and symbols are kept exact.",
}


def _nearest_limit(seconds: int) -> int:
    return min(RECORDING_LIMIT_CHOICES, key=lambda choice: abs(choice - seconds))


def _safe_devices() -> list[str]:
    try:
        return list_input_devices()
    except Exception:  # PortAudio missing or no audio backend available
        return []


class SettingsWindow:
    def __init__(self, root: tk.Tk, controller: Controller) -> None:
        self._ctl = controller
        settings = controller.settings
        self._capturing = False
        self._capture_job: str | None = None

        self._win = tk.Toplevel(root)
        self._win.title(f"{APP_NAME} · Settings")
        self._win.geometry("680x640")
        self._win.minsize(620, 580)
        self._win.configure(background=COLORS["bg"])
        self._win.transient(root)
        self._win.protocol("WM_DELETE_WINDOW", self.close)

        self._hotkey_mode = tk.StringVar(value=settings.hotkey_mode)
        self._trigger = tk.StringVar(value=key_label(settings.trigger_key))
        self._mic = tk.StringVar(value=settings.input_device or SYSTEM_DEFAULT_MIC)
        self._auto_paste = tk.BooleanVar(value=settings.auto_paste)
        self._restore = tk.BooleanVar(value=settings.restore_clipboard)
        self._show_overlay = tk.BooleanVar(value=settings.show_overlay)
        self._limit = tk.StringVar(value=LIMIT_LABELS[_nearest_limit(settings.max_recording_seconds)])
        self._cleanup_on = tk.BooleanVar(value=settings.cleanup_enabled)
        self._style = tk.StringVar(value=settings.cleanup_style)
        self._transcribe_model = tk.StringVar(value=settings.transcribe_model)
        self._cleanup_model = tk.StringVar(value=settings.cleanup_model)
        self._language = tk.StringVar(value=settings.language)
        self._api_key = tk.StringVar(value="")
        self._key_status = tk.StringVar(value="")
        self._error = tk.StringVar(value="")

        notebook = ttk.Notebook(self._win)
        notebook.pack(fill="both", expand=True, padx=16, pady=(16, 8))
        general = ttk.Frame(notebook, padding=18, style="App.TFrame")
        cleanup = ttk.Frame(notebook, padding=18, style="App.TFrame")
        dictionary = ttk.Frame(notebook, padding=18, style="App.TFrame")
        key_tab = ttk.Frame(notebook, padding=18, style="App.TFrame")
        notebook.add(general, text="Hotkey & audio")
        notebook.add(cleanup, text="Cleanup")
        notebook.add(dictionary, text="Dictionary")
        notebook.add(key_tab, text="API key")
        self._build_general(general)
        self._build_cleanup(cleanup)
        self._build_dictionary(dictionary, settings.dictionary)
        self._build_key(key_tab)

        footer = ttk.Frame(self._win, style="App.TFrame", padding=(16, 0, 16, 16))
        footer.pack(fill="x")
        ttk.Label(footer, textvariable=self._error, style="Error.TLabel", wraplength=420).pack(side="left")
        ttk.Button(footer, text="Cancel", command=self.close).pack(side="right")
        ttk.Button(footer, text="Save", style="Accent.TButton", command=self._save).pack(
            side="right", padx=(0, 8)
        )
        self._refresh_key_status()

    # ----- layout ----------------------------------------------------------------------------
    def _build_general(self, frame: ttk.Frame) -> None:
        ttk.Label(frame, text="Hotkey", style="Section.TLabel").pack(anchor="w")
        for value, label in HOTKEY_MODES.items():
            ttk.Radiobutton(frame, text=label, value=value, variable=self._hotkey_mode).pack(
                anchor="w", pady=(4, 0)
            )
        row = ttk.Frame(frame, style="App.TFrame")
        row.pack(anchor="w", pady=(8, 0))
        ttk.Label(row, text="Key").pack(side="left")
        ttk.Combobox(
            row,
            textvariable=self._trigger,
            values=[label for label, _ in TRIGGER_CHOICES],
            width=24,
        ).pack(side="left", padx=(8, 8))
        self._record_btn = ttk.Button(row, text="Record key", command=self._start_capture)
        self._record_btn.pack(side="left")
        ttk.Label(
            frame,
            text="Hold mode works best with a key you rarely use in shortcuts, such as Right Option or F8.",
            style="Muted.TLabel",
            wraplength=600,
            justify="left",
        ).pack(anchor="w", pady=(6, 0))

        ttk.Label(frame, text="Microphone", style="Section.TLabel").pack(anchor="w", pady=(18, 0))
        devices = [SYSTEM_DEFAULT_MIC, *_safe_devices()]
        ttk.Combobox(frame, textvariable=self._mic, values=devices, state="readonly", width=56).pack(
            anchor="w", pady=(6, 0)
        )

        ttk.Label(frame, text="Output", style="Section.TLabel").pack(anchor="w", pady=(18, 0))
        ttk.Checkbutton(
            frame, text="Paste automatically into the focused app", variable=self._auto_paste
        ).pack(anchor="w", pady=(6, 0))
        ttk.Checkbutton(
            frame, text="Restore my clipboard after pasting (text only)", variable=self._restore
        ).pack(anchor="w", pady=(2, 0))
        ttk.Checkbutton(
            frame, text="Show the floating recording indicator", variable=self._show_overlay
        ).pack(anchor="w", pady=(2, 0))

        limit_row = ttk.Frame(frame, style="App.TFrame")
        limit_row.pack(anchor="w", pady=(14, 0))
        ttk.Label(limit_row, text="Longest recording").pack(side="left")
        ttk.Combobox(
            limit_row,
            textvariable=self._limit,
            values=[LIMIT_LABELS[choice] for choice in RECORDING_LIMIT_CHOICES],
            state="readonly",
            width=12,
        ).pack(side="left", padx=(8, 0))

    def _build_cleanup(self, frame: ttk.Frame) -> None:
        ttk.Checkbutton(
            frame,
            text="Clean up transcripts with Gemini (fillers, grammar, punctuation)",
            variable=self._cleanup_on,
        ).pack(anchor="w")
        ttk.Label(frame, text="Cleanup style", style="Section.TLabel").pack(anchor="w", pady=(16, 0))
        for value, label in CLEANUP_STYLES.items():
            ttk.Radiobutton(frame, text=label, value=value, variable=self._style).pack(anchor="w", pady=(6, 0))
            ttk.Label(
                frame,
                text=STYLE_HELP[value],
                style="Muted.TLabel",
                wraplength=600,
                justify="left",
            ).pack(anchor="w", padx=(26, 0))

        ttk.Label(frame, text="Models and language", style="Section.TLabel").pack(anchor="w", pady=(18, 0))
        grid = ttk.Frame(frame, style="App.TFrame")
        grid.pack(anchor="w", pady=(6, 0))
        fields = (
            ("Transcription model", self._transcribe_model),
            ("Cleanup model", self._cleanup_model),
            ("Language", self._language),
        )
        for row_index, (label, variable) in enumerate(fields):
            ttk.Label(grid, text=label).grid(row=row_index, column=0, sticky="w", pady=3)
            ttk.Entry(grid, textvariable=variable, width=34).grid(
                row=row_index, column=1, sticky="w", padx=(12, 0), pady=3
            )
        ttk.Label(
            frame,
            text=(
                "Language is 'auto' or a tag such as en-US. Defaults: gemini-3.5-transcribe "
                "and gemini-3.5-flash-lite."
            ),
            style="Muted.TLabel",
            wraplength=600,
            justify="left",
        ).pack(anchor="w", pady=(8, 0))

    def _build_dictionary(self, frame: ttk.Frame, terms: list[str]) -> None:
        ttk.Label(frame, text="Personal dictionary", style="Section.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text=(
                f"One term per line, up to {MAX_DICTIONARY_ENTRIES}. Names, product words and jargon "
                "are passed to transcription and kept exact during cleanup."
            ),
            style="Muted.TLabel",
            wraplength=600,
            justify="left",
        ).pack(anchor="w", pady=(4, 10))
        self._dictionary = tk.Text(
            frame,
            height=14,
            wrap="word",
            background=COLORS["surface"],
            foreground=COLORS["text"],
            insertbackground=COLORS["text"],
            relief="flat",
            padx=10,
            pady=8,
            font=(mono_family(), 11),
            highlightthickness=1,
            highlightbackground=COLORS["border"],
            highlightcolor=COLORS["accent"],
        )
        self._dictionary.pack(fill="both", expand=True)
        self._dictionary.insert("1.0", "\n".join(terms))

    def _build_key(self, frame: ttk.Frame) -> None:
        ttk.Label(frame, text="Gemini API key", style="Section.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text=(
                "Paste a key and press Save to store it in your system keychain (macOS Keychain or "
                "Windows Credential Manager). You can also set GEMINI_API_KEY or use a .env file."
            ),
            style="Muted.TLabel",
            wraplength=600,
            justify="left",
        ).pack(anchor="w", pady=(4, 10))
        ttk.Entry(frame, textvariable=self._api_key, show="•", width=60).pack(anchor="w")
        buttons = ttk.Frame(frame, style="App.TFrame")
        buttons.pack(anchor="w", pady=(10, 0))
        ttk.Button(buttons, text="Test connection", command=self._test).pack(side="left")
        ttk.Button(buttons, text="Forget saved key", command=self._forget).pack(side="left", padx=(8, 0))
        ttk.Label(
            frame,
            textvariable=self._key_status,
            style="Muted.TLabel",
            wraplength=600,
            justify="left",
        ).pack(anchor="w", pady=(14, 0))

    # ----- hotkey capture --------------------------------------------------------------------
    def _start_capture(self) -> None:
        if self._capturing:
            return
        self._capturing = True
        self._record_btn.configure(text="Press a key…", state="disabled")
        self._ctl.capture_trigger(self._on_captured)
        self._capture_job = self._win.after(CAPTURE_TIMEOUT_MS, self._stop_capture)

    def _on_captured(self, name: str) -> None:
        if not self._capturing:
            return
        self._trigger.set(key_label(name))
        self._stop_capture()

    def _stop_capture(self) -> None:
        if not self._capturing:
            return
        self._capturing = False
        self._ctl.cancel_capture()
        if self._capture_job is not None:
            try:
                self._win.after_cancel(self._capture_job)
            except tk.TclError:
                pass
            self._capture_job = None
        try:
            self._record_btn.configure(text="Record key", state="normal")
        except tk.TclError:
            pass

    # ----- saving ----------------------------------------------------------------------------
    def _collect(self) -> Settings:
        trigger = key_from_text(self._trigger.get())
        if not is_valid_trigger(trigger):
            raise ValueError("That hotkey is not recognised. Use Record key to capture it instead.")
        transcribe_model = self._transcribe_model.get().strip()
        cleanup_model = self._cleanup_model.get().strip()
        language = self._language.get().strip() or "auto"
        if not is_valid_model(transcribe_model) or not is_valid_model(cleanup_model):
            raise ValueError("Model names look wrong. Examples: gemini-3.5-transcribe, gemini-3.5-flash-lite.")
        if not is_valid_language(language):
            raise ValueError("Language must be 'auto' or a tag such as en-US.")
        microphone = self._mic.get()
        return Settings.from_dict(
            {
                "hotkey_mode": self._hotkey_mode.get(),
                "trigger_key": trigger,
                "input_device": "" if microphone == SYSTEM_DEFAULT_MIC else microphone,
                "cleanup_enabled": self._cleanup_on.get(),
                "cleanup_style": self._style.get(),
                "transcribe_model": transcribe_model,
                "cleanup_model": cleanup_model,
                "language": language,
                "auto_paste": self._auto_paste.get(),
                "restore_clipboard": self._restore.get(),
                "show_overlay": self._show_overlay.get(),
                "max_recording_seconds": self._limit_seconds(),
                "dictionary": self._dictionary.get("1.0", "end").splitlines(),
            }
        )

    def _limit_seconds(self) -> int:
        for seconds in RECORDING_LIMIT_CHOICES:
            if LIMIT_LABELS[seconds] == self._limit.get():
                return seconds
        return 120

    def _save(self) -> None:
        try:
            new_settings = self._collect()
        except ValueError as exc:
            self._error.set(str(exc))
            return
        typed_key = self._api_key.get().strip()
        if typed_key:
            if not is_plausible_key(typed_key):
                self._error.set("That does not look like a Gemini API key.")
                return
            try:
                keychain_store(typed_key)
            except KeystoreError as exc:
                self._error.set(f"{exc} You can set GEMINI_API_KEY or add the key to .env instead.")
                return
        self._ctl.apply_settings(new_settings)
        self.close()

    # ----- API key ---------------------------------------------------------------------------
    def _refresh_key_status(self) -> None:
        info = resolve_gemini_key()
        text = f"Current key: {info.masked()} (from {info.describe()})." if info.present else "No key found yet."
        if not keychain_available():
            text += " The system keychain is unavailable here, so use GEMINI_API_KEY or a .env file."
        self._key_status.set(text)

    def _test(self) -> None:
        key = self._api_key.get().strip() or resolve_gemini_key().key
        if not key:
            self._key_status.set("Enter a key first, or set GEMINI_API_KEY or a .env file.")
            return
        model = self._cleanup_model.get().strip() or DEFAULT_CLEANUP_MODEL
        self._key_status.set("Testing the connection…")
        self._ctl.test_connection(key, model, self._on_test_result)

    def _on_test_result(self, message: str, ok: bool) -> None:
        if not self.exists():
            return
        prefix = "✓ " if ok else "✗ "
        self._key_status.set(prefix + message)

    def _forget(self) -> None:
        keychain_forget()
        self._api_key.set("")
        self._refresh_key_status()

    # ----- window management -----------------------------------------------------------------
    def exists(self) -> bool:
        try:
            return bool(self._win.winfo_exists())
        except tk.TclError:
            return False

    def focus(self) -> None:
        self._win.deiconify()
        self._win.lift()
        self._win.focus_force()

    def close(self) -> None:
        if self._capturing:
            self._stop_capture()
        if self.exists():
            self._win.destroy()
