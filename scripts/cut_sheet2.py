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


def column_splits(ink_row: np.ndarray, width: int, ncols: int = 6) -> list[int]:
    """Where to split a row into columns: the widest empty gap near each split, or the least ink."""
    col = ink_row.sum(0)
    splits = [0]
    for k in range(1, ncols):
        lo = int(k * width / ncols) - 90
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


def cut_label(letters: np.ndarray, x0: int, y0: int, x1: int, y1: int, scale: float) -> np.ndarray:
    """The hand-lettered name in this box, cropped to its ink and scaled."""
    region = letters[y0:y1, x0:x1].copy()
    n, lab, st, _ = cv2.connectedComponentsWithStats((region[:, :, 3] > 60).astype(np.uint8))
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 60
    # Strokes that start low and run off the bottom are the next row's ears, not lettering.
    h = region.shape[0]
    keep[1:] &= ~((st[1:, cv2.CC_STAT_TOP] + st[1:, cv2.CC_STAT_HEIGHT] >= h - 1) & (st[1:, cv2.CC_STAT_TOP] > h * 0.55))
    region[~(cv2.dilate(keep[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) == 1), 3] = 0
    ys, xs = np.where(region[:, :, 3] > 60)
    piece = region[max(0, ys.min() - 4) : ys.max() + 5, max(0, xs.min() - 4) : xs.max() + 5]
    return cv2.resize(piece, (round(piece.shape[1] * scale), round(piece.shape[0] * scale)), interpolation=cv2.INTER_AREA)


def cut_grid(
    img: np.ndarray,
    names: list[list[str | None]],
    rows: list[tuple[int, int, int]],
    zoom: float,
    states: Path,
    labels: Path,
    split_fix: dict | None = None,
    label_scale: float = LABEL_SCALE,
    label_above: dict | None = None,
    cell_top: dict | None = None,
    extra_labels: dict | None = None,
    label_boxes: dict | None = None,
    no_label: tuple = (),
    dry: bool = False,
    pixels: np.ndarray | None = None,
) -> dict[str, int]:
    """Cut every named drawing in a grid sheet, and its name below it. None = a cell that is skipped
    (its strokes still belong to it, so they're wiped from the neighbours' cut-outs).

    label_above: {(row, col): y} the name sits inside the drawing band from y down ("SLEEPING" above
      "SNEAKY"): strokes from y on are the label, not the drawing.
    cell_top: {(row, col): y} strokes in that cell that start above y aren't part of the drawing
      (the previous row's two-line name reaching down).
    extra_labels: {(row, col): name} the normal name below that cell is saved under another state.
    label_boxes: {name: (x0, y0, x1, y1)} take the name from exactly this box instead.
    no_label: states whose name comes from another sheet.
    dry: only measure; returns each drawing's ink height in sheet pixels.
    pixels: cut from this picture instead (same size as img), with img's boxes: a blink version of
      the sheet then lands exactly where the open-eyed cut-out is.
    """
    h, w = img.shape[:2]
    paper = np.median(img.reshape(-1, 3), axis=0).astype(np.float32)
    ink = ink_mask(img, paper)
    letters = None if dry else ink_layer(img, paper)
    if not dry:
        states.mkdir(parents=True, exist_ok=True)
        labels.mkdir(parents=True, exist_ok=True)
    heights: dict[str, int] = {}
    ncols = len(names[0])

    for r, (row_names, (top, bottom, label_bottom)) in enumerate(zip(names, rows)):
        band = ink[top:bottom]
        splits = column_splits(band, w, ncols)
        for (row, k), x in (split_fix or {}).items():
            if row == r:
                splits[k] = x
        count, comps, stats, cents = cv2.connectedComponentsWithStats(band)
        owner = np.full(count, -1)
        for i in range(1, count):
            if stats[i, cv2.CC_STAT_AREA] >= MIN_STROKE:
                c = int(np.searchsorted(splits, cents[i][0], side="right")) - 1
                y = top + stats[i, cv2.CC_STAT_TOP]
                cut_at = (label_above or {}).get((r, c))
                starts = (cell_top or {}).get((r, c))
                not_drawing = (cut_at is not None and y >= cut_at) or (starts is not None and y < starts)
                owner[i] = -2 if not_drawing else c
        for c, name in enumerate(row_names):
            lx0, lx1 = splits[c], splits[c + 1]
            if (r, c) in (extra_labels or {}) and not dry:
                cv2.imwrite(str(labels / f"label-{extra_labels[(r, c)]}.png"), cut_label(letters, lx0, bottom, lx1, label_bottom, label_scale))
            if name is None:
                continue
            mine = np.flatnonzero(owner == c)
            x0 = int(stats[mine, cv2.CC_STAT_LEFT].min())
            x1 = int((stats[mine, cv2.CC_STAT_LEFT] + stats[mine, cv2.CC_STAT_WIDTH]).max())
            y0 = int(stats[mine, cv2.CC_STAT_TOP].min())
            y1 = int((stats[mine, cv2.CC_STAT_TOP] + stats[mine, cv2.CC_STAT_HEIGHT]).max())
            heights[name] = y1 - y0
            if dry:
                continue
            # This drawing's box, and a copy of the sheet with every other stroke wiped.
            others = (owner != -1) & (owner != c)
            clean = (img if pixels is None else pixels).copy()
            wipe = cv2.dilate(others[comps].astype(np.uint8), np.ones((7, 7), np.uint8)) == 1
            clean[top:bottom][wipe] = paper.astype(np.uint8)
            clean[:top] = paper.astype(np.uint8)  # the label above stays out of tall boxes
            clean[bottom:] = paper.astype(np.uint8)
            cv2.imwrite(str(states / f"{name}.png"), cut(clean, paper, (name, x0, top + y0, x1, top + y1), zoom))

            if name in no_label:
                continue
            if name in (label_boxes or {}):
                box = label_boxes[name]
            elif (r, c) in (label_above or {}):
                box = (lx0, label_above[(r, c)], lx1, bottom)
            else:
                box = (lx0, bottom, lx1, label_bottom)
            small = cut_label(letters, *box, label_scale)
            cv2.imwrite(str(labels / f"label-{name}.png"), small)
            print(f"saved {name}  box {x1 - x0}x{y1 - y0}  label {small.shape[1]}x{small.shape[0]}")
    return heights


def main() -> None:
    cut_grid(cv2.imread(str(SHEET)), NAMES, ROWS, ZOOM, STATES, CHAT, split_fix=SPLIT_FIX)


if __name__ == "__main__":
    main()
