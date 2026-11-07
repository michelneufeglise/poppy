"""Cut the 36 extra states out of docs/design/emotions-sheet-2.jpg ("More emotions & states").

Same method as cut_sheet.py (see there): each drawing becomes assets/states/<state>.png on the shared
380x380 canvas, and its hand-lettered name becomes assets/chat/label-<state>.png for the chat.
Nothing is redrawn. The drawings on this sheet are smaller than on the first one, so they are
scaled up by ZOOM to match Poppy's size in the first 12 states.

The sheet isn't an exact grid, and a few drawings reach into their neighbour's column (busy's desk,
thirsty's drop), so every pencil stroke is given to the drawing whose column its centre is in, and the
other drawings' strokes are wiped before cutting.

Run: python3 scripts/cut_sheet2.py
"""
from pathlib import Path

import cv2
import numpy as np

from cut_chat import ink_layer
from cut_sheet import cut

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs/design/emotions-sheet-2.jpg"
STATES = ROOT / "assets/states"
CHAT = ROOT / "assets/chat"

# Row by row, as on the sheet. "Proud (clapping)" is "clapping", "Sadly saying hello" is
# "sad-hello" and "Waving bye" is "bye".
NAMES = [
    ["angry", "laughing", "shy", "sneaky", "bored", "tired"],
    ["crying", "scared", "excited", "disgusted", "confused", "proud"],
    ["hungry", "sick", "shocked", "anxious", "cheerful", "frustrated"],
    ["grumpy", "playful", "dreamy", "clapping", "doubtful", "lazy"],
    ["sad-hello", "bye", "cuddly", "thirsty", "busy", "spooked"],
    ["nervous", "hopeful", "chilling", "wonder", "defiant", "sighing"],
]
# (drawings top, drawings bottom, label bottom) per row, measured from the ink on the sheet.
ROWS = [
    (135, 478, 540),
    (537, 878, 932),
    (930, 1286, 1342),
    (1340, 1686, 1781),  # two-line label: "PROUD (CLAPPING)"
    (1781, 2080, 2178),  # two-line labels: "SADLY SAYING HELLO", "WAVING BYE"
    (2177, 2460, 2515),
]
ZOOM = 1.25  # body height of a standing pose matches the first sheet
# Splits the gap search gets wrong: (row, split) -> x. Thirsty's drop bubble (centre x 1120) and
# busy's desk (from x 1143) share a column, so the split goes between them.
SPLIT_FIX = {(4, 4): 1140}
LABEL_SCALE = 0.75  # one line of lettering ends up about as tall as on the first sheet's labels
MIN_STROKE = 25  # px; smaller specks are paper grain


def ink_mask(img: np.ndarray, paper: np.ndarray) -> np.ndarray:
    norm = np.clip(img.astype(np.float32) / paper * 255.0, 0, 255).astype(np.uint8)
    return (cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY) < 200).astype(np.uint8)


def column_splits(ink_row: np.ndarray, width: int) -> list[int]:
    """Where to split a row into 6 columns: the widest empty gap near each sixth, or the least ink."""
    col = ink_row.sum(0)
    splits = [0]
    for k in range(1, 6):
        lo = int(k * width / 6) - 90
        seg = col[lo : lo + 180]
        zero = np.flatnonzero(seg == 0)
        if len(zero):
            runs = np.split(zero, np.flatnonzero(np.diff(zero) != 1) + 1)
            run = max(runs, key=len)
            splits.append(lo + int(run[0] + run[-1]) // 2)
        else:
            splits.append(lo + int(np.argmin(seg)))
    splits.append(width)
    return splits


def main() -> None:
    img = cv2.imread(str(SHEET))
    h, w = img.shape[:2]
    paper = np.median(img.reshape(-1, 3), axis=0).astype(np.float32)
    ink = ink_mask(img, paper)
    letters = ink_layer(img, paper)
    STATES.mkdir(parents=True, exist_ok=True)

    for r, (names, (top, bottom, label_bottom)) in enumerate(zip(NAMES, ROWS)):
        band = ink[top:bottom]
        splits = column_splits(band, w)
        for (row, k), x in SPLIT_FIX.items():
            if row == r:
                splits[k] = x
        count, comps, stats, cents = cv2.connectedComponentsWithStats(band)
        owner = np.full(count, -1)
        for i in range(1, count):
            if stats[i, cv2.CC_STAT_AREA] >= MIN_STROKE:
                owner[i] = int(np.searchsorted(splits, cents[i][0], side="right")) - 1
        for c, name in enumerate(names):
            mine = np.flatnonzero(owner == c)
            others = (owner >= 0) & (owner != c)
            # This drawing's box, and a copy of the sheet with the neighbours' strokes wiped.
            x0 = int(stats[mine, cv2.CC_STAT_LEFT].min())
            x1 = int((stats[mine, cv2.CC_STAT_LEFT] + stats[mine, cv2.CC_STAT_WIDTH]).max())
            y0 = int(stats[mine, cv2.CC_STAT_TOP].min())
            y1 = int((stats[mine, cv2.CC_STAT_TOP] + stats[mine, cv2.CC_STAT_HEIGHT]).max())
            clean = img.copy()
            wipe = cv2.dilate(others[comps].astype(np.uint8), np.ones((7, 7), np.uint8)) == 1
            clean[top:bottom][wipe] = paper.astype(np.uint8)
            clean[:top] = paper.astype(np.uint8)  # the label above stays out of tall boxes
            clean[bottom:] = paper.astype(np.uint8)
            cv2.imwrite(str(STATES / f"{name}.png"), cut(clean, paper, (name, x0, top + y0, x1, top + y1), ZOOM))

            # The name under the drawing, in this column only.
            lx0, lx1 = splits[c], splits[c + 1]
            region = letters[bottom:label_bottom, lx0:lx1].copy()
            n, lab, st, _ = cv2.connectedComponentsWithStats((region[:, :, 3] > 60).astype(np.uint8))
            keep = np.zeros(n, bool)
            keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 60
            region[~(cv2.dilate(keep[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) == 1), 3] = 0
            ys, xs = np.where(region[:, :, 3] > 60)
            piece = region[max(0, ys.min() - 4) : ys.max() + 5, max(0, xs.min() - 4) : xs.max() + 5]
            small = cv2.resize(piece, (round(piece.shape[1] * LABEL_SCALE), round(piece.shape[0] * LABEL_SCALE)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(CHAT / f"label-{name}.png"), small)
            print(f"saved {name}  box {x1 - x0}x{y1 - y0}  label {small.shape[1]}x{small.shape[0]}")


if __name__ == "__main__":
    main()
