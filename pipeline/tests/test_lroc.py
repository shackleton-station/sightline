"""Reading LROC's images, and scoring the model against them."""

from pathlib import Path

import numpy as np
import pytest

from clps import lroc

LABEL = """PDS_VERSION_ID = PDS3
RECORD_BYTES  = 12
LABEL_RECORDS = 2
    MAP_SCALE                    = 100.0 <METERS/PIXEL>
    LINE_PROJECTION_OFFSET       = 1.0 <PIXEL>
    SAMPLE_PROJECTION_OFFSET     = 1.0 <PIXEL>
    LINES                      = 3
    LINE_SAMPLES               = 3
    SAMPLE_TYPE                = PC_REAL
    SAMPLE_BITS                = 32
END
"""


def test_label_gives_the_layout() -> None:
    layout = lroc.parse_pds_layout(LABEL)
    assert (layout.record_bytes, layout.label_records, layout.lines, layout.samples) == (
        12,
        2,
        3,
        3,
    )
    assert (layout.line_offset, layout.sample_offset, layout.scale_m) == (1.0, 1.0, 100.0)


def test_refuses_other_pixel_types() -> None:
    with pytest.raises(ValueError, match="32-bit"):
        lroc.parse_pds_layout(LABEL.replace("PC_REAL", "MSB_INTEGER"))


def test_pixels_follow_the_projection_both_ways() -> None:
    layout = lroc.parse_pds_layout(LABEL)
    row, col = layout.pixel(np.array([0.0, 100.0]), np.array([0.0, 100.0]))
    assert row.tolist() == [1, 0]
    assert col.tolist() == [1, 2]
    x, y = layout.center_xy(row, col)
    assert x.tolist() == [0.0, 100.0]
    assert y.tolist() == [0.0, 100.0]


def test_byte_range_skips_the_label_and_earlier_rows() -> None:
    layout = lroc.parse_pds_layout(LABEL)
    assert layout.byte_range(1, 1, 2) == (12 * 3 + 4, 12 * 3 + 11)


def test_read_image_turns_special_values_into_nan(tmp_path: Path) -> None:
    path = tmp_path / "x.IMG"
    label = LABEL.replace("RECORD_BYTES  = 12", "RECORD_BYTES  = 512").replace(
        "LABEL_RECORDS = 2", "LABEL_RECORDS = 1"
    )
    pixels = np.array([1, 2, 3, 4, -3.4028227e38, 6, 7, 8, 9], "<f4")
    path.write_bytes(label.encode().ljust(512, b" ") + pixels.tobytes())
    _, image = lroc.read_image(path)
    assert image[0, 0] == 1
    assert image[2, 2] == 9
    assert np.isnan(image[1, 1])


def test_agreement_reports_bias_and_rmse() -> None:
    out = lroc.agreement(np.array([10.0, 20.0, 30.0]), np.array([8.0, 18.0, 28.0]))
    assert out == {"n": 3, "bias": 2.0, "rmse": 2.0, "r": 1.0}


def test_missing_photo_data_is_never_called_lit() -> None:
    assert lroc.lit_call(np.array([0.1, 0.0, np.nan]), 0.05).tolist() == [True, False, False]


def test_balanced_accuracy_counts_lit_and_dark_equally() -> None:
    photo = np.array([True, False, False, False])
    assert lroc.balanced_accuracy(np.array([True, False, False, False]), photo) == 100.0
    assert lroc.balanced_accuracy(np.array([False, False, False, False]), photo) == 50.0
    assert lroc.balanced_accuracy(np.array([True, True]), np.array([True, True])) is None


def test_scored_frames_leave_out_blank_and_in_between_pixels() -> None:
    values = np.array([0.0005, 0.002, 0.004, np.nan])
    counted, lit = lroc.scored_frames(values, 0.001, 0.003)
    assert counted.tolist() == [True, False, True, False]
    assert lit.tolist() == [False, False, True, False]


def test_scored_frames_with_one_threshold_count_every_pixel_with_data() -> None:
    values = np.array([0.0005, 0.002, 0.004, np.nan])
    counted, lit = lroc.scored_frames(values, 0.003, 0.003)
    assert counted.tolist() == [True, True, True, False]
    assert lit.tolist() == [False, False, True, False]


def test_frame_interval_is_exact_for_a_perfect_model_and_wide_for_a_coin_flip() -> None:
    rng = np.random.default_rng(1)
    photo = rng.random((200, 3)) > 0.5
    seen = np.ones_like(photo)
    assert lroc.frame_interval(photo, photo, seen, n_draws=100) == (100.0, 100.0)
    low, high = lroc.frame_interval(rng.random((200, 3)) > 0.5, photo, seen, n_draws=200)
    assert low < 50.0 < high
    assert high - low < 20.0


def test_frame_interval_gives_up_when_photos_are_all_one_kind() -> None:
    photo = np.ones((50, 2), bool)
    assert lroc.frame_interval(photo, photo, np.ones_like(photo), n_draws=20) is None
