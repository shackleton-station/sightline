"""Compare the model with LROC's Wide Angle Camera images of the south pole: real sunlight.

The maps and frames are PDS3 images in polar stereographic x/y at 100 m/pixel. The time-weighted map
says what share of one year (February 2010 to February 2011) each pixel was seen lit. The frames are
the individual dated photos behind it (Speyerer & Robinson 2013).

A photo shows the ground across 100 m, not a point 2 m up, so ridge-top values aren't meant to match
directly: compare with the model at ground level across the same patch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from clps.geometry import FloatArray

#: Values at or below this in a PDS3 float image are special codes, not data.
_SPECIAL_BELOW = -1.0e30
WAC_TWI_START_UTC = "2010-02-15T00:00:00"
WAC_TWI_END_UTC = "2011-02-05T00:00:00"
#: Half-width (m) of the points standing in for a 100 m pixel, and their spacing.
PATCH_OFFSETS_M = (-40.0, -20.0, 0.0, 20.0, 40.0)


@dataclass(frozen=True)
class PdsImageLayout:
    """Where a little-endian 32-bit float PDS3 image's pixels are, and how they map to x/y."""

    record_bytes: int
    label_records: int
    lines: int
    samples: int
    line_offset: float
    sample_offset: float
    scale_m: float

    def pixel(self, x_m: FloatArray, y_m: FloatArray) -> tuple[NDArray[np.intp], NDArray[np.intp]]:
        """Row and column (from 0) holding projected x and y (m)."""
        col = np.rint(np.asarray(x_m, float) / self.scale_m + self.sample_offset).astype(np.intp)
        row = np.rint(self.line_offset - np.asarray(y_m, float) / self.scale_m).astype(np.intp)
        return row, col

    def center_xy(self, row: ArrayLikeInt, col: ArrayLikeInt) -> tuple[FloatArray, FloatArray]:
        """Projected x and y (m) of a pixel's center."""
        return (
            (np.asarray(col, float) - self.sample_offset) * self.scale_m,
            (self.line_offset - np.asarray(row, float)) * self.scale_m,
        )

    def byte_range(self, row: int, first_col: int, n_cols: int) -> tuple[int, int]:
        """First and last byte (inclusive) of some of a row's pixels, for a ranged request."""
        start = self.record_bytes * (self.label_records + row) + 4 * first_col
        return start, start + 4 * n_cols - 1


ArrayLikeInt = int | NDArray[np.intp]


def parse_pds_layout(label: str) -> PdsImageLayout:
    """Read a PDS3 label for the fields this module needs; refuses anything but 32-bit floats."""

    def field(name: str) -> str:
        match = re.search(rf"^\s*{name}\s*=\s*([^\s<]+)", label, re.MULTILINE)
        if not match:
            raise ValueError(f"no {name} in the label")
        return match.group(1)

    if field("SAMPLE_TYPE") != "PC_REAL" or int(field("SAMPLE_BITS")) != 32:
        raise ValueError("expected little-endian 32-bit floats")
    return PdsImageLayout(
        record_bytes=int(field("RECORD_BYTES")),
        label_records=int(field("LABEL_RECORDS")),
        lines=int(field("LINES")),
        samples=int(field("LINE_SAMPLES")),
        line_offset=float(field("LINE_PROJECTION_OFFSET")),
        sample_offset=float(field("SAMPLE_PROJECTION_OFFSET")),
        scale_m=float(field("MAP_SCALE")),
    )


def clean(values: NDArray[np.floating]) -> FloatArray:
    """Pixels as floats, with PDS special codes and non-finite values as NaN."""
    out = np.asarray(values, float).copy()
    out[~np.isfinite(out) | (out < _SPECIAL_BELOW)] = np.nan
    return out


def read_image(path: Path) -> tuple[PdsImageLayout, FloatArray]:
    """A whole PDS3 float image from disk, with special values as NaN."""
    head = path.read_bytes()[:16_384].decode("latin1")
    layout = parse_pds_layout(head)
    pixels = np.fromfile(
        path,
        dtype="<f4",
        offset=layout.record_bytes * layout.label_records,
        count=layout.lines * layout.samples,
    )
    return layout, clean(pixels.reshape(layout.lines, layout.samples))


def agreement(ours_pct: FloatArray, theirs_pct: FloatArray) -> dict[str, float]:
    """Bias, RMSE and correlation of our percentages against another's (percentage points)."""
    difference = ours_pct - theirs_pct
    return {
        "n": int(ours_pct.size),
        "bias": round(float(np.mean(difference)), 1),
        "rmse": round(float(np.sqrt(np.mean(difference**2))), 1),
        "r": round(float(np.corrcoef(ours_pct, theirs_pct)[0, 1]), 3),
    }


def lit_call(values: FloatArray, threshold: float) -> NDArray[np.bool_]:
    """Whether photo pixels look sunlit, where they have data (NaN compares as not lit)."""
    return np.nan_to_num(values, nan=-1.0) >= threshold


def balanced_accuracy(ours_lit: NDArray[np.bool_], photo_lit: NDArray[np.bool_]) -> float | None:
    """Mean of how often lit and dark pixels are called right, in percent; None if one is missing.

    Plain agreement flatters a model when almost everything is lit or dark, so each counts equally.
    """
    if photo_lit.all() or not photo_lit.any():
        return None
    lit_right = float(np.mean(ours_lit[photo_lit]))
    dark_right = float(np.mean(~ours_lit[~photo_lit]))
    return 100.0 * (lit_right + dark_right) / 2.0


def scored_frames(
    values: FloatArray, dark_below: float, bright_from: float
) -> tuple[NDArray[np.bool_], NDArray[np.bool_]]:
    """Which photo pixels count, and which of those are lit, leaving out the ones in between.

    With both limits equal, every pixel with data counts. Blank pixels never do.
    """
    bright = np.nan_to_num(values, nan=-np.inf) >= bright_from
    dark = np.nan_to_num(values, nan=np.inf) < dark_below
    return bright | dark, bright


def frame_interval(
    ours_lit: NDArray[np.bool_],
    photo_lit: NDArray[np.bool_],
    seen: NDArray[np.bool_],
    n_draws: int = 1000,
    seed: int = 20261105,
) -> tuple[float, float] | None:
    """Middle 95% of balanced accuracy when frames are redrawn at random, in percent.

    Arrays are (frames, pixels). Whole frames are redrawn, because pixels in one frame share a time
    and aren't independent. Returns None when too few draws contain both lit and dark pixels.
    """
    rng = np.random.default_rng(seed)
    frames = ours_lit.shape[0]
    draws = []
    for _ in range(n_draws):
        pick = rng.integers(0, frames, frames)
        keep = seen[pick]
        score = balanced_accuracy(ours_lit[pick][keep], photo_lit[pick][keep])
        if score is not None:
            draws.append(score)
    if len(draws) < n_draws / 2:
        return None
    low, high = np.percentile(draws, [2.5, 97.5])
    return float(low), float(high)
