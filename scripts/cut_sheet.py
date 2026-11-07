"""Cut the 12 state drawings out of docs/design/emotions-sheet.jpg.

Each drawing is saved as a PNG with a transparent background in assets/states/.
The inside of the character stays solid white, so it doesn't look see-through on the desktop.
All images share one canvas size, centered and resting on the same baseline, so switching states doesn't make Poppy jump.

Run: python3 scripts/cut_sheet.py
"""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs/design/emotions-sheet.jpg"
OUT = ROOT / "assets/states"

# (name, x0, y0, x1, y1): measured from the ink on the sheet, labels excluded.
CELLS = [
    ("idle", 158, 269, 483, 626),
    ("listening", 608, 269, 921, 626),
    ("thinking", 1064, 269, 1336, 626),
    ("talking", 158, 722, 491, 1071),
    ("happy", 580, 722, 934, 1071),
    ("sad", 1068, 722, 1341, 1071),
    ("surprised", 168, 1155, 435, 1490),
    ("curious", 620, 1155, 879, 1490),
    ("focused", 1063, 1155, 1355, 1490),
    ("determined", 140, 1568, 451, 1904),
    ("sleeping", 609, 1568, 955, 1904),
    ("hello", 1059, 1568, 1398, 1904),
]
PAD = 12
CANVAS_W, CANVAS_H = 380, 380
# Sketches with open outlines need a bigger gap-sealing brush.
SEAL = {"sad": 41}


def cut(img: np.ndarray, paper: np.ndarray, box, zoom: float = 1.0) -> np.ndarray:
    """zoom scales the drawing (another sheet may be drawn smaller), before it's fitted on the canvas."""
    name, x0, y0, x1, y1 = box
    crop = img[y0 - PAD : y1 + PAD, x0 - PAD : x1 + PAD].astype(np.float32)
    # White-balance: paper becomes pure white, pencil keeps its tone.
    norm = np.clip(crop / paper * 255.0, 0, 255).astype(np.uint8)
    # Clean frame of paper so the outside fill always starts on paper.
    norm = cv2.copyMakeBorder(norm, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    gray = cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY)

    ink = (gray < 215).astype(np.uint8)
    # Seal small gaps in the sketchy outline so the fill can't leak inside.
    sealed = cv2.morphologyEx(
        ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SEAL.get(name, 11),) * 2)
    )
    sealed = cv2.dilate(sealed, np.ones((3, 3), np.uint8))

    # Flood fill the paper from the border: that's the outside.
    h, w = gray.shape
    flood = (1 - sealed).astype(np.uint8)
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for x in range(w):
        for y in (0, h - 1):
            if flood[y, x] == 1 and mask[y + 1, x + 1] == 0:
                cv2.floodFill(flood, mask, (x, y), 2)
    for y in range(h):
        for x in (0, w - 1):
            if flood[y, x] == 1 and mask[y + 1, x + 1] == 0:
                cv2.floodFill(flood, mask, (x, y), 2)
    outside = (flood == 2).astype(np.uint8)
    near_outside = cv2.dilate(outside, np.ones((9, 9), np.uint8)) == 1

    ink_alpha = np.clip((255 - gray.astype(np.float32)) * 1.6, 0, 255)
    alpha = np.where(near_outside, ink_alpha, 255).astype(np.uint8)

    rgba = cv2.cvtColor(norm, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha

    if zoom != 1.0:
        rgba = cv2.resize(rgba, (round(w * zoom), round(h * zoom)), interpolation=cv2.INTER_CUBIC)
        h, w = rgba.shape[:2]

    # Place on a shared canvas: centered, bottom-aligned.
    canvas = np.zeros((CANVAS_H, CANVAS_W, 4), np.uint8)
    scale = min(1.0, (CANVAS_W - 4) / w, (CANVAS_H - 4) / h)
    if scale < 1.0:
        rgba = cv2.resize(rgba, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        h, w = rgba.shape[:2]
    ox = (CANVAS_W - w) // 2
    oy = CANVAS_H - h - 2
    canvas[oy : oy + h, ox : ox + w] = rgba
    return canvas


def tray_icons() -> None:
    """Menu-bar icon: the idle drawing's silhouette as a macOS template image (black + alpha),
    with the drawing's own pupils cut out as holes so it reads as Poppy's face at 18 px."""
    idle = cv2.imread(str(OUT / "idle.png"), cv2.IMREAD_UNCHANGED)
    ys, xs = np.where(idle[:, :, 3] > 0)
    idle = idle[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    body = idle[:, :, 3].astype(np.float32) / 255
    # The pupils are the big dark blobs in the upper part of the drawing.
    gray = cv2.cvtColor(idle[:, :, :3], cv2.COLOR_BGR2GRAY)
    dark = ((gray < 90) & (body > 0.5)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(dark)
    h, w = dark.shape
    eyes = np.zeros_like(dark)
    for i in range(1, count):
        top, height, area = stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_HEIGHT], stats[i, cv2.CC_STAT_AREA]
        if area > h * h * 0.002 and top + height < h * 0.6:
            eyes[labels == i] = 1
    # A little wider than the pupils, so the holes stay open after shrinking.
    eyes = cv2.dilate(eyes, np.ones((5, 5), np.uint8)).astype(np.float32)
    tray = ROOT / "assets/tray"
    tray.mkdir(parents=True, exist_ok=True)
    for name, size in (("trayTemplate.png", 18), ("trayTemplate@2x.png", 36)):
        scale = size / max(h, w)
        dims = (max(1, round(w * scale)), max(1, round(h * scale)))
        alpha = np.clip(
            cv2.resize(body, dims, interpolation=cv2.INTER_AREA) - cv2.resize(eyes, dims, interpolation=cv2.INTER_AREA), 0, 1
        )
        icon = np.zeros((size, size, 4), np.uint8)
        oy, ox = (size - alpha.shape[0]) // 2, (size - alpha.shape[1]) // 2
        icon[oy : oy + alpha.shape[0], ox : ox + alpha.shape[1], 3] = np.round(alpha * 255).astype(np.uint8)
        cv2.imwrite(str(tray / name), icon)


def main() -> None:
    img = cv2.imread(str(SHEET))
    paper = np.median(img.reshape(-1, 3), axis=0).astype(np.float32)
    OUT.mkdir(parents=True, exist_ok=True)
    for box in CELLS:
        cv2.imwrite(str(OUT / f"{box[0]}.png"), cut(img, paper, box))
        print("saved", box[0])
    tray_icons()
    print("saved tray icons")


if __name__ == "__main__":
    main()
