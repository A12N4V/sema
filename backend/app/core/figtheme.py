"""Make server-rendered figures sit on the app's background instead of a white card.

Two halves, and both are needed:

1. ``rc(theme)``: matplotlib rcParams applied *while* the figure is built, so
   everything MNE draws from defaults (tick labels, titles, spines) comes out
   in the theme's foreground colour.
2. ``restyle(fig, theme)``: a sweep afterwards, because MNE hard-codes ``'k'``
   in several places (the topomap head outline, contour lines, sensor dots).
   Anything drawn near-black is pulled to the theme foreground; anything else
   (the RdBu_r image, the ICA colour scale) is left alone.

The PNG itself is saved **transparent**, not filled with a guessed panel
colour: a transparent figure matches whatever it is dropped onto, including
the seam between two panes, and stays right if the palette moves.
"""
from __future__ import annotations

from typing import Any

from matplotlib.colors import to_rgb

# Mirrors the `--color-*` tokens in frontend/src/index.css. Keep in sync.
PALETTES: dict[str, dict[str, str]] = {
    "dark": {
        "fg": "#e8eaee", "dim": "#9297a2", "faint": "#585d68",
        "bg": "#0a0b0e", "accent": "#4c9dff",
    },
    "light": {
        "fg": "#1b1e24", "dim": "#596070", "faint": "#9298a4",
        "bg": "#ffffff", "accent": "#2072d8",
    },
}

THEMES = tuple(PALETTES)


def palette(theme: str) -> dict[str, str]:
    return PALETTES.get(theme, PALETTES["dark"])


def rc(theme: str) -> dict[str, Any]:
    """rcParams for ``plt.rc_context`` around a figure build."""
    p = palette(theme)
    return {
        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",
        "savefig.edgecolor": "none",
        "text.color": p["fg"],
        "axes.labelcolor": p["fg"],
        "axes.titlecolor": p["fg"],
        "axes.edgecolor": p["dim"],
        "xtick.color": p["dim"],
        "ytick.color": p["dim"],
        "xtick.labelcolor": p["dim"],
        "ytick.labelcolor": p["dim"],
        "grid.color": p["faint"],
        "legend.facecolor": "none",
        "legend.edgecolor": p["faint"],
        "patch.edgecolor": p["fg"],
        "lines.color": p["fg"],
        "font.size": 9,
    }


def _is_near_black(color: Any) -> bool:
    """True for the ``'k'`` / ``(0,0,0)`` MNE hard-codes, not for dark data colours."""
    try:
        r, g, b = to_rgb(color)
    except (ValueError, TypeError):
        return False
    return max(r, g, b) < 0.30


def restyle(fig, theme: str) -> None:
    """Recolour the hard-coded blacks in a built figure, in place."""
    p = palette(theme)
    fg = p["fg"]

    fig.patch.set_alpha(0.0)
    for ax in fig.get_axes():
        ax.patch.set_alpha(0.0)
        for spine in ax.spines.values():
            if _is_near_black(spine.get_edgecolor()):
                spine.set_edgecolor(p["dim"])

    for text in fig.findobj(match=lambda o: hasattr(o, "get_color") and hasattr(o, "get_text")):
        if _is_near_black(text.get_color()):
            text.set_color(fg)

    for ax in fig.get_axes():
        for line in ax.get_lines():
            if _is_near_black(line.get_color()):
                line.set_color(fg)
            if line.get_markerfacecolor() not in (None, "none") and _is_near_black(line.get_markerfacecolor()):
                line.set_markerfacecolor(fg)
            if _is_near_black(line.get_markeredgecolor()):
                line.set_markeredgecolor(fg)

        for patch in ax.patches:
            if _is_near_black(patch.get_edgecolor()):
                patch.set_edgecolor(fg)

        for coll in ax.collections:
            # Contour/scatter edges. `get_edgecolor()` is an (N, 4) array; an
            # empty one means "inherit", which is already handled by rcParams.
            try:
                edges = coll.get_edgecolor()
            except Exception:  # noqa: BLE001 - some artists have no edge concept
                continue
            if len(edges) and all(_is_near_black(e) for e in edges):
                coll.set_edgecolor(fg)
