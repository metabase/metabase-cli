"""Moves and clicks the X server's real pointer through XTEST.

Playwright's clicks enter the page below the window system, so they never meet a drag region;
the window manager only moves a window for input that arrives the way a person's would.

    x-pointer.py drag X Y DX DY
    x-pointer.py click X Y
    x-pointer.py double-click X Y
"""

import ctypes
import sys
import time

DRAG_STEPS = 10
SETTLE_SECONDS = 0.05
BUTTON_SECONDS = 0.1
LEFT_BUTTON = 1
CURRENT_SCREEN = -1
NO_DELAY = 0

x11 = ctypes.CDLL("libX11.so.6")
xtest = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
display = x11.XOpenDisplay(None)
if not display:
    sys.exit("x-pointer: no X display; run under xvfb-run")
handle = ctypes.c_void_p(display)


def move(x, y):
    xtest.XTestFakeMotionEvent(handle, CURRENT_SCREEN, x, y, NO_DELAY)
    x11.XFlush(handle)
    time.sleep(SETTLE_SECONDS)


def button(pressed):
    xtest.XTestFakeButtonEvent(handle, LEFT_BUTTON, pressed, NO_DELAY)
    x11.XFlush(handle)
    time.sleep(BUTTON_SECONDS)


def click():
    button(True)
    button(False)


def main(action, numbers):
    if action == "drag":
        x, y, dx, dy = numbers
        move(x, y)
        button(True)
        for step in range(1, DRAG_STEPS + 1):
            move(x + dx * step // DRAG_STEPS, y + dy * step // DRAG_STEPS)
        button(False)
    elif action == "click":
        move(*numbers)
        click()
    elif action == "double-click":
        move(*numbers)
        click()
        click()
    else:
        sys.exit(f"x-pointer: unknown action {action}")
    x11.XCloseDisplay(handle)


main(sys.argv[1], [int(value) for value in sys.argv[2:]])
