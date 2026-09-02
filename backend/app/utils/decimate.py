"""Downsample trace arrays for plotting without sending every raw sample.

Uses simple min/max-per-bucket decimation: for each output bucket, keep both
the min and max sample so spikes aren't smoothed away the way naive stride
subsampling would lose them. This is the standard trick browser charting
libraries (and tools like Grafana) use for large time series.
"""
from __future__ import annotations

import numpy as np


def minmax_decimate(y: np.ndarray, x: np.ndarray, max_points: int = 2000) -> tuple[np.ndarray, np.ndarray]:
    """Decimate 1D arrays x, y to at most ~max_points, preserving local extrema.

    Returns (x_out, y_out). If len(y) <= max_points, returns the input unchanged.
    """
    n = len(y)
    if n <= max_points:
        return x, y

    n_buckets = max_points // 2  # each bucket contributes a min and a max sample
    bucket_size = n / n_buckets

    x_out = np.empty(n_buckets * 2, dtype=x.dtype)
    y_out = np.empty(n_buckets * 2, dtype=y.dtype)

    for i in range(n_buckets):
        start = int(i * bucket_size)
        end = int((i + 1) * bucket_size) if i < n_buckets - 1 else n
        if end <= start:
            end = start + 1
        chunk = y[start:end]
        argmin = start + int(np.argmin(chunk))
        argmax = start + int(np.argmax(chunk))
        # keep chronological order within the bucket
        lo, hi = (argmin, argmax) if argmin <= argmax else (argmax, argmin)
        x_out[2 * i] = x[lo]
        y_out[2 * i] = y[lo]
        x_out[2 * i + 1] = x[hi]
        y_out[2 * i + 1] = y[hi]

    return x_out, y_out
