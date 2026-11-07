"""Cut female Poppy out of her three sheets (same method as cut_sheet2.py; nothing is redrawn).

- docs/design/emotions-sheet-female.jpg: 36 states, 6x6. The cell labelled "SLEEPING / SNEAKY"
  shows her asleep, so it's "sleeping" (its "SNEAKY" lettering names the sneaky drawing below).
  The second "WONDER" in the last row (arms crossed, a huff) is "sighing".
- docs/design/emotions-sheet-female-2.jpg: curious, tired, focused and crying (4x2). The other cells
  repeat states the first sheet already has, or are a drawing of the word "missing"; they're skipped.
- docs/design/emotions-sheet-female-3.png: determined, proud, hello, hungry, sneaky, grumpy, playful
  and dreamy (4x3). It's a screenshot: its round download button and dark bottom edge are painted
  over in memory before cutting. Its "PROUD (CLAPPING)" cell shows her proud with arms crossed, so
  only the word "PROUD" is used; its "CHEERFUL" smirk is "sneaky".

Each sheet draws her at another size, so the second and third are scaled to match the first, using a
pose that's on both (sad, and waving bye). Her name tags are scaled to the same letter height.
"sighing" has no lettering on her sheets, so it uses the male sheet's.

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
    ["surprised", "laughing", "shy", "sleeping", "bored", "angry"],
    ["scared", "excited", "disgusted", "confused", "cheerful", "frustrated"],
    ["sick", "shocked", "anxious", "clapping", "doubtful", "lazy"],
    ["sad-hello", "bye", "cuddly", "thirsty", "busy", "spooked"],
    ["nervous", "hopeful", "chilling", "wonder", "sighing", "defiant"],
]
ROWS1 = [(143, 482, 532), (536, 878, 930), (936, 1284, 1336), (1340, 1686, 1781), (1781, 2084, 2178), (2177, 2454, 2510)]
SLEEPING_LABEL_TOP = 826  # "SLEEPING" is lettered inside the drawing band, above "SNEAKY"
BYE_LABEL = (340, 2084, 615, 2178)  # leaves out a wave line of the sad hello next to it

SHEET2 = DESIGN / "emotions-sheet-female-2.jpg"
NAMES2 = [[None, "curious", None, "tired"], ["focused", None, "crying", None]]
ROWS2 = [(188, 914, 990), (992, 1668, 1748)]
FOCUSED_TOP = 1062  # "(or MissingUses)" from the cell above reaches into focused's column

SHEET3 = DESIGN / "emotions-sheet-female-3.png"
NAMES3 = [["determined", "proud", "hello", None], ["hungry", None, "sneaky", "grumpy"], [None, "playful", None, "dreamy"]]
ROWS3 = [(14, 393, 436), (438, 796, 834), (836, 1164, 1204)]
PROUD_WORD = (400, 388, 552, 436)  # just "PROUD" of "PROUD (CLAPPING)"
BUTTON = ((692, 1183), 44)  # the screenshot's round download button: centre, radius
FRAME_TOP = 1214  # the screenshot's dark bottom edge
CORNER = (1340, 1176)  # its rounded bottom-right corner, next to "DREAMY"


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
    sheet3 = cv2.imread(str(SHEET3))
    paper3 = tuple(int(v) for v in np.median(sheet3.reshape(-1, 3), axis=0))
    cv2.circle(sheet3, BUTTON[0], BUTTON[1], paper3, -1)
    sheet3[FRAME_TOP:] = paper3
    sheet3[CORNER[1]:, CORNER[0]:] = paper3

    # Sizes: sheet 2 and 3 scaled so a pose that's on both matches sheet 1.
    h1 = cut_grid(sheet1, NAMES1, ROWS1, ZOOM, STATES, LABELS, label_above={(1, 3): SLEEPING_LABEL_TOP}, dry=True)
    h2 = cut_grid(sheet2, with_reference(NAMES2, (1, 3), "sad"), ROWS2, 1, STATES, LABELS, cell_top={(1, 0): FOCUSED_TOP}, dry=True)
    h3 = cut_grid(sheet3, with_reference(NAMES3, (0, 3), "bye"), ROWS3, 1, STATES, LABELS, dry=True)
    zoom2 = ZOOM * h1["sad"] / h2["sad"]
    zoom3 = ZOOM * h1["bye"] / h3["bye"]
    target = label_height(sheet1, ROWS1, NAMES1, "idle") * LABEL_SCALE
    scale2 = target / label_height(sheet2, ROWS2, NAMES2, "curious")
    scale3 = target / label_height(sheet3, ROWS3, NAMES3, "determined")
    print(f"zoom: sheet 1 {ZOOM:.2f}, sheet 2 {zoom2:.2f}, sheet 3 {zoom3:.2f}; labels {LABEL_SCALE:.2f}, {scale2:.2f}, {scale3:.2f}")

    cut_grid(
        sheet1, NAMES1, ROWS1, ZOOM, STATES, LABELS,
        label_above={(1, 3): SLEEPING_LABEL_TOP}, extra_labels={(1, 3): "sneaky"}, label_boxes={"bye": BYE_LABEL},
    )
    cut_grid(sheet2, NAMES2, ROWS2, zoom2, STATES, LABELS, label_scale=scale2, cell_top={(1, 0): FOCUSED_TOP})
    cut_grid(
        sheet3, NAMES3, ROWS3, zoom3, STATES, LABELS,
        label_scale=scale3, label_boxes={"proud": PROUD_WORD}, no_label=("sneaky",),
    )
    shutil.copyfile(ROOT / "assets/chat/label-sighing.png", LABELS / "label-sighing.png")
    print("saved sighing label (from the male sheet)")
    tray_icons(STATES / "idle.png", ROOT / "assets/female/tray")
    print("saved tray icons")
    female_header()


if __name__ == "__main__":
    main()
