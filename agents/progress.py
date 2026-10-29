#!/usr/bin/env python3
"""Live progress board for an agent-team run: a PROGRESS.md checklist, an
optional health URL and the tail of the team feed, drawn as one fixed screen.

  progress.py --file PROGRESS.md [--file run/PROGRESS.md ...] --feed ~/.x-team/latest/feed.log [--health URL] [--title NAME]

Keys: up/down, j/k, mouse wheel, PgUp/PgDn, g/G scroll; q quits. Keys are
never echoed, the board lives on the alternate screen (no scrollback), and it
only redraws when the content or the window size changes.

Checklist format (PROGRESS.md):  `## Section`, `- [x] done`, `- [ ] todo`,
`- [~] in progress`, `- [!] blocked`. Anything else is ignored.
"""
import argparse, json, os, re, select, shutil, signal, sys, termios, tty, urllib.request
from pathlib import Path

O, C, D, G, RED, R = ("\x1b[38;2;249;127;58m", "\x1b[38;2;232;226;217m", "\x1b[38;2;122;114;105m",
                      "\x1b[38;2;36;32;29m", "\x1b[38;2;240;82;1m", "\x1b[0m")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
MARKS = {"x": (O + "■", D), " ": (C + "□", C), "~": (O + "◧", C), "!": (RED + "▲", C)}


def vis(s):  # printable width
    return len(ANSI.sub("", s))


def clip(s, w):
    """Cut a coloured line to w visible columns."""
    out, n, i = "", 0, 0
    while i < len(s) and n < w:
        m = ANSI.match(s, i)
        if m:
            out += m.group(); i = m.end(); continue
        out += s[i]; n += 1; i += 1
    return out + R


def wrap(prefix, text, col, w, indent):
    """prefix (coloured, first line only) + text wrapped to w columns in col."""
    lines, room = [], w - vis(prefix)
    while True:
        cut = text[:room]
        if len(text) > room and " " in cut[room // 2:]:
            cut = cut[: cut.rfind(" ")]
        lines.append((prefix if not lines else " " * indent) + col + cut + R)
        text = text[len(cut):].lstrip()
        if not text:
            return lines
        room = w - indent


def body(a, width):
    rows, done, total = [], 0, 0
    src = []
    for f in a.file or ["PROGRESS.md"]:
        try:
            src += Path(os.path.expanduser(f)).read_text().splitlines()
        except OSError:
            src += ["## no run checklist yet · " + os.path.basename(os.path.dirname(os.path.expanduser(f)))]
    items = []
    for l in src:
        m = re.match(r"^\s*- \[(.)\] (.*)", l)
        if l.startswith("## "):
            items.append(("h", l[3:].strip()))
        elif m and m.group(1).lower() in MARKS:
            k = m.group(1).lower(); total += 1; done += k == "x"
            items.append((k, m.group(2)))
    w = 30; fill = done * w // max(total, 1)
    head = f"{O}{a.title.upper()} · PROGRESS{R}   {O}{'█' * fill}{G}{'░' * (w - fill)}{R} {C}{done}/{total}{R}"
    for k, t in items:
        if k == "h":
            rows += ["", f"{O}{t}{R}"]
        else:
            mark, col = MARKS[k]
            rows += wrap(f"  {mark}{R} ", t, col, width, 4)
    rows += ["", G + "─" * width + R]
    if a.health:
        try:
            h = json.loads(urllib.request.urlopen(a.health, timeout=1).read())
            h.pop("ms", None)
            rows += wrap(f"{O}server{R} {C}up{R} ", json.dumps(h, separators=(",", ":")), D, width, 2)
        except Exception:
            rows.append(f"{O}server{R} {RED}down{R} {D}{a.health}{R}")
    if a.feed:
        rows.append(f"{O}team feed{R} {D}{a.feed}{R}")
        try:
            tail = Path(os.path.expanduser(a.feed)).read_text(errors="replace").splitlines()[-a.lines:]
        except OSError:
            tail = ["(no feed yet)"]
        rows += [D + clip(ANSI.sub("", t), width) for t in tail]
    return head, rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--file", action="append", help="checklist file (repeatable)")
    p.add_argument("--feed", default="")
    p.add_argument("--health", default="")
    p.add_argument("--title", default=Path.cwd().name)
    p.add_argument("--lines", type=int, default=8, help="feed lines to show")
    p.add_argument("--every", type=float, default=2.0)
    a = p.parse_args()

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    out = sys.stdout

    def restore(*_):
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        out.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l"); out.flush()
        sys.exit(0)

    signal.signal(signal.SIGTERM, restore); signal.signal(signal.SIGHUP, restore)
    tty.setcbreak(fd)  # no echo, no line buffering: arrow keys never print ^[[A
    new = termios.tcgetattr(fd); new[3] &= ~termios.ECHO; termios.tcsetattr(fd, termios.TCSADRAIN, new)
    # alt screen, hide cursor, SGR mouse so the wheel scrolls the board, not the terminal
    out.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h"); out.flush()

    top, prev, buf = 0, None, ""
    try:
        while True:
            cols, rowsN = shutil.get_terminal_size((100, 40))
            head, rows = body(a, cols - 1)
            view = rowsN - 3  # header, rule, footer
            top = max(0, min(top, len(rows) - view))
            shown = rows[top: top + view]
            more = f"{D}↑↓ / wheel scroll · q quit{R}"
            if len(rows) > view:
                more = f"{D}lines {top + 1}–{top + len(shown)} of {len(rows)} · ↑↓ / wheel scroll · g/G ends · q quit{R}"
            frame = [clip(head, cols - 1), G + "─" * (cols - 1) + R] + [clip(r, cols - 1) for r in shown]
            frame += [""] * (rowsN - 1 - len(frame)) + [clip(more, cols - 1)]
            screen = "\x1b[H" + "\r\n".join(f + "\x1b[K" for f in frame)
            if screen != prev:
                out.write("\x1b[H\x1b[2J" + screen); out.flush(); prev = screen
            r, _, _ = select.select([fd], [], [], a.every)
            if not r:
                continue
            buf += os.read(fd, 1024).decode(errors="ignore")
            while buf:
                step = None
                for seq, dy in (("\x1b[A", -1), ("\x1b[B", 1), ("\x1b[5~", -view), ("\x1b[6~", view),
                                ("k", -1), ("j", 1), ("g", -10**9), ("G", 10**9), (" ", view)):
                    if buf.startswith(seq):
                        step = (len(seq), dy); break
                m = re.match(r"\x1b\[<(\d+);\d+;\d+[Mm]", buf)
                if m:
                    b = int(m.group(1))
                    step = (m.end(), -3 if b == 64 else 3 if b == 65 else 0)
                if buf[0] in "qQ\x03":
                    restore()
                if step is None:
                    if buf.startswith("\x1b") and len(buf) < 8 and not buf.endswith(("~", "M", "m")) and not buf[-1].isalpha():
                        break  # partial escape sequence, wait for the rest
                    buf = buf[1:]; continue
                buf = buf[step[0]:]; top += step[1]; prev = None
    except KeyboardInterrupt:
        pass
    restore()


if __name__ == "__main__":
    main()
