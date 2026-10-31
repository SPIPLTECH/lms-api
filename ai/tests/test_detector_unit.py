"""Pure unit tests for the deterministic parts of the face pipeline (no model needed)."""

import numpy as np
import pytest

from proctor_ai.detectors.base import classify_face_count
from proctor_ai.detectors.blazeface import (
    ANCHORS,
    INPUT_SIZE,
    decode_boxes,
    decode_keypoints,
    letterbox,
    remove_letterbox,
    remove_letterbox_points,
    sigmoid_scores,
    weighted_nms,
)


@pytest.mark.parametrize("count,expected", [(0, "NO_FACE"), (1, "ONE_FACE"), (2, "MULTIPLE_FACES"), (7, "MULTIPLE_FACES")])
def test_classification_zero_one_many(count, expected):
    assert classify_face_count(count) == expected


def test_classification_rejects_negative_counts():
    with pytest.raises(ValueError):
        classify_face_count(-1)


def test_anchor_grid_matches_short_range_model():
    assert ANCHORS.shape == (896, 2)
    assert ANCHORS.min() > 0 and ANCHORS.max() < 1
    # stride 8: 16x16 cells x 2 anchors, then stride 16: 8x8 cells x 6 anchors
    assert np.allclose(ANCHORS[0], [0.5 / 16, 0.5 / 16])
    assert np.allclose(ANCHORS[512], [0.5 / 8, 0.5 / 8])


def test_decode_zero_offsets_gives_anchor_centred_boxes():
    raw = np.zeros((896, 16), dtype=np.float32)
    raw[:, 2] = raw[:, 3] = 12.8  # w = h = 0.1 of the tensor
    boxes = decode_boxes(raw)
    centres = (boxes[:, :2] + boxes[:, 2:]) / 2
    assert np.allclose(centres, ANCHORS, atol=1e-6)
    assert np.allclose(boxes[:, 2] - boxes[:, 0], 0.1, atol=1e-6)


def test_keypoints_decode_relative_to_anchor_and_reverse_the_letterbox():
    raw = np.zeros((896, 16), dtype=np.float32)
    raw[:, 4] = 12.8  # keypoint 0: +0.1 in x
    kps = decode_keypoints(raw)
    assert kps.shape == (896, 12)
    assert np.allclose(kps[:, 0], ANCHORS[:, 0] + 0.1) and np.allclose(kps[:, 1], ANCHORS[:, 1])
    assert np.allclose(kps[:, 2], ANCHORS[:, 0]) and np.allclose(kps[:, 11], ANCHORS[:, 1])
    # A point at the padded tensor edge maps back to the image edge.
    pts = remove_letterbox_points(np.array([0.25, 0.0] * 6), pad_x=0.25, pad_y=0.0)
    assert np.allclose(pts[0::2], 0.0) and np.allclose(pts[1::2], 0.0)


def test_sigmoid_is_stable_for_extreme_logits():
    with np.errstate(all="raise"):
        s = sigmoid_scores(np.array([[-1e6], [0.0], [1e6]], dtype=np.float32))
    assert s[0] < 1e-40 and s[1] == pytest.approx(0.5) and s[2] == pytest.approx(1.0)


def test_weighted_nms_merges_overlaps_and_keeps_separate_faces():
    boxes = np.array([[0.10, 0.10, 0.30, 0.30], [0.11, 0.11, 0.31, 0.31], [0.60, 0.60, 0.80, 0.80]])
    scores = np.array([0.9, 0.8, 0.7])
    out = weighted_nms(boxes, scores)
    assert len(out) == 2
    assert out[0][0] == pytest.approx(0.9)
    # merged box lies between the two overlapping inputs
    assert 0.10 < out[0][1][0] < 0.11


def test_letterbox_keeps_aspect_ratio_and_reverses_exactly():
    rgb = np.zeros((100, 200, 3), dtype=np.uint8)  # landscape: vertical padding
    tensor, pad_x, pad_y = letterbox(rgb)
    assert tensor.shape == (1, INPUT_SIZE, INPUT_SIZE, 3)
    assert pad_x == 0 and pad_y == pytest.approx(32 / 128)
    assert tensor.min() >= -1.0 and tensor.max() <= 1.0
    # a box covering the whole content area maps back to the whole original image
    restored = remove_letterbox(np.array([0.0, pad_y, 1.0, 1.0 - pad_y]), pad_x, pad_y)
    assert np.allclose(restored, [0, 0, 1, 1])
