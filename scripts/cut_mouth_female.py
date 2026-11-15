"""Polly's mouth frames: her talking pose with the mouth closed and open, from the user's own edits.

The user made two copies of her talking pose (CROP below, cut from her first sheet): one with the
mouth closed, one with it open wide (docs/design/talking-female-mouth-closed.jpg / -open.jpg). Each copy is lined up on the sheet (SIFT
matches, an affine transform, because the copy's width and height were scaled a little differently),
and only the spots that differ inside the mouth box are taken, feathered, and laid over the sharp
original. That sheet is cut with exactly the same boxes and zoom as her poses in cut_sheet_female.py,
then everything but the mouth is made see-through, so a frame only covers her mouth: it sits pixel
for pixel on the pose and works together with her blink frames. Nothing is redrawn.

Output: assets/female/mouth/talking-closed.png and talking-open.png
Run: cd scripts && python3 cut_mouth_female.py
"""
import tempfile
from pathlib import Path

import cv2
import numpy as np

from cut_sheet2 import ZOOM, cut_grid
from cut_sheet_female import NAMES1, ROWS1, SHEET1, SLEEPING_LABEL_TOP

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "docs/design"
OUT = ROOT / "assets/female/mouth"
POSE = "talking"
# frame: (the user's copy, which half of it holds the pose: None = the whole picture, 0 = left, 1 = right)
FRAMES = {
    "closed": ("talking-female-mouth-closed.jpg", None),
    "open": ("talking-female-mouth-open.jpg", None),
    "half": ("talking-female-mouth-half-wide.jpg", 0),
    "wide": ("talking-female-mouth-half-wide.jpg", 1),
}

CROP = (850, 155, 1145, 545)  # the talking pose on her first sheet: the picture the user edited
MOUTH = (135, 115, 215, 200)  # x0, y0, x1, y1 inside CROP: only changes here count
DIFF = 30  # grey levels
GROW = 7  # px (sheet) around the changed spots
FEATHER = 2.0  # blur sigma (sheet px)
FRAME_GROW = 9  # px (cut-out) around the mouth, so the old mouth is fully covered
FRAME_FEATHER = 1.5


def mouth_patch(sheet: np.ndarray, edit: np.ndarray) -> np.ndarray:
    """The sheet with the edit's mouth: the edit lined up on the crop, only the mouth box's changes."""
    x0, y0, x1, y1 = CROP
    crop = sheet[y0:y1, x0:x1]
    cv2.setRNGSeed(0)  # RANSAC: the same frames on every run
    sift = cv2.SIFT_create(8000)
    k0, d0 = sift.detectAndCompute(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), None)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(edit, cv2.COLOR_BGR2GRAY), None)
    good = [a for a, b in cv2.BFMatcher().knnMatch(d1, d0, k=2) if a.distance < 0.75 * b.distance]
    src = np.float32([k1[a.queryIdx].pt for a in good])
    dst = np.float32([k0[a.trainIdx].pt for a in good])
    m, _ = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3)
    # The edit is much bigger than the crop: shrink it first (smooth), then lay it on with what's left.
    f = float(np.sqrt(abs(np.linalg.det(m[:, :2]))))
    small = cv2.resize(edit, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    m[:, :2] /= f
    warped = cv2.warpAffine(small, m, (crop.shape[1], crop.shape[0]), borderValue=(255, 255, 255))
    diff = cv2.absdiff(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)) > DIFF
    box = np.zeros_like(diff)
    mx0, my0, mx1, my1 = MOUTH
    box[my0:my1, mx0:mx1] = True
    spots = cv2.dilate((diff & box).astype(np.uint8), np.ones((GROW, GROW), np.uint8)).astype(np.float32)
    f = cv2.GaussianBlur(spots, (0, 0), FEATHER)[:, :, None]
    out = sheet.copy()
    out[y0:y1, x0:x1] = (crop * (1 - f) + warped * f).astype(np.uint8)
    return out


def main(out: Path = OUT) -> None:
    sheet = cv2.imread(str(SHEET1))
    pose = cv2.imread(str(ROOT / "assets/female/states" / f"{POSE}.png"), cv2.IMREAD_UNCHANGED)
    states = tuple(n for row in NAMES1 for n in row if n)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        for frame, (name, half) in FRAMES.items():
            edit = cv2.imread(str(DESIGN / name))
            if half is not None:  # two poses side by side, each with its own lettering under it
                w = edit.shape[1] // 2
                edit = edit[:, half * w:(half + 1) * w]
            comp = mouth_patch(sheet, edit)
            cut_grid(sheet, NAMES1, ROWS1, ZOOM, scratch / frame, scratch / "labels", no_label=states, pixels=comp,
                     label_above={(1, 3): SLEEPING_LABEL_TOP})
            cut = cv2.imread(str(scratch / frame / f"{POSE}.png"), cv2.IMREAD_UNCHANGED)
            # Only the mouth stays: where the frame differs from the pose, grown and feathered.
            changed = (np.abs(cut.astype(int) - pose.astype(int)).max(axis=2) > DIFF).astype(np.uint8)
            count, comps, stats, _ = cv2.connectedComponentsWithStats(changed)
            if count > 1:  # the mouth itself; specks of grain around it don't count
                changed = (comps == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
            mask = cv2.dilate(changed, np.ones((FRAME_GROW, FRAME_GROW), np.uint8)).astype(np.float32)
            mask = np.clip(cv2.GaussianBlur(mask, (0, 0), FRAME_FEATHER) * 1.4, 0, 1)
            cut[:, :, 3] = (cut[:, :, 3].astype(np.float32) * mask).astype(np.uint8)
            cv2.imwrite(str(out / f"{POSE}-{frame}.png"), cut)
            print(f"  {POSE}-{frame}: {int(changed.sum())} px changed")


if __name__ == "__main__":
    import sys

    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
