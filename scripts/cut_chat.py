"""Cut the chat window pieces out of the user's picture (docs/design/chat-window.jpg)
and the state names out of the emotion sheet (docs/design/emotions-sheet.jpg).

Nothing is redrawn. Every piece keeps only the pencil: the paper becomes see-through,
so the pieces lie on the paper background. Text in the picture ("hi there", the reply,
"Ask Poppy anything") is erased so real messages can go there.

Output (assets/chat/):
  frame.png, bubble-you.png, bubble-poppy.png, input.png  stretched with CSS border-image (9-slice)
  header.png (the whole header), title.png, close.png, gear.png, send.png, button.png (Send without its word), line-top.png, line-bottom.png
  paper.png  a seamless tile of the paper
  label-<state>.png  the hand-lettered state names from the emotion sheet

Run: python3 scripts/cut_chat.py
"""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PICTURE = ROOT / "docs/design/chat-window.jpg"
SHEET = ROOT / "docs/design/emotions-sheet.jpg"
OUT = ROOT / "assets/chat"
SCALE = 0.6  # about 2x the size on screen, so it stays sharp on Retina

# A clean bit of paper in the picture (no ink).
PAPER_BOX = (360, 1295, 1040, 1535)

# name: (crop x0, y0, x1, y1, [erase boxes in picture coordinates])
PIECES = {
    # The whole header as the user drew it: listening Poppy, POPPY, –, ×, gear, menu and the line.
    # Keep in sync with the button hotspots in src/renderer/header.css.
    "header": (150, 132, 1385, 420, [(150, 132, 1385, 142)]),  # top rows: the frame, drawn separately
    "title": (535, 180, 925, 352, []),
    "close": (1288, 158, 1358, 222, []),
    "gear": (1145, 265, 1245, 365, []),
    "line-top": (480, 372, 1380, 418, []),
    "line-bottom": (345, 1550, 1385, 1592, [(1090, 1550, 1330, 1561)]),  # tip of the "SAY HELLO" lettering
    "bubble-you": (930, 475, 1325, 692, [(995, 520, 1265, 612)]),
    "bubble-poppy": (185, 700, 1250, 1278, [(262, 765, 1160, 1150), (1070, 1222, 1250, 1278)]),
    "input": (178, 1592, 1052, 1794, [(222, 1640, 1032, 1762)]),
    "send": (1065, 1598, 1352, 1794, []),
    # The Send button with its word erased: an empty drawn button for any label.
    "button": (1065, 1598, 1352, 1794, [(1112, 1645, 1305, 1745)]),
}
FRAME_BOX = (108, 92, 1418, 1872)
# Everything inside the frame that isn't the frame itself.
FRAME_ERASE = [
    (158, 150, 1385, 1550),  # header, messages and Poppy
    (158, 1550, 1385, 1815),  # input row and the bottom line
]

# State names under each drawing on the emotion sheet: (state, label centre x, label top y).
LABELS = [
    ("idle", 297, 640), ("listening", 755, 640), ("thinking", 1205, 640),
    ("talking", 305, 1078), ("happy", 755, 1078), ("sad", 1198, 1078),
    ("surprised", 302, 1500), ("curious", 755, 1500), ("focused", 1210, 1500),
    ("determined", 300, 1915), ("sleeping", 755, 1915), ("hello", 1210, 1915),
]


def ink_layer(img: np.ndarray, paper: np.ndarray) -> np.ndarray:
    """BGRA image: graphite tone kept, alpha from how dark the pencil is (paper = 0)."""
    norm = np.clip(img.astype(np.float32) / paper * 255.0, 0, 255).astype(np.uint8)
    gray = cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY).astype(np.float32)
    alpha = np.clip((235 - gray) * 1.7, 0, 255).astype(np.uint8)
    rgba = cv2.cvtColor(norm, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    return rgba


def panel_mask(img: np.ndarray) -> np.ndarray:
    """How much of each pixel belongs to the panel (0..1), so the dark desktop around it goes.
    Pencil just outside the paper fades out over a few pixels; strokes over the dark desktop
    can't be told apart from it, so they are left out."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bright = (gray > 150).astype(np.uint8)
    _, labels = cv2.connectedComponents(bright)
    inside = (labels == labels[1450, 760]).astype(np.uint8)
    contours, _ = cv2.findContours(inside, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    filled = np.zeros_like(inside)
    cv2.drawContours(filled, [max(contours, key=cv2.contourArea)], -1, 1, cv2.FILLED)
    dist = cv2.distanceTransform(1 - filled, cv2.DIST_L2, 5)
    return np.clip((9.0 - dist) / 5.0, 0.0, 1.0)


def save(name: str, rgba: np.ndarray, scale: float = SCALE) -> None:
    h, w = rgba.shape[:2]
    small = cv2.resize(rgba, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(OUT / f"{name}.png"), small)
    print(f"saved {name}.png  {small.shape[1]}x{small.shape[0]}")


def crop(layer: np.ndarray, box, erase) -> np.ndarray:
    x0, y0, x1, y1 = box
    piece = layer.copy()
    for ex0, ey0, ex1, ey1 in erase:
        piece[ey0:ey1, ex0:ex1, 3] = 0
    piece = piece[y0:y1, x0:x1].copy()
    # Drop lone specks (paper grain, dust); real pencil strokes are bigger.
    count, comps, stats, _ = cv2.connectedComponentsWithStats((piece[:, :, 3] > 50).astype(np.uint8))
    specks = np.zeros(count, bool)
    specks[1:] = stats[1:, cv2.CC_STAT_AREA] < 30
    piece[specks[comps], 3] = 0
    return piece


def with_paper_inside(piece: np.ndarray, paper: np.ndarray) -> np.ndarray:
    """Fill the inside of a bubble with the paper colour, for use on the desktop."""
    ink = (piece[:, :, 3] > 40).astype(np.uint8)
    # Padded first, so lines touching the edge don't seal off pockets of the outside.
    sealed = cv2.morphologyEx(
        np.pad(ink, 30), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
    )[30:-30, 30:-30]
    h, w = sealed.shape
    flood = np.pad(1 - sealed, 1, constant_values=1)
    mask = np.zeros((h + 4, w + 4), np.uint8)
    cv2.floodFill(flood, mask, (0, 0), 2)
    # The inside: everything the outside can't reach, with thin bits removed so the paper
    # doesn't bulge out between loose outer strokes.
    not_outside = (flood[1:-1, 1:-1] != 2).astype(np.uint8)
    inside = cv2.morphologyEx(not_outside, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (23, 23))) == 1
    out = piece.copy()
    a = out[:, :, 3:4].astype(np.float32) / 255.0
    out[:, :, :3] = np.where(inside[:, :, None], out[:, :, :3] * a + paper * (1 - a), out[:, :, :3]).astype(np.uint8)
    out[:, :, 3] = np.where(inside, 255, out[:, :, 3])
    return out


def paper_tile(img: np.ndarray) -> np.ndarray:
    """Mirror the clean paper patch into a tile that repeats without seams."""
    x0, y0, x1, y1 = PAPER_BOX
    patch = img[y0:y1, x0:x1]
    top = np.hstack([patch, cv2.flip(patch, 1)])
    return np.vstack([top, cv2.flip(top, 0)])


def labels() -> None:
    sheet = cv2.imread(str(SHEET))
    paper = np.median(sheet.reshape(-1, 3), axis=0).astype(np.float32)
    layer = ink_layer(sheet, paper)
    for state, cx, top in LABELS:
        region = layer[top - 5 : top + 70, cx - 230 : cx + 230].copy()
        # Drop specks (paper grain, stray dots): keep only real letter strokes.
        count, comps, stats, _ = cv2.connectedComponentsWithStats((region[:, :, 3] > 60).astype(np.uint8))
        keep = np.zeros(count, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 60
        letters = cv2.dilate(keep[comps].astype(np.uint8), np.ones((5, 5), np.uint8)) == 1
        region[~letters, 3] = 0
        ys, xs = np.where(region[:, :, 3] > 60)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        save(f"label-{state}", region[max(0, y0 - 4) : y1 + 4, max(0, x0 - 4) : x1 + 4])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(str(PICTURE))
    x0, y0, x1, y1 = PAPER_BOX
    paper = np.median(img[y0:y1, x0:x1].reshape(-1, 3), axis=0).astype(np.float32)
    layer = ink_layer(img, paper)
    layer[:, :, 3] = (layer[:, :, 3] * panel_mask(img)).astype(np.uint8)

    for name, (*box, erase) in PIECES.items():
        piece = crop(layer, box, erase)
        if name.startswith("bubble-"):
            piece = with_paper_inside(piece, paper)  # so a bubble also works over the desktop
        save(name, piece)
    save("frame", crop(layer, FRAME_BOX, FRAME_ERASE))
    save("paper", cv2.cvtColor(paper_tile(img), cv2.COLOR_BGR2BGRA))
    labels()


if __name__ == "__main__":
    main()
