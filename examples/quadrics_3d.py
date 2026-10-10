"""Sphere ∩ cylinder and plane ∩ cone — intersection curves in 3D.

Run:  python examples/quadrics_3d.py   (needs geomcore)
"""

from __future__ import annotations

from geomcore import Frame3D, Point3D, Vector3D
from geomcore.surfaces import Cone, Cylinder, Plane, Sphere

import geomcore_viewer as gv

view = gv.Viewer("Quadric intersections")

S = Sphere(Point3D.origin(), 3.0)
Y = Cylinder(Point3D.origin(), Vector3D.z(), 2.0)
view.add(S, label="S", opacity=0.4, group="sphere ∩ cylinder")
view.add(Y, label="Y", opacity=0.4, v=(-3.5, 3.5), group="sphere ∩ cylinder")
view.add(S.intersect_cylinder(Y), label="SY", group="sphere ∩ cylinder")

K = Cone.from_frame(Frame3D(Point3D(9.0, 0.0, 0.0), Vector3D.z(), Vector3D.x()), 0.4, 2.0)
P = Plane(Point3D(9.0, 0.0, 1.0), Vector3D.z())
view.add(K, label="K", opacity=0.4, v=(-4.0, 4.0), group="plane ∩ cone")
view.add(P, label="Π", opacity=0.3, u=(-4.0, 4.0), v=(-4.0, 4.0), group="plane ∩ cone")
view.add(P.intersect_cone(K), label="ΠK", group="plane ∩ cone")
