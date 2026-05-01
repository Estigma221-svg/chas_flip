#!/usr/bin/env python3
"""
Avatares ChasFlip: fondo tipo estudio (gris cercano al borde) → transparente,
cuadrado centrado 512×512, WebP con alpha objetivo <100 KB.
Sólo Pillow + NumPy (sin flood-fill lento por imagen 2048²).

Variables de entorno:
  CHASFLIP_AVATAR_SRC  Carpeta entrada (default Desktop + carpeta usuario)
  CHASFLIP_AVATAR_OUT  Carpeta salida dentro del proyecto
"""
from __future__ import annotations

import glob
import io
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

TARGET = 512
# "menos de 100 KB" archivo (objetivo 100 000 bytes; cabe mejor en CDN/móvil que 102400 KiB.)
MAX_BYTES = 100_000

INPUT_DIR = os.environ.get(
    "CHASFLIP_AVATAR_SRC",
    "/Users/joseeduardoramospererez/Desktop/avatares de chasfilp ",
)
OUT_DIR = os.environ.get(
    "CHASFLIP_AVATAR_OUT",
    os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "public", "avatars", "chasflip")
    ),
)


def edge_mean_rgb(rgb: np.ndarray) -> np.ndarray:
    e = np.vstack([rgb[0, :], rgb[-1, :], rgb[:, 0], rgb[:, -1]])
    return e.reshape(-1, 3).astype(np.float32).mean(axis=0)


def saturation_map(rgb: np.ndarray) -> np.ndarray:
    mx = rgb.max(axis=2).astype(np.float32)
    mx = np.where(mx < 1e-6, 1.0, mx)
    mn = rgb.min(axis=2).astype(np.float32)
    return (mx - mn) / mx


def background_mask(rgb: np.ndarray, emean: np.ndarray) -> np.ndarray:
    rgbf = rgb.astype(np.float32)
    d = np.linalg.norm(rgbf - emean.reshape(1, 1, 3), axis=2)
    sat = saturation_map(rgbf)
    core = d < 40.0
    wide_neutral = (d < 74.0) & (sat < 0.20)
    halo = (d < 92.0) & (sat < 0.10)
    return core | wide_neutral | halo


def rgba_from_rgb_and_bg(rgb: np.ndarray, bg: np.ndarray) -> Image.Image:
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    rgba = np.dstack((r, g, b, alpha))
    im = Image.fromarray(rgba)
    a = im.split()[3]
    a2 = a.filter(ImageFilter.BoxBlur(1))
    return Image.merge("RGBA", (*im.split()[:3], a2))


def bbox_center_square(rgba: Image.Image, alpha_cut: int = 18, pad: int = 28) -> Image.Image:
    a = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(a > alpha_cut)
    if len(xs) == 0:
        return rgba.resize((TARGET, TARGET), Image.Resampling.LANCZOS)

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(rgba.width - 1, x1 + pad)
    y1 = min(rgba.height - 1, y1 + pad)

    crop = rgba.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = crop.size
    side = max(w, h)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - w) // 2, (side - h) // 2), crop)
    return sq.resize((TARGET, TARGET), Image.Resampling.LANCZOS)


def webp_save_under_cap(im: Image.Image, path: str) -> tuple[int, int]:
    """Empaqueta WEBP hasta cumplir tope · prueba rápida con method=4 y escritura final con method=6."""
    chosen_q, payload = None, None
    for q in range(94, 28, -1):
        bio = io.BytesIO()
        im.save(bio, format="WEBP", lossless=False, quality=q, method=4)
        if bio.tell() <= MAX_BYTES:
            chosen_q = q
            payload = bio.getvalue()
            break
    if chosen_q is None:
        bio = io.BytesIO()
        im.save(bio, format="WEBP", lossless=False, quality=28, method=4)
        chosen_q = 28
        payload = bio.getvalue()
    bio2 = io.BytesIO()
    im.save(bio2, format="WEBP", lossless=False, quality=chosen_q, method=6)
    if bio2.tell() <= MAX_BYTES:
        payload = bio2.getvalue()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(payload)
    return chosen_q, len(payload)


def process_one(path: str) -> tuple[Image.Image, dict]:
    src = Image.open(path).convert("RGB")
    arr = np.asarray(src)
    em = edge_mean_rgb(arr)
    bg = background_mask(arr, em)
    rgba = rgba_from_rgb_and_bg(arr, bg)
    out = bbox_center_square(rgba)
    meta = {
        "edge_mean": np.round(em, 1).tolist(),
        "bg_px_ratio": float(bg.mean()),
    }
    return out, meta


def main() -> int:
    files = sorted(glob.glob(os.path.join(INPUT_DIR, "*.png")))
    if not files:
        files = sorted(glob.glob(os.path.join(INPUT_DIR.rstrip(), "*.png")))
    if not files:
        print("No encontré PNG en:", repr(INPUT_DIR), file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    print("Entrada:", repr(INPUT_DIR.strip()))
    print("Salida:", OUT_DIR)

    exit_code = 0
    for i, ip in enumerate(files, start=1):
        out_name = os.path.join(OUT_DIR, f"avatar-{i:02d}.webp")
        im, meta = process_one(ip)
        q, nbytes = webp_save_under_cap(im, out_name)
        ok = nbytes <= MAX_BYTES
        tag = "OK" if ok else ">100KB"
        if not ok:
            exit_code = 2
        print(f"  [{tag}] {os.path.basename(ip)} → {os.path.basename(out_name)}  {nbytes/1024:.1f} KB  q={q}")
        print(f"        · fondo borrado ≈ {meta['bg_px_ratio']*100:.1f}% píxeles · media borde RGB {meta['edge_mean']}")

    if exit_code == 0:
        print("\nListos para CHASFLIP: usa /avatars/chasflip/avatar-01.webp … en el cliente.")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
