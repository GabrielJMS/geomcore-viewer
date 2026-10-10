import math

import pytest

from geomcore_viewer import sample_curve, sample_surface_grid


class P3:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def test_sample_curve_3d():
    pts = sample_curve(lambda t: P3(2 * math.cos(t), 2 * math.sin(t)), 0.0, 2 * math.pi, n=8)
    assert len(pts) == 9
    assert pts[0][0] == pytest.approx(2.0)
    assert all(len(p) == 3 for p in pts)


def test_sample_surface_grid():
    verts, idx = sample_surface_grid(lambda u, v: P3(u, v, u * v), 0, 1, 0, 1, nu=4, nv=2)
    assert len(verts) == 5 * 3
    assert len(idx) == 4 * 2 * 6
