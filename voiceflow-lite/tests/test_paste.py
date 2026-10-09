from __future__ import annotations

from voiceflow.paste import ClipboardPaster


class FakeClipboard:
    """Records every clipboard and keystroke call so the ordering can be asserted."""

    def __init__(self, contents: str = "previous text") -> None:
        self.contents = contents
        self.calls: list[tuple] = []
        self.scheduled: list[tuple[float, object]] = []

    def copy(self, text: str) -> None:
        self.calls.append(("copy", text))
        self.contents = text

    def read(self) -> str:
        self.calls.append(("read",))
        return self.contents

    def send(self) -> None:
        self.calls.append(("send",))

    def schedule(self, delay: float, task) -> None:
        self.scheduled.append((delay, task))


def make_paster(fake: FakeClipboard) -> ClipboardPaster:
    return ClipboardPaster(
        copy=fake.copy,
        read=fake.read,
        send_shortcut=fake.send,
        schedule=fake.schedule,
        sleep=lambda _seconds: None,
    )


def test_paste_copies_sends_and_schedules_the_restore():
    fake = FakeClipboard()
    make_paster(fake).paste("Hello world", restore_clipboard=True)
    assert fake.calls[:3] == [("read",), ("copy", "Hello world"), ("send",)]
    assert len(fake.scheduled) == 1
    delay, task = fake.scheduled[0]
    assert delay > 0
    task()
    assert fake.contents == "previous text"


def test_no_restore_when_disabled():
    fake = FakeClipboard()
    make_paster(fake).paste("Hi", restore_clipboard=False)
    assert ("read",) not in fake.calls
    assert fake.scheduled == []
    assert fake.contents == "Hi"


def test_empty_previous_clipboard_is_not_restored():
    fake = FakeClipboard(contents="")
    make_paster(fake).paste("Hi", restore_clipboard=True)
    assert fake.scheduled == []


def test_unreadable_clipboard_still_pastes():
    fake = FakeClipboard()

    def broken_read() -> str:
        raise RuntimeError("clipboard holds an image")

    paster = ClipboardPaster(
        copy=fake.copy,
        read=broken_read,
        send_shortcut=fake.send,
        schedule=fake.schedule,
        sleep=lambda _seconds: None,
    )
    paster.paste("Hi", restore_clipboard=True)
    assert ("send",) in fake.calls
    assert fake.scheduled == []


def test_copy_only_does_not_send_keys():
    fake = FakeClipboard()
    make_paster(fake).copy("text")
    assert fake.calls == [("copy", "text")]
