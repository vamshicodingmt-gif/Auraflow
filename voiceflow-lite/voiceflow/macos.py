"""Small macOS bridge built on ctypes, so no PyObjC dependency is needed.

It is used for three things:

* remembering which app was frontmost when dictation started, so the paste lands there;
* re-activating that app just before pasting, because showing our overlay can take focus;
* reading the Microphone, Input Monitoring and Accessibility permission states.

Every function returns ``None`` or ``False`` off macOS, or when a framework is missing.
"""

from __future__ import annotations

import ctypes
import logging
import os
import sys
from typing import Any

log = logging.getLogger(__name__)

_objc_runtime: ctypes.CDLL | None = None
_frameworks: dict[str, ctypes.CDLL] = {}


def _runtime() -> ctypes.CDLL:
    global _objc_runtime
    if _objc_runtime is None:
        lib = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
        lib.objc_getClass.restype = ctypes.c_void_p
        lib.objc_getClass.argtypes = [ctypes.c_char_p]
        lib.sel_registerName.restype = ctypes.c_void_p
        lib.sel_registerName.argtypes = [ctypes.c_char_p]
        _objc_runtime = lib
    return _objc_runtime


def load_framework(name: str) -> ctypes.CDLL:
    """Load (once) a system framework such as ``AppKit`` or ``CoreGraphics``."""
    if name not in _frameworks:
        _frameworks[name] = ctypes.CDLL(f"/System/Library/Frameworks/{name}.framework/{name}")
    return _frameworks[name]


def get_class(name: str) -> int:
    return int(_runtime().objc_getClass(name.encode("ascii")) or 0)


def selector(name: str) -> int:
    return int(_runtime().sel_registerName(name.encode("ascii")) or 0)


def msg(restype: Any, *arg_types: Any) -> Any:
    """Return ``call(receiver, selector_name, *args)``, a typed wrapper around objc_msgSend."""
    prototype = ctypes.CFUNCTYPE(restype, ctypes.c_void_p, ctypes.c_void_p, *arg_types)
    sender = ctypes.cast(_runtime().objc_msgSend, prototype)

    def call(receiver: Any, selector_name: str, *args: Any) -> Any:
        return sender(receiver, selector(selector_name), *args)

    return call


def frontmost_pid() -> int | None:
    """PID of the frontmost app, or None if it is ours (or unknown)."""
    if sys.platform != "darwin":
        return None
    try:
        load_framework("AppKit")
        workspace = msg(ctypes.c_void_p)(get_class("NSWorkspace"), "sharedWorkspace")
        app = msg(ctypes.c_void_p)(workspace, "frontmostApplication")
        if not app:
            return None
        pid = int(msg(ctypes.c_int32)(app, "processIdentifier"))
    except Exception:
        log.debug("Could not read the frontmost application", exc_info=True)
        return None
    return None if pid == os.getpid() else pid


def activate_pid(pid: int | None) -> bool:
    """Bring the app with this PID to the front. Returns True when AppKit accepted the request."""
    if sys.platform != "darwin" or not pid:
        return False
    try:
        load_framework("AppKit")
        app = msg(ctypes.c_void_p, ctypes.c_int32)(
            get_class("NSRunningApplication"),
            "runningApplicationWithProcessIdentifier:",
            pid,
        )
        if not app:
            return False
        activate_ignoring_other_apps = 1 << 1
        accepted = msg(ctypes.c_bool, ctypes.c_uint64)(app, "activateWithOptions:", activate_ignoring_other_apps)
        return bool(accepted)
    except Exception:
        log.debug("Could not re-activate application %s", pid, exc_info=True)
        return False


def microphone_status() -> int | None:
    """AVAuthorizationStatus for audio: 0 not determined, 1 restricted, 2 denied, 3 authorized."""
    if sys.platform != "darwin":
        return None
    try:
        framework = load_framework("AVFoundation")
        media_type = ctypes.c_void_p.in_dll(framework, "AVMediaTypeAudio").value
        call = msg(ctypes.c_long, ctypes.c_void_p)
        return int(call(get_class("AVCaptureDevice"), "authorizationStatusForMediaType:", media_type))
    except Exception:
        log.debug("Could not read microphone authorization", exc_info=True)
        return None


def input_monitoring_granted() -> bool | None:
    if sys.platform != "darwin":
        return None
    try:
        function = load_framework("CoreGraphics").CGPreflightListenEventAccess
    except (OSError, AttributeError):
        return None
    function.restype = ctypes.c_bool
    function.argtypes = []
    return bool(function())


def accessibility_granted() -> bool | None:
    if sys.platform != "darwin":
        return None
    try:
        function = load_framework("ApplicationServices").AXIsProcessTrusted
    except (OSError, AttributeError):
        return None
    function.restype = ctypes.c_bool
    function.argtypes = []
    return bool(function())
