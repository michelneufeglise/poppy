"""Polly's blink frames: half-closed and closed eyes, from the user's own blink edits of her sheets.

For each of her two sheets the user made two copies with her eyes half closed (-half.jpg) and closed
(-closed.jpg). Those copies are smaller and a bit softer, so only the eyes are taken from them: the
spots that differ from the original sheet (the eyes), feathered, laid over the sharp original. That sheet
is then cut with exactly the same boxes and zoom as her open-eyed poses in cut_sheet_female.py, so a
frame sits pixel for pixel on top of its pose. Nothing is redrawn.

A pose blinks only when its closed frame changed; a half frame alone isn't used. Left out on purpose
(SKIP): poses whose eyes are already closed (the half copy opened them instead), chilling (sunglasses),
and poses where the copy changed more than the eyes (crying: hands moved; sad: tears added). NO_HALF:
the half copy changed more than the eyes (cheerful's mouth), so that pose closes in one step.

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

FRAMES = ("half", "closed")

DIFF = 40  # grey levels; less is the softer redraw of the same strokes
MIN_SPOT = 60  # px; smaller differences are grain, not eyes
GROW = 15  # px around each changed spot, so the whole eye comes along
FEATHER = 4.0  # blur sigma of the patch edge
MIN_CHANGE = 400  # px of patch inside a pose's box, or her eyes didn't change there
SKIP = {
    # sheet 1: eyes already closed, or shut in the original pose
    "happy", "shy", "sleeping", "excited", "disgusted", "clapping", "bye", "thirsty", "cuddly",
    "chilling",  # sunglasses
    "shocked",  # the closed copy didn't change
    "sad",  # the copies added tears
    # sheet 2
    "crying",  # the closed copy moved her hands away from her eyes
}
# The sheet's listening pose is listening-2 now (its own drawing is listening: cut_listening_female.py
# makes those frames, run after this script).
RENAME = {"listening": "listening-2"}
NO_HALF = {"cheerful"}  # the half copy also changed her mouth


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


def cut_frames(sheet: np.ndarray, stem: str, names, rows, zoom: float, scratch: Path, **grid) -> None:
    """Cuts the half and closed frames of one sheet's poses into OUT."""
    states = [n for row in names for n in row if n]
    for frame in FRAMES:
        comp, _ = eye_patch(sheet, cv2.imread(str(DESIGN / f"{stem}-{frame}.jpg")))
        out = scratch / f"{stem}-{frame}"
        cut_grid(sheet, names, rows, zoom, out, scratch / "labels", no_label=tuple(states), pixels=comp, **grid)
    for name in states:
        if name in SKIP:
            continue
        pose = RENAME.get(name, name)
        open_ = cv2.imread(str(ROOT / "assets/female/states" / f"{pose}.png"), cv2.IMREAD_UNCHANGED).astype(int)
        changed = {}
        for frame in FRAMES:
            # How much of the patch lands on this pose: the difference between the two cut-outs.
            shut = cv2.imread(str(scratch / f"{stem}-{frame}" / f"{name}.png"), cv2.IMREAD_UNCHANGED).astype(int)
            changed[frame] = int((np.abs(open_ - shut).max(axis=2) > DIFF).sum())
        if changed["closed"] < MIN_CHANGE:
            print(f"  {name}: closed eyes unchanged ({changed['closed']} px), no blink")
            continue
        for frame in FRAMES:
            if frame == "half" and (name in NO_HALF or changed["half"] < MIN_CHANGE):
                continue
            shutil.copyfile(scratch / f"{stem}-{frame}" / f"{name}.png", OUT / f"{pose}-{frame}.png")
        print(f"  {pose}: {'closed only' if not (OUT / f'{pose}-half.png').exists() else 'half + closed'}")


def main() -> None:
    sheet1 = cv2.imread(str(SHEET1))
    sheet2 = cv2.imread(str(SHEET2))
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        z = zoom2(sheet1, sheet2, scratch)
        print(f"zoom sheet 2: {z:.2f}")
        # from cut_listening_female.py
        kept = {n: (OUT / n).read_bytes() for n in ("listening-half.png", "listening-closed.png") if (OUT / n).exists()}
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir(parents=True)
        for name, data in kept.items():
            (OUT / name).write_bytes(data)
        cut_frames(sheet1, "emotions-sheet-female", NAMES1, ROWS1, ZOOM, scratch, label_above={(1, 3): SLEEPING_LABEL_TOP})
        cut_frames(sheet2, "emotions-sheet-female-2", NAMES2, ROWS2, z, scratch, cell_top={(1, 0): CRYING_TOP})
    print(f"{len(list(OUT.glob('*-closed.png')))} poses blink")


if __name__ == "__main__":
    main()
