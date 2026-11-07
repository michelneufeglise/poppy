"""Cut female Poppy out of her two sheets (same method as cut_sheet2.py; nothing is redrawn).

- docs/design/emotions-sheet-female.jpg: 36 states, 6x6. The cell labelled "SLEEPING / SNEAKY"
  shows her asleep, so it's "sleeping" (sheet 2 has its own "SNEAKY").
  The second "WONDER" in the last row (arms crossed, a huff) is "sighing". The drawing labelled
  "LAUGHING" is a blush, so it's "shy" (with the "SHY" lettering); the drawing above "SHY" isn't used.
- docs/design/emotions-sheet-female-2.jpg: the 12 states the first sheet doesn't have (curious, tired,
  focused, crying, determined, proud, hello, hungry, sneaky, grumpy, playful, dreamy) and a real
  laugh for "laughing", all from rows 1-4. The other cells repeat states the first sheet already has,
  or are a drawing of the word "missing"; they're skipped.

The second sheet draws her at another size, so it's scaled to match the first using poses that are on
both (sad, defiant, waving bye). Her name tags are scaled to the same letter height. "sighing" has no
lettering on her sheets, so it uses the male sheet's.

Output: assets/female/states/<state>.png and assets/female/chat/label-<state>.png, her menu-bar icon
(assets/female/tray/, from her idle silhouette like the male one), and assets/female/chat/header.png:
the chat picture's header with her listening drawing peeking over the pencil line where his is.
Run: cd scripts && python3 cut_sheet_female.py
"""
import shutil
from pathlib import Path

import cv2
import numpy as np

from cut_chat import ink_layer
from cut_sheet import tray_icons
from cut_sheet2 import ZOOM, cut_grid, cut_label, ink_mask

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "docs/design"
STATES = ROOT / "assets/female/states"
LABELS = ROOT / "assets/female/chat"
LABEL_SCALE = 0.75  # the first sheet's lettering, same as the male second sheet

SHEET1 = DESIGN / "emotions-sheet-female.jpg"
NAMES1 = [
    ["idle", "listening", "thinking", "talking", "happy", "sad"],
    ["surprised", "shy", None, "sleeping", "bored", "angry"],
    ["scared", "excited", "disgusted", "confused", "cheerful", "frustrated"],
    ["sick", "shocked", "anxious", "clapping", "doubtful", "lazy"],
    ["sad-hello", "bye", "cuddly", "thirsty", "busy", "spooked"],
    ["nervous", "hopeful", "chilling", "wonder", "sighing", "defiant"],
]
ROWS1 = [(143, 482, 532), (536, 878, 930), (936, 1284, 1336), (1340, 1686, 1781), (1781, 2084, 2178), (2177, 2454, 2510)]
SLEEPING_LABEL_TOP = 826  # "SLEEPING" is lettered inside the drawing band, above "SNEAKY"
BYE_LABEL = (340, 2084, 615, 2178)  # leaves out a wave line of the sad hello next to it

SHEET2 = DESIGN / "emotions-sheet-female-2.jpg"
# Only rows 1-4 are used: rows 5-7 are smaller copies of the first sheet's drawings.
NAMES2 = [
    [None, "curious", None, "tired", "focused", None],
    ["crying", None, "determined", None, "proud", None],
    ["hello", None, "hungry", None, "sneaky", None],
    ["grumpy", None, "playful", "laughing", "dreamy", None],
]
ROWS2 = [(170, 508, 565), (598, 910, 960), (975, 1300, 1350), (1350, 1640, 1690)]
# Poses drawn on both sheets, to scale sheet 2 to sheet 1: {sheet-2 cell: name}.
CRYING_TOP = 615  # the descenders of "(or MissingUses)" above crying aren't part of her
DETERMINED_LABEL = (600, 910, 918, 960)  # "DETERMINED" is wider than its column
SHARED = {(1, 1): "sad", (1, 3): "defiant", (2, 1): "bye"}

def with_reference(names: list[list[str | None]], cell: tuple[int, int], name: str) -> list[list[str | None]]:
    out = [row[:] for row in names]
    out[cell[0]][cell[1]] = name
    return out


def label_height(img: np.ndarray, rows, names, name: str) -> int:
    """Raw letter height of one name, to scale the other sheets' lettering to the first's."""
    paper = np.median(img.reshape(-1, 3), axis=0).astype(np.float32)
    letters = ink_layer(img, paper)
    r = next(i for i, row in enumerate(names) if name in row)
    c = names[r].index(name)
    top, bottom, label_bottom = rows[r]
    w = img.shape[1]
    n = len(names[0])
    return cut_label(letters, int(c * w / n), bottom, int((c + 1) * w / n), label_bottom, 1.0).shape[0]


# The male doodle in assets/chat/header.png: everything left of the title and above the pencil line.
HEADER_DOODLE = (10, 0, 200, 153)  # x0, y0, x1, y1
HEADER_LINE_Y = 156  # where her drawing rests (behind the line)
HEADER_HEAD_PART = 0.6  # how much of her listening drawing shows above the line (head and hand)
HEADER_WIDTH = 185


def female_header() -> None:
    header = cv2.imread(str(ROOT / "assets/chat/header.png"), cv2.IMREAD_UNCHANGED)
    x0, y0, x1, y1 = HEADER_DOODLE
    line = header[HEADER_LINE_Y - 3 : HEADER_LINE_Y + 6, x0:x1].copy()
    header[y0:y1, x0:x1, 3] = 0
    her = cv2.imread(str(STATES / "listening.png"), cv2.IMREAD_UNCHANGED)
    ys, xs = np.where(her[:, :, 3] > 0)
    her = her[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    her = her[: round(her.shape[0] * HEADER_HEAD_PART)]
    scale = HEADER_WIDTH / her.shape[1]
    her = cv2.resize(her, (HEADER_WIDTH, round(her.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    hh, hw = her.shape[:2]
    oy, ox = max(0, HEADER_LINE_Y - hh), x0 + (x1 - x0 - hw) // 2
    her = her[hh - (HEADER_LINE_Y - oy) :]
    region = header[oy:HEADER_LINE_Y, ox : ox + hw].astype(np.float32)
    a = her[:, :, 3:4].astype(np.float32) / 255
    region[:, :, :3] = her[:, :, :3] * a + region[:, :, :3] * (1 - a)
    region[:, :, 3:4] = np.maximum(region[:, :, 3:4], her[:, :, 3:4])
    header[oy:HEADER_LINE_Y, ox : ox + hw] = region.astype(np.uint8)
    # The pencil line stays on top, so she peeks over it like he does.
    keep = line[:, :, 3:4].astype(np.float32) / 255
    under = header[HEADER_LINE_Y - 3 : HEADER_LINE_Y + 6, x0:x1].astype(np.float32)
    header[HEADER_LINE_Y - 3 : HEADER_LINE_Y + 6, x0:x1] = (line * keep + under * (1 - keep)).astype(np.uint8)
    cv2.imwrite(str(LABELS / "header.png"), header)
    print("saved header")


def main() -> None:
    sheet1 = cv2.imread(str(SHEET1))
    sheet2 = cv2.imread(str(SHEET2))

    # Sizes: sheet 2 scaled so the poses that are on both sheets match sheet 1 (on average).
    h1 = cut_grid(sheet1, NAMES1, ROWS1, ZOOM, STATES, LABELS, label_above={(1, 3): SLEEPING_LABEL_TOP}, dry=True)
    names = NAMES2
    for cell, name in SHARED.items():
        names = with_reference(names, cell, name)
    h2 = cut_grid(sheet2, names, ROWS2, 1, STATES, LABELS, cell_top={(1, 0): CRYING_TOP}, dry=True)
    zoom2 = ZOOM * float(np.mean([h1[n] / h2[n] for n in SHARED.values()]))
    target = label_height(sheet1, ROWS1, NAMES1, "idle") * LABEL_SCALE
    scale2 = target / label_height(sheet2, ROWS2, NAMES2, "curious")
    print(f"zoom: sheet 1 {ZOOM:.2f}, sheet 2 {zoom2:.2f}; labels {LABEL_SCALE:.2f}, {scale2:.2f}")

    cut_grid(
        sheet1, NAMES1, ROWS1, ZOOM, STATES, LABELS,
        label_above={(1, 3): SLEEPING_LABEL_TOP}, extra_labels={(1, 2): "shy"}, label_boxes={"bye": BYE_LABEL}, no_label=("shy",),
    )
    cut_grid(
        sheet2, NAMES2, ROWS2, zoom2, STATES, LABELS,
        label_scale=scale2, cell_top={(1, 0): CRYING_TOP}, label_boxes={"determined": DETERMINED_LABEL},
    )
    shutil.copyfile(ROOT / "assets/chat/label-sighing.png", LABELS / "label-sighing.png")
    print("saved sighing label (from the male sheet)")
    tray_icons(STATES / "idle.png", ROOT / "assets/female/tray")
    print("saved tray icons")
    female_header()

if __name__ == "__main__":
    main()
