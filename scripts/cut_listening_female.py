"""Polly's listening pose from its own drawing: docs/design/listening-female.jpg (the user's picture, one
pose on a sheet of its own: hand cupped behind her ear). It replaces the listening pose from her first
sheet; her header keeps the sheet's drawing.

The paper has a soft vignette, so it is evened out first (a per-pixel paper estimate: the ink dilated
away and blurred), then the drawing is cut exactly like every other pose (cut_sheet.cut) and scaled to
the height of the sheet's listening pose, so she doesn't grow or shrink when she starts listening.

Blinking: docs/design/listening-female-blink.jpg is the user's "Listening, emotions & angles" sheet. Its
"front / half-closed" and "front / closed" panels are the same head drawn again, so each panel is lined up
with the full drawing (SIFT matches, a similarity transform) and only the eyes (EYES, feathered) are laid
over it; then it's cut with exactly the same box, zoom and shift as the pose, so the frames lie on it.
The "turned right" panels aren't used (head and shoulders only, no matching full pose).

Output: assets/female/states/listening.png, assets/female/blink/listening-half.png / -closed.png
Run: cd scripts && python3 cut_listening_female.py (cut_sheet_female.py also runs it at the end)
"""
from pathlib import Path

import cv2
import numpy as np

from cut_sheet import cut

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/design/listening-female.jpg"
BLINK_SHEET = ROOT / "docs/design/listening-female-blink.jpg"
OUT = ROOT / "assets/female/states/listening.png"
BLINK_OUT = ROOT / "assets/female/blink"
# The two front panels on the blink sheet (x0, y0, x1, y1 in its pixels) and the eyes on the full drawing
# (centre, half axes in its pixels): the patch from the panel.
PANELS = {"half": (58, 148, 894, 758), "closed": (960, 148, 1797, 758)}
EYES = [((1010, 1035), (215, 190)), ((1505, 865), (140, 165))]
FEATHER = 12
HEIGHT = 314  # px on the 380 canvas: the sheet's listening pose, ears to the shadow under her feet
BOTTOM = 346  # and where its shadow ends, so she stands on the same spot
PAPER_LEVEL = 0.9
INK = 0.8  # darker than this share of the paper is pencil
MIN_STROKE = 400  # px; smaller specks are paper grain


def even_paper(img: np.ndarray) -> np.ndarray:
    """The picture with its paper made one even white, pencil keeping its tone."""
    paper = cv2.dilate(img, np.ones((41, 41), np.uint8))
    paper = cv2.GaussianBlur(paper, (0, 0), 40).astype(np.float32)
    # PAPER_LEVEL: the paper's own grain stays a shade under the estimate; that shade goes to white too,
    # or it would show as a faint box around her on a dark desktop.
    return np.clip(img.astype(np.float32) / np.maximum(paper * PAPER_LEVEL, 1) * 255, 0, 255).astype(np.uint8)


def drawing_box(norm: np.ndarray) -> tuple[int, int, int, int]:
    """Around every pencil stroke big enough to be part of the drawing (her, the motion lines, the shadow)."""
    ink = (cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY) < 255 * INK).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink, np.ones((5, 5), np.uint8)))
    keep = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] > MIN_STROKE]
    x0 = min(stats[i, cv2.CC_STAT_LEFT] for i in keep)
    y0 = min(stats[i, cv2.CC_STAT_TOP] for i in keep)
    x1 = max(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] for i in keep)
    y1 = max(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] for i in keep)
    return int(x0), int(y0), int(x1), int(y1)


def height(rgba: np.ndarray) -> int:
    ys = np.where(rgba[:, :, 3] > 40)[0]
    return int(ys.max() - ys.min() + 1)


def shift_to(rgba: np.ndarray, bottom: int) -> int:
    """How far to move the drawing down so its lowest stroke is at `bottom`."""
    return bottom - int(np.where(rgba[:, :, 3] > 40)[0].max())


def stand_on(rgba: np.ndarray, shift: int) -> np.ndarray:
    """Moves the drawing up or down by `shift` px."""
    out = np.zeros_like(rgba)
    if shift < 0:
        out[:shift] = rgba[-shift:]
    else:
        out[shift:] = rgba[: rgba.shape[0] - shift]
    return out


def eyes_from(panel: np.ndarray, drawing: np.ndarray) -> np.ndarray:
    """The drawing with the panel's eyes: the panel lined up on the drawing, only the eyes taken."""
    cv2.setRNGSeed(0)  # RANSAC: the same frames on every run
    sift = cv2.SIFT_create(8000)
    k0, d0 = sift.detectAndCompute(cv2.cvtColor(drawing, cv2.COLOR_BGR2GRAY), None)
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY), None)
    good = [a for a, b in cv2.BFMatcher().knnMatch(d1, d0, k=2) if a.distance < 0.75 * b.distance]
    src = np.float32([k1[a.queryIdx].pt for a in good])
    dst = np.float32([k0[a.trainIdx].pt for a in good])
    m, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=8)
    warped = cv2.warpAffine(panel, m, (drawing.shape[1], drawing.shape[0]), borderValue=(255, 255, 255))
    mask = np.zeros(drawing.shape[:2], np.float32)
    for centre, axes in EYES:
        cv2.ellipse(mask, centre, axes, 0, 0, 360, 1, -1)
    f = cv2.GaussianBlur(mask, (0, 0), FEATHER)[:, :, None]
    return (drawing * (1 - f) + warped * f).astype(np.uint8)


def main() -> None:
    drawing = even_paper(cv2.imread(str(SOURCE)))
    # Room for cut()'s padding around the box.
    border = lambda im: cv2.copyMakeBorder(im, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    norm = border(drawing)
    box = ("listening", *drawing_box(norm))
    white = np.array([255, 255, 255], np.float32)
    # Measure at a small trial size, then cut at the size that matches the sheet's pose.
    trial = 0.12
    zoom = trial * HEIGHT / height(cut(norm, white, box, trial))
    pose = cut(norm, white, box, zoom)
    shift = shift_to(pose, BOTTOM)
    out = stand_on(pose, shift)
    cv2.imwrite(str(OUT), out)
    print(f"saved {OUT.relative_to(ROOT)} (zoom {zoom:.3f}, height {height(out)} px)")

    sheet = even_paper(cv2.imread(str(BLINK_SHEET)))
    BLINK_OUT.mkdir(parents=True, exist_ok=True)
    for frame, (x0, y0, x1, y1) in PANELS.items():
        shut = border(eyes_from(sheet[y0:y1, x0:x1], drawing))
        path = BLINK_OUT / f"listening-{frame}.png"
        cv2.imwrite(str(path), stand_on(cut(shut, white, box, zoom), shift))
        print(f"saved {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
