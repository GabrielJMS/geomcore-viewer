"""Turn geomcore objects and intersection results into protocol-v2 geometry.

Dispatch is by class name + duck typing, so this module never imports
geomcore. geomcore-py exposes radii and centers but not orientation, so
analytic frames are recovered by evaluating the object at known parameters
(the parametrizations in protocol/SCENE.md, identical to geomcore's). Every
recovered geometry is re-evaluated at an extra parameter and compared with
``eval_point``: a convention mismatch raises instead of drawing a wrong
shape.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from .sampling import sample_curve, sample_surface_grid

TAU = 2.0 * math.pi
CHECK_TOL = 1e-9
_CHECK_T = 0.7
_CHECK_UV = (0.7, 0.3)
_BSPLINE_SEGMENTS = 256
_BSPLINE_GRID = 48

CURVES = frozenset({"Line3D", "Line2D", "Circle3D", "Circle2D", "Ellipse3D", "Parabola3D", "Hyperbola3D"})
SURFACES = frozenset({"Plane", "Cylinder", "Cone", "Sphere", "Torus"})
POINTS = frozenset({"Point3D", "Point2D"})
SAMPLED = frozenset({"BSplineCurve3D", "BSplineSurface"})
GEOMETRY = CURVES | SURFACES | POINTS | SAMPLED
SURFACE_TYPES = frozenset({"plane", "cylinder", "cone", "sphere", "torus"})

POINT_TAGS = frozenset({"point", "one_point", "tangent_point", "apex_point", "two_points", "points", "hits"})
CURVE_TAGS = frozenset({
    "line", "two_lines", "tangent_line", "circle", "two_circles", "tangent_circle", "ellipse", "parabola", "hyperbola",
})
EMPTY_NOTES = {"empty": "∅", "parallel": "∅ (parallel)", "skew": "∅ (skew)"}
INFO_NOTES = {
    "coincident": "coincident",
    "tangent": "tangent",
    "tangent_point": "tangent",
    "tangent_line": "tangent",
    "tangent_circle": "tangent",
    "apex_point": "through the apex",
}

# Full periods of closed parameter directions, and which directions are infinite.
_FULL_PERIOD = {
    "plane": {},
    "cylinder": {"u": [0.0, TAU]},
    "cone": {"u": [0.0, TAU]},
    "sphere": {"u": [0.0, TAU], "v": [-math.pi / 2, math.pi / 2]},
    "torus": {"u": [0.0, TAU], "v": [0.0, TAU]},
}
_INFINITE = {"plane": ("u", "v"), "cylinder": ("v",), "cone": ("v",), "sphere": (), "torus": ()}

_SUBSCRIPTS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def subscript(i: int) -> str:
    return str(i).translate(_SUBSCRIPTS)


# --- vectors ---------------------------------------------------------------
def as_vec(p) -> list[float]:
    """Point3D / Point2D / Vector2D / Vector3D / sequence → ``[x, y, z]`` floats."""
    if hasattr(p, "components"):  # Vector3D: .x is a static constructor there
        c = list(p.components())
    elif hasattr(p, "x") and not callable(p.x):
        c = [p.x, p.y, getattr(p, "z", 0.0)]
    else:
        c = list(p)
    if len(c) == 2:
        c.append(0.0)
    if len(c) != 3:
        raise TypeError(f"expected a 2D or 3D point/vector, got {p!r}")
    return [float(x) for x in c]


def _add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def _sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _mul(a, s):
    return [a[0] * s, a[1] * s, a[2] * s]


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _mid(a, b):
    return _mul(_add(a, b), 0.5)


def _unit(a):
    n = math.sqrt(_dot(a, a))
    if n == 0.0:
        raise ValueError("degenerate geometry: zero-length frame axis")
    return _mul(a, 1.0 / n)


def _frame(o, x, z) -> dict:
    """Right-handed orthonormal frame from an origin, an x hint and a z direction."""
    z = _unit(z)
    x = _unit(_sub(x, _mul(z, _dot(x, z))))
    return {"o": list(o), "x": x, "y": _cross(z, x), "z": z}


def _in_frame(f, cx, cy, cz=0.0):
    return _add(f["o"], _add(_mul(f["x"], cx), _add(_mul(f["y"], cy), _mul(f["z"], cz))))


# --- evaluators (mirror of protocol/SCENE.md and frontend/src/geom) -------
def eval_curve(g: dict, t: float) -> list[float]:
    kind = g["type"]
    if kind == "line":
        return _add(g["o"], _mul(g["d"], t))
    f = g["frame"]
    if kind == "circle":
        return _in_frame(f, g["r"] * math.cos(t), g["r"] * math.sin(t))
    if kind == "ellipse":
        return _in_frame(f, g["a"] * math.cos(t), g["b"] * math.sin(t))
    if kind == "parabola":
        return _in_frame(f, t * t / (4.0 * g["f"]), t)
    if kind == "hyperbola":
        return _in_frame(f, g["a"] * math.cosh(t), g["b"] * math.sinh(t))
    raise ValueError(f"not a curve: {kind}")


def eval_surface(g: dict, u: float, v: float) -> list[float]:
    kind, f = g["type"], g["frame"]
    if kind == "plane":
        return _in_frame(f, u, v)
    if kind == "cylinder":
        return _in_frame(f, g["r"] * math.cos(u), g["r"] * math.sin(u), v)
    if kind == "cone":
        radius = g["ref_radius"] + v * math.sin(g["semi_angle"])
        return _in_frame(f, radius * math.cos(u), radius * math.sin(u), v * math.cos(g["semi_angle"]))
    if kind == "sphere":
        rc = g["r"] * math.cos(v)
        return _in_frame(f, rc * math.cos(u), rc * math.sin(u), g["r"] * math.sin(v))
    if kind == "torus":
        rho = g["R"] + g["r"] * math.cos(v)
        return _in_frame(f, rho * math.cos(u), rho * math.sin(u), g["r"] * math.sin(v))
    raise ValueError(f"not a surface: {kind}")


def _check(name: str, want: list[float], got: list[float]) -> None:
    err = math.dist(want, got)
    if err > CHECK_TOL * max(1.0, math.hypot(*want)):
        raise ValueError(
            f"{name}: recovered geometry is off by {err:.3g} at the check parameter — "
            "geomcore's parametrization convention may have changed; please report it"
        )


# --- frame recovery ----------------------------------------------------------
def _curve_geom(obj, name: str) -> dict:
    def P(t):
        return as_vec(obj.eval_point(t))

    if name in ("Line3D", "Line2D"):
        return {"type": "line", "o": as_vec(obj.origin()), "d": as_vec(obj.direction())}
    if name in ("Circle3D", "Circle2D"):
        o = as_vec(obj.center())
        z = as_vec(obj.normal()) if name == "Circle3D" else [0.0, 0.0, 1.0]
        return {"type": "circle", "frame": _frame(o, _sub(P(0.0), o), z), "r": float(obj.radius())}
    if name == "Ellipse3D":
        o = as_vec(obj.center())
        x, y = _sub(P(0.0), o), _sub(P(math.pi / 2), o)
        return {"type": "ellipse", "frame": _frame(o, x, _cross(x, y)),
                "a": float(obj.major_radius()), "b": float(obj.minor_radius())}
    if name == "Hyperbola3D":
        o = as_vec(obj.center())
        x, y = _sub(P(0.0), o), _sub(P(1.0), P(-1.0))
        return {"type": "hyperbola", "frame": _frame(o, x, _cross(x, y)),
                "a": float(obj.major_radius()), "b": float(obj.minor_radius())}
    if name == "Parabola3D":
        o, focal = P(0.0), float(obj.focal())
        x = _mul(_sub(_add(P(1.0), P(-1.0)), _mul(o, 2.0)), focal)  # = x/2 whatever the sign of f
        y = _sub(P(1.0), P(-1.0))
        return {"type": "parabola", "frame": _frame(o, x, _cross(x, y)), "f": focal}
    raise TypeError(name)


def _surface_geom(obj, name: str) -> dict:
    def S(u, v):
        return as_vec(obj.eval_point(u, v))

    if name == "Plane":
        o = S(0.0, 0.0)
        x, y = _sub(S(1.0, 0.0), o), _sub(S(0.0, 1.0), o)
        return {"type": "plane", "frame": _frame(o, x, _cross(x, y))}
    if name == "Cylinder":
        a = S(0.0, 0.0)
        o = _mid(a, S(math.pi, 0.0))
        return {"type": "cylinder", "frame": _frame(o, _sub(a, o), _sub(S(0.0, 1.0), a)), "r": float(obj.radius())}
    if name == "Cone":
        phi, r0 = float(obj.semi_angle()), float(obj.ref_radius())
        c0 = _mid(S(0.0, 0.0), S(math.pi, 0.0))
        c1 = _mid(S(0.0, 1.0), S(math.pi, 1.0))
        ring = 0.0 if abs(r0) > 1e-12 else 1.0  # the v = 0 ring is a point when ref_radius = 0
        x = _sub(S(0.0, ring), c0 if ring == 0.0 else c1)
        if r0 + ring * math.sin(phi) < 0.0:
            x = _mul(x, -1.0)  # negative ring radius points the other way
        return {"type": "cone", "frame": _frame(c0, x, _sub(c1, c0)), "semi_angle": phi, "ref_radius": r0}
    if name == "Sphere":
        o = as_vec(obj.center())
        return {"type": "sphere", "frame": _frame(o, _sub(S(0.0, 0.0), o), _sub(S(0.0, math.pi / 2), o)),
                "r": float(obj.radius())}
    if name == "Torus":
        big, small = float(obj.major_radius()), float(obj.minor_radius())
        a = S(0.0, 0.0)
        o = _mid(a, S(math.pi, 0.0))
        x = _unit(_sub(a, o))
        z = _sub(_sub(S(0.0, math.pi / 2), o), _mul(x, big))
        return {"type": "torus", "frame": _frame(o, x, z), "R": big, "r": small}
    raise TypeError(name)


def _single(obj, label: str | None, u, v) -> list[dict]:
    name = type(obj).__name__
    if name in POINTS:
        geom = {"type": "point", "p": as_vec(obj)}
    elif name in CURVES:
        geom = _curve_geom(obj, name)
        _check(name, as_vec(obj.eval_point(_CHECK_T)), eval_curve(geom, _CHECK_T))
    elif name in SURFACES:
        geom = _surface_geom(obj, name)
        _check(name, as_vec(obj.eval_point(*_CHECK_UV)), eval_surface(geom, *_CHECK_UV))
    elif name == "BSplineCurve3D":
        t0, t1 = obj.bounds()
        geom = {"type": "polyline", "points": sample_curve(obj.eval_point, t0, t1, _BSPLINE_SEGMENTS)}
    elif name == "BSplineSurface":
        if u is None or v is None:
            raise TypeError("BSplineSurface has no domain getter in geomcore yet: pass u=(u0, u1) and v=(v0, v1)")
        vertices, indices = sample_surface_grid(obj.eval_point, u[0], u[1], v[0], v[1], _BSPLINE_GRID, _BSPLINE_GRID)
        geom = {"type": "mesh", "vertices": vertices, "indices": indices}
    else:
        raise TypeError(name)
    return [{"label": label, "geom": geom, "source": name}]


# --- results and containers --------------------------------------------------
def _leaves(payload) -> list:
    """Geometry objects anywhere inside a result payload (parameters are dropped)."""
    if payload is None:
        return []
    if type(payload).__name__ in GEOMETRY:
        return [payload]
    if isinstance(payload, (list, tuple)):
        return [leaf for item in payload for leaf in _leaves(item)]
    return []


def _labelled(items: list, label: str | None, u, v) -> list[dict]:
    if len(items) == 1:
        return _single(items[0], label, u, v)
    parts: list[dict] = []
    for i, item in enumerate(items, start=1):
        parts += _single(item, f"{label}{subscript(i)}" if label else None, u, v)
    return parts


def _note(text: str, label: str | None, level: str = "info") -> dict:
    return {
        "label": None,
        "key": f"{label}·note" if label else None,
        "geom": {"type": "note", "text": f"{label}: {text}" if label else text, "level": level},
    }


def _is_result(obj) -> bool:
    return isinstance(obj, tuple) and len(obj) == 2 and isinstance(obj[0], str)


def _result(tag: str, payload, label: str | None, u, v) -> list[dict]:
    if tag in EMPTY_NOTES:
        return [_note(EMPTY_NOTES[tag], label)]
    if tag == "not_analytic":
        return [_note("no closed form — try geomcore.intersect_marching", label, "warn")]
    leaves = _leaves(payload)
    parts = _labelled(leaves, label, u, v)
    if tag in INFO_NOTES:
        parts.append(_note(INFO_NOTES[tag], label))
    known = tag in INFO_NOTES or tag in POINT_TAGS or tag in CURVE_TAGS
    if not known:
        parts.append(_note(f"unrecognized result tag {tag!r}", label, "warn"))
    elif not leaves:
        # Last, so it wins over the info note when both share the same key.
        parts.append(_note(f"result {tag!r} has no drawable geometry", label, "warn"))
    return parts


def to_objects(obj, label: str | None = None, *, u=None, v=None) -> list[dict]:
    """Protocol parts for one ``add`` argument: a geomcore object, a ``(tag, payload)``
    intersection result, or a list/tuple of those."""
    if _is_result(obj):
        return _result(obj[0], obj[1], label, u, v)
    if type(obj).__name__ in GEOMETRY:
        return _single(obj, label, u, v)
    if isinstance(obj, (list, tuple)):
        if not obj:
            return [_note(EMPTY_NOTES["empty"], label)]
        leaves = _leaves(obj)
        if not leaves:
            raise TypeError(f"no geometry found in {type(obj).__name__} of length {len(obj)}")
        return _labelled(leaves, label, u, v)
    raise TypeError(
        f"cannot show {type(obj).__name__}: expected a geomcore curve, surface or point, "
        "an intersection result (tag, payload), or a list of those"
    )


# --- surface windows -----------------------------------------------------------
def scene_extent(geoms: Iterable[dict]) -> float:
    """Half-size for infinite surface windows: 1.5 × the farthest finite feature
    from the origin, or 5 for an empty scene."""
    reach = 0.0
    for g in geoms:
        kind = g["type"]
        if kind == "point":
            reach = max(reach, math.hypot(*g["p"]))
        elif kind in ("circle", "sphere"):
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["r"])
        elif kind == "ellipse":
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["a"])
        elif kind == "torus":
            reach = max(reach, math.hypot(*g["frame"]["o"]) + g["R"] + g["r"])
        elif kind == "polyline":
            reach = max([reach, *(math.hypot(*p) for p in g["points"])])
        elif kind == "mesh":
            reach = max([reach, *(math.hypot(*p) for p in g["vertices"])])
    return 1.5 * reach if reach > 0.0 else 5.0


def with_window(geom: dict, extent: float, u=None, v=None) -> dict:
    """A surface geom with ``window`` filled: explicit u/v, else full periods, else ±extent."""
    kind = geom["type"]
    if kind not in _INFINITE:
        return geom
    window = {d: list(r) for d, r in _FULL_PERIOD[kind].items()}
    for d in _INFINITE[kind]:
        window[d] = [-float(extent), float(extent)]
    if u is not None:
        window["u"] = [float(u[0]), float(u[1])]
    if v is not None:
        window["v"] = [float(v[0]), float(v[1])]
    return {**geom, "window": window}
