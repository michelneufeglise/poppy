"""Polly's blink frames: half-closed and closed eyes, from the user's own blink edits of her sheets.

The user made two copies of docs/design/emotions-sheet-female-2.jpg with her eyes half closed
(-2-half.jpg) and closed (-2-closed.jpg). Those copies are smaller and a bit softer, so only the eyes
are taken from them: the spots that differ from the original sheet (the eyes), feathered, laid over the
sharp original. That sheet is then cut with exactly the same boxes and zoom as her open-eyed poses in
cut_sheet_female.py, so a frame sits pixel for pixel on top of its pose. Nothing is redrawn.

A pose whose eyes didn't change (tired and laughing already have closed eyes) gets no frame, and the
app doesn't blink in it; focused and grumpy only changed in the closed edit, so they blink without the
half step. Crying is left out: in the closed edit her hands moved away from her eyes (a new pose). Later edits of the first sheet can be added to BLINK_SHEETS the same way.

Output: assets/female/blink/<state>-half.png and <state>-closed.png
Run: cd scripts && python3 cut_blink_female.py
"""
import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np

from cut_sheet2 import ZOOM, cut_grid
from cut_sheet_female import (
    CRYING_TOP, NAMES1, NAMES2, ROWS1, ROWS2, SHARED, SHEET1, SHEET2, SLEEPING_LABEL_TOP, with_reference,
)

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "docs/design"
OUT = ROOT / "assets/female/blink"

BLINK_SHEETS = {"half": DESIGN / "emotions-sheet-female-2-half.jpg", "closed": DESIGN / "emotions-sheet-female-2-closed.jpg"}

DIFF = 40  # grey levels; less is the softer redraw of the same strokes
MIN_SPOT = 60  # px; smaller differences are grain, not eyes
GROW = 15  # px around each changed spot, so the whole eye comes along
FEATHER = 4.0  # blur sigma of the patch edge
MIN_CHANGE = 400  # px of patch inside a pose's box, or her eyes didn't change there
SKIP = {"crying"}  # the edit changed more than her eyes


def eye_patch(orig: np.ndarray, edit: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The edit's changed spots laid over the original, and where (0..1) they were taken from."""
    edit = cv2.resize(edit, (orig.shape[1], orig.shape[0]), interpolation=cv2.INTER_CUBIC)
    diff = cv2.absdiff(cv2.cvtColor(orig, cv2.COLOR_BGR2GRAY), cv2.cvtColor(edit, cv2.COLOR_BGR2GRAY)) > DIFF
    diff = cv2.morphologyEx(diff.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, comps, stats, _ = cv2.connectedComponentsWithStats(diff)
    keep = np.isin(comps, [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] > MIN_SPOT])
    grown = cv2.dilate(keep.astype(np.uint8), np.ones((GROW, GROW), np.uint8)).astype(np.float32)
    f = cv2.GaussianBlur(grown, (0, 0), FEATHER)[:, :, None]
    comp = orig.astype(np.float32) * (1 - f) + edit.astype(np.float32) * f
    return comp.astype(np.uint8), f[:, :, 0]


def zoom2(sheet1: np.ndarray, sheet2: np.ndarray, scratch: Path) -> float:
    """Sheet 2's zoom, measured exactly like cut_sheet_female.py does."""
    h1 = cut_grid(sheet1, NAMES1, ROWS1, ZOOM, scratch, scratch, label_above={(1, 3): SLEEPING_LABEL_TOP}, dry=True)
    names = NAMES2
    for cell, name in SHARED.items():
        names = with_reference(names, cell, name)
    h2 = cut_grid(sheet2, names, ROWS2, 1, scratch, scratch, cell_top={(1, 0): CRYING_TOP}, dry=True)
    return ZOOM * float(np.mean([h1[n] / h2[n] for n in SHARED.values()]))


def main() -> None:
    sheet1 = cv2.imread(str(SHEET1))
    sheet2 = cv2.imread(str(SHEET2))
    states = [n for row in NAMES2 for n in row if n]
    blinks = [n for n in states if n not in SKIP]
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        z = zoom2(sheet1, sheet2, scratch)
        print(f"zoom sheet 2: {z:.2f}")
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir(parents=True)
        for frame, path in BLINK_SHEETS.items():
            comp, where = eye_patch(sheet2, cv2.imread(str(path)))
            out = scratch / frame
            cut_grid(
                sheet2, NAMES2, ROWS2, z, out, scratch / "labels",
                cell_top={(1, 0): CRYING_TOP}, no_label=tuple(states), pixels=comp,
            )
            for name in blinks:
                # How much of the patch lands on this pose: the difference between its two cut-outs.
                open_ = cv2.imread(str(ROOT / "assets/female/states" / f"{name}.png"), cv2.IMREAD_UNCHANGED)
                shut = cv2.imread(str(out / f"{name}.png"), cv2.IMREAD_UNCHANGED)
                changed = int((np.abs(open_.astype(int) - shut.astype(int)).max(axis=2) > DIFF).sum())
                if changed < MIN_CHANGE:
                    print(f"  {name} {frame}: eyes unchanged ({changed} px), no frame")
                    continue
                shutil.copyfile(out / f"{name}.png", OUT / f"{name}-{frame}.png")
                print(f"  saved {name}-{frame}  ({changed} px changed)")


if __name__ == "__main__":
    main()
