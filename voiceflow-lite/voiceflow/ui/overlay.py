"""Floating recording indicator: a small dark pill with a live waveform.

The overlay is a borderless, always-on-top Tk window that never takes keyboard
focus, so the app you are dictating into keeps the cursor. On Windows it is also
marked WS_EX_NOACTIVATE, so showing it cannot steal focus.
"""

from __future__ import annotations

import logging
import math
import sys
import time
import tkinter as tk
from collections.abc import Sequence

from .theme import COLORS, ui_family

log = logging.getLogger(__name__)
KEY_COLOR = "#010203"  # Windows: pixels of this exact colour become transparent


def _mix(first: str, second: str, weight: float) -> str:
    """Blend two #rrggbb colours. ``weight`` is the share taken from ``first``."""
    amount = max(0.0, min(1.0, weight))
    a = [int(first[i : i + 2], 16) for i in (1, 3, 5)]
    b = [int(second[i : i + 2], 16) for i in (1, 3, 5)]
    channels = [round(x * amount + y * (1.0 - amount)) for x, y in zip(a, b, strict=True)]
    return "#{:02x}{:02x}{:02x}".format(*channels)


def _show_without_activation(window: tk.Toplevel) -> None:
    """Windows only: mark the overlay WS_EX_NOACTIVATE and show it without activating it."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        user32 = ctypes.windll.user32
        window.update_idletasks()
        child = window.winfo_id()
        hwnd = user32.GetParent(child) or child
        get_style = getattr(user32, "GetWindowLongPtrW", None) or user32.GetWindowLongW
        set_style = getattr(user32, "SetWindowLongPtrW", None) or user32.SetWindowLongW
        get_style.restype = ctypes.c_ssize_t
        get_style.argtypes = [ctypes.c_void_p, ctypes.c_int]
        set_style.restype = ctypes.c_ssize_t
        set_style.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
        gwl_exstyle = -20
        ws_ex_noactivate = 0x08000000
        ws_ex_toolwindow = 0x00000080
        sw_shownoactivate = 4
        style = get_style(hwnd, gwl_exstyle)
        set_style(hwnd, gwl_exstyle, style | ws_ex_noactivate | ws_ex_toolwindow)
        user32.ShowWindow(hwnd, sw_shownoactivate)
    except Exception:  # cosmetic safeguard; the overlay still works without it
        log.debug("Could not make the overlay non-activating", exc_info=True)


class Overlay:
    WIDTH = 304
    HEIGHT = 58
    BARS = 24
    BAR_WIDTH = 3
    BAR_STEP = 5
    BOTTOM_MARGIN = 120

    def __init__(self, root: tk.Tk) -> None:
        self._root = root
        self._enabled = True
        self._visible = False
        self._mode = "hidden"  # hidden | recording | processing | result
        self._kind = "ok"  # result colour: ok | error | muted
        self._text = ""
        self._until = 0.0
        self._flash_text = ""
        self._flash_until = 0.0
        self._phase = 0.0

        background = KEY_COLOR if sys.platform == "win32" else COLORS["bg"]
        self._win = tk.Toplevel(root)
        self._win.withdraw()
        self._win.overrideredirect(True)
        self._win.attributes("-topmost", True)
        self._win.configure(background=background)
        if sys.platform == "win32":
            self._win.attributes("-transparentcolor", KEY_COLOR)
        self._canvas = tk.Canvas(
            self._win,
            width=self.WIDTH,
            height=self.HEIGHT,
            background=background,
            highlightthickness=0,
            borderwidth=0,
        )
        self._canvas.pack()
        self._draw_pill()
        centre = self.HEIGHT / 2
        self._dot = self._canvas.create_oval(16, centre - 5, 26, centre + 5, fill=COLORS["record"], outline="")
        self._label = self._canvas.create_text(
            40,
            centre,
            anchor="w",
            fill=COLORS["text"],
            font=(ui_family(), 11, "bold"),
            text="",
        )
        self._bars = [
            self._canvas.create_rectangle(0, 0, 0, 0, fill=COLORS["record"], outline="")
            for _ in range(self.BARS)
        ]

    def _draw_pill(self) -> None:
        fill = COLORS["surface"]
        border = COLORS["border"]
        radius = self.HEIGHT / 2
        canvas = self._canvas
        canvas.create_oval(0, 0, self.HEIGHT, self.HEIGHT, fill=fill, outline=border)
        canvas.create_oval(self.WIDTH - self.HEIGHT, 0, self.WIDTH, self.HEIGHT, fill=fill, outline=border)
        canvas.create_rectangle(radius, 0, self.WIDTH - radius, self.HEIGHT, fill=fill, outline="")
        canvas.create_line(radius, 0.5, self.WIDTH - radius, 0.5, fill=border)
        canvas.create_line(radius, self.HEIGHT - 0.5, self.WIDTH - radius, self.HEIGHT - 0.5, fill=border)

    # ----- public API ------------------------------------------------------------------------
    def set_enabled(self, enabled: bool) -> None:
        self._enabled = enabled
        if not enabled:
            self.hide()

    def show_recording(self, text: str = "Listening…") -> None:
        self._set_mode("recording", text, until=0.0)

    def show_processing(self, text: str = "Transcribing…") -> None:
        self._set_mode("processing", text, until=0.0)

    def set_text(self, text: str) -> None:
        self._text = text

    def show_result(self, text: str, *, kind: str = "ok", linger: float = 1.3) -> None:
        self._kind = kind
        self._set_mode("result", text, until=time.monotonic() + linger)

    def flash(self, text: str, linger: float = 1.4) -> None:
        """Show a short note over the current label, then return to it."""
        self._flash_text = text
        self._flash_until = time.monotonic() + linger

    def hide(self) -> None:
        self._mode = "hidden"
        if self._visible:
            self._win.withdraw()
            self._visible = False

    def tick(self, levels: Sequence[float] | None = None) -> None:
        """Called about every 30 ms from the Tk loop to animate the bars and expire results."""
        self._phase += 0.3
        now = time.monotonic()
        if self._mode == "result" and now >= self._until:
            self.hide()
            return
        if not self._visible:
            return
        text = self._flash_text if now < self._flash_until else self._text
        dot, bar_colour, heights = self._render(levels)
        self._canvas.itemconfigure(self._label, text=text)
        self._canvas.itemconfigure(self._dot, fill=dot)
        centre = self.HEIGHT / 2
        origin = self.WIDTH - 20 - self.BARS * self.BAR_STEP
        for index, item in enumerate(self._bars):
            height = heights[index]
            left = origin + index * self.BAR_STEP
            self._canvas.coords(item, left, centre - height / 2, left + self.BAR_WIDTH, centre + height / 2)
            self._canvas.itemconfigure(item, fill=bar_colour)

    # ----- internals -------------------------------------------------------------------------
    def _set_mode(self, mode: str, text: str, *, until: float) -> None:
        self._mode = mode
        self._text = text
        self._until = until
        if self._enabled:
            self._reveal()

    def _reveal(self) -> None:
        if self._visible:
            return
        screen_width = self._root.winfo_screenwidth()
        screen_height = self._root.winfo_screenheight()
        x = max(0, (screen_width - self.WIDTH) // 2)
        y = max(0, screen_height - self.HEIGHT - self.BOTTOM_MARGIN)
        self._win.geometry(f"{self.WIDTH}x{self.HEIGHT}+{x}+{y}")
        self._win.deiconify()
        _show_without_activation(self._win)
        self._visible = True

    def _render(self, levels: Sequence[float] | None) -> tuple[str, str, list[float]]:
        """Return (dot colour, bar colour, bar heights in pixels) for the current mode."""
        max_height = self.HEIGHT - 18.0
        if self._mode == "recording":
            values = list(levels or [])[-self.BARS :]
            values = [0.0] * (self.BARS - len(values)) + values
            heights = [max(3.0, min(1.0, value) * max_height) for value in values]
            pulse = 0.65 + 0.35 * math.sin(self._phase * 1.6)
            return _mix(COLORS["record"], COLORS["surface"], pulse), COLORS["record"], heights
        if self._mode == "processing":
            heights = [
                max(3.0, (0.22 + 0.18 * math.sin(self._phase + index * 0.6)) * max_height)
                for index in range(self.BARS)
            ]
            pulse = 0.5 + 0.5 * math.sin(self._phase * 2.0)
            dot = _mix(COLORS["processing"], COLORS["surface"], 0.35 + 0.65 * pulse)
            return dot, COLORS["accent"], heights
        colour = {"ok": COLORS["ok"], "error": COLORS["error"]}.get(self._kind, COLORS["muted"])
        flat = [max(3.0, 0.3 * max_height)] * self.BARS
        return colour, colour, flat
