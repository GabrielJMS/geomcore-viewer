import math

import pytest

from geomcore_viewer.adapt import (
    _frame,
    as_vec,
    eval_curve,
    eval_surface,
    scene_extent,
    subscript,
    to_objects,
    with_window,
)

TILTED = _frame([1.0, 2.0, 3.0], [1.0, -1.0, 0.0], [1.0, 1.0, 1.0])


# --- duck-typed stand-ins named like geomcore classes ---------------------
class Point3D:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


class Vector3D:
    def __init__(self, *c):
        self._c = c

    def components(self):
        return self._c


def fake(name, geom, **getters):
    """An object named ``name`` that evaluates ``geom`` and exposes ``getters``."""

    def eval_point(self, *args):
        p = eval_curve(geom, *args) if len(args) == 1 else eval_surface(geom, *args)
        return Point3D(*p)

    attrs = {"eval_point": eval_point}
    for key, value in getters.items():
        attrs[key] = (lambda value: lambda self: value)(value)
    return type(name, (), attrs)()


def assert_frame(got, want):
    for axis in ("o", "x", "y", "z"):
        assert got[axis] == pytest.approx(want[axis], abs=1e-12), axis


CASES = [
    ("Circle3D", {"type": "circle", "frame": TILTED, "r": 1.5},
     {"center": Point3D(*TILTED["o"]), "radius": 1.5, "normal": Vector3D(*TILTED["z"])}),
    ("Ellipse3D", {"type": "ellipse", "frame": TILTED, "a": 3.0, "b": 2.0},
     {"center": Point3D(*TILTED["o"]), "major_radius": 3.0, "minor_radius": 2.0}),
    ("Hyperbola3D", {"type": "hyperbola", "frame": TILTED, "a": 2.0, "b": 1.0},
     {"center": Point3D(*TILTED["o"]), "major_radius": 2.0, "minor_radius": 1.0}),
    ("Parabola3D", {"type": "parabola", "frame": TILTED, "f": 0.7}, {"focal": 0.7}),
    ("Plane", {"type": "plane", "frame": TILTED}, {}),
    ("Cylinder", {"type": "cylinder", "frame": TILTED, "r": 2.0}, {"radius": 2.0}),
    ("Cone", {"type": "cone", "frame": TILTED, "semi_angle": 0.4, "ref_radius": 2.0},
     {"semi_angle": 0.4, "ref_radius": 2.0}),
    ("Cone", {"type": "cone", "frame": TILTED, "semi_angle": 0.4, "ref_radius": 0.0},
     {"semi_angle": 0.4, "ref_radius": 0.0}),
    ("Cone", {"type": "cone", "frame": TILTED, "semi_angle": -0.4, "ref_radius": 0.0},
     {"semi_angle": -0.4, "ref_radius": 0.0}),
    ("Sphere", {"type": "sphere", "frame": TILTED, "r": 3.0}, {"center": Point3D(*TILTED["o"]), "radius": 3.0}),
    ("Torus", {"type": "torus", "frame": TILTED, "R": 4.0, "r": 1.0}, {"major_radius": 4.0, "minor_radius": 1.0}),
]


@pytest.mark.parametrize("name,geom,getters", CASES, ids=[f"{c[0]}-{i}" for i, c in enumerate(CASES)])
def test_recovers_tilted_frames(name, geom, getters):
    [part] = to_objects(fake(name, geom, **getters), "S")
    assert part["label"] == "S" and part["source"] == name
    got = part["geom"]
    assert got["type"] == geom["type"]
    assert_frame(got["frame"], geom["frame"])
    for key in set(geom) - {"type", "frame"}:
        assert got[key] == pytest.approx(geom[key])


def test_line_and_point():
    line = type("Line3D", (), {
        "origin": lambda self: Point3D(1, 2, 3),
        "direction": lambda self: Vector3D(0.0, 0.0, 1.0),
        "eval_point": lambda self, t: Point3D(1, 2, 3 + t),
    })()
    assert to_objects(line)[0]["geom"] == {"type": "line", "o": [1.0, 2.0, 3.0], "d": [0.0, 0.0, 1.0]}
    assert to_objects(Point3D(1, 2, 3), "A") == [{"label": "A", "geom": {"type": "point", "p": [1.0, 2.0, 3.0]}, "source": "Point3D"}]


def test_convention_mismatch_raises():
    geom = {"type": "ellipse", "frame": TILTED, "a": 3.0, "b": 2.0}
    lying = fake("Ellipse3D", geom, center=Point3D(*TILTED["o"]), major_radius=3.0, minor_radius=2.5)
    with pytest.raises(ValueError, match="convention"):
        to_objects(lying)


def test_points_result_gets_subscripted_labels():
    parts = to_objects(("points", [(0.1, Point3D(1, 0, 0), 0.2), (0.3, Point3D(0, 1, 0), 0.4)]), "P")
    assert [p["label"] for p in parts] == ["P₁", "P₂"]
    assert [p["geom"]["p"] for p in parts] == [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


@pytest.mark.parametrize("tag,text", [("empty", "P: ∅"), ("parallel", "P: ∅ (parallel)"), ("skew", "P: ∅ (skew)")])
def test_empty_results_become_notes(tag, text):
    assert to_objects((tag, None), "P") == [
        {"label": None, "key": "P·note", "geom": {"type": "note", "text": text, "level": "info"}}
    ]


def test_not_analytic_and_unknown_tags_warn():
    [note] = to_objects(("not_analytic", None), "X")
    assert note["geom"]["level"] == "warn" and "intersect_marching" in note["geom"]["text"]
    parts = to_objects(("bogus", Point3D(0, 0, 0)), "Y")
    assert parts[0]["geom"]["type"] == "point"
    assert parts[1]["geom"] == {"type": "note", "text": "Y: unrecognized result tag 'bogus'", "level": "warn"}


@pytest.mark.parametrize("tag", ["circle", "tangent"])
def test_known_tag_without_geometry_warns(tag):
    notes = [p["geom"] for p in to_objects((tag, None), "X")]
    warns = [g for g in notes if g["level"] == "warn"]
    assert len(warns) == 1
    assert warns[0]["text"] == f"X: result '{tag}' has no drawable geometry"


def test_points_tag_with_only_scalars_warns():
    [note] = to_objects(("points", [1.0, 2.0]), "X")
    assert note["geom"]["level"] == "warn" and "no drawable geometry" in note["geom"]["text"]


def test_tangent_result_draws_payload_and_notes_it():
    parts = to_objects(("tangent", (2.3, Point3D(1, 1, 0), -1.0)), "T")
    assert parts[0]["geom"] == {"type": "point", "p": [1.0, 1.0, 0.0]}
    assert parts[1]["geom"]["text"] == "T: tangent"


def test_lists():
    assert to_objects([], "Z")[0]["geom"]["text"] == "Z: ∅"
    assert len(to_objects([Point3D(0, 0, 0), Point3D(1, 0, 0)], "Q")) == 2
    with pytest.raises(TypeError, match="no geometry"):
        to_objects([1.0, 2.0])
    with pytest.raises(TypeError, match="object"):
        to_objects(object())


def test_bspline_surface_needs_window():
    surf = type("BSplineSurface", (), {"eval_point": lambda self, u, v: Point3D(u, v, 0.0)})()
    with pytest.raises(TypeError, match="u=.*v="):
        to_objects(surf)
    [part] = to_objects(surf, u=(0, 1), v=(0, 1))
    assert part["geom"]["type"] == "mesh"


def test_windows_and_extent():
    geoms = [{"type": "point", "p": [2.0, 0.0, 0.0]}, {"type": "circle", "frame": TILTED, "r": 1.0}]
    extent = scene_extent(geoms)
    assert extent == pytest.approx(1.5 * (math.sqrt(14) + 1.0))
    assert scene_extent([]) == 5.0
    plane = with_window({"type": "plane", "frame": TILTED}, 3.0)
    assert plane["window"] == {"u": [-3.0, 3.0], "v": [-3.0, 3.0]}
    cyl = with_window({"type": "cylinder", "frame": TILTED, "r": 1.0}, 3.0, v=(0, 2))
    assert cyl["window"] == {"u": [0.0, 2 * math.pi], "v": [0.0, 2.0]}
    point = {"type": "point", "p": [0, 0, 0]}
    assert with_window(point, 3.0) is point


def test_helpers():
    assert subscript(12) == "₁₂"
    assert as_vec((1, 2)) == [1.0, 2.0, 0.0]
    assert as_vec(Vector3D(1, 2, 3)) == [1.0, 2.0, 3.0]


# --- real geomcore (skipped when it is not importable) --------------------
def test_real_geomcore_types_round_trip():
    gc = pytest.importorskip("geomcore")
    from geomcore import Frame3D, Point2D, Point3D as P, Vector2D, Vector3D as V
    from geomcore.curves import Circle2D, Circle3D, Ellipse3D, Hyperbola3D, Line2D, Line3D, Parabola3D
    from geomcore.surfaces import Cone, Cylinder, Plane, Sphere, Torus

    tilted = Frame3D(P(1, 2, 3), V(1, 1, 1), V(1, -1, 0))
    curves = [
        Line3D(P(1, 2, 3), V(1, 1, 0)), Circle3D(P(2, 1, 0), V(0, 1, 1), 1.5),
        Ellipse3D.from_frame(tilted, 3.0, 2.0), Hyperbola3D.from_frame(tilted, 2.0, 1.0),
        Parabola3D.from_frame(tilted, 0.7), Line2D(Point2D(0, 1), Vector2D(1, 1)), Circle2D(Point2D(1, 1), 2.0),
    ]
    for curve in curves:
        [part] = to_objects(curve)
        for t in (-1.3, 0.0, 1.1, 2.5):
            assert eval_curve(part["geom"], t) == pytest.approx(as_vec(curve.eval_point(t)), abs=1e-9), type(curve).__name__
    surfaces = [
        Plane.from_frame(tilted), Cylinder.from_frame(tilted, 2.0), Cone.from_frame(tilted, 0.4, 2.0),
        Cone.from_frame(tilted, 0.4, 0.0),
        Sphere(P(1, 2, 3), 3.0), Torus(P(1, 2, 3), V(1, 1, 1), 4.0, 1.0),
    ]
    for surface in surfaces:
        [part] = to_objects(surface)
        for u, v in ((0.0, 0.0), (1.1, -0.4), (2.5, 0.9)):
            assert eval_surface(part["geom"], u, v) == pytest.approx(as_vec(surface.eval_point(u, v)), abs=1e-9), type(surface).__name__
    assert gc is not None


def test_real_geomcore_intersections():
    pytest.importorskip("geomcore")
    from geomcore import Frame3D, Point3D as P, Vector3D as V
    from geomcore.curves import Circle3D, Ellipse3D

    E = Ellipse3D.from_frame(Frame3D.world(), 3.0, 2.0)
    C = Circle3D(P(2, 1, 0), V.z(), 1.5)
    parts = to_objects(C.intersect_ellipse(E), "P")
    assert [p["label"] for p in parts] == ["P₁", "P₂"]
    far = Circle3D(P(9, 0, 0), V.z(), 1.0)
    assert to_objects(C.intersect_circle(far), "Q")[0]["geom"]["text"] == "Q: ∅"
