//! geomcore types as [`Geom`] (cargo feature `geomcore`).
//!
//! Analytic curves and surfaces keep their exact definition: the frame and radii
//! come from geomcore's getters, so the viewer evaluates the same parametrization
//! (checked against `eval_point` in the tests). B-splines have no wire type yet and
//! are sampled, like the Python client does: a curve as a 256-segment polyline, a
//! surface as a 48 × 48 mesh over its parameter bounds.

use geomcore::curves::{ParametricCurve2D, ParametricCurve3D};
use geomcore::surfaces::ParametricSurface;
use geomcore::{
    BSplineCurve3D, BSplineSurface, Circle2D, Circle3D, Cone, Curve2D, Curve3D, Cylinder, Ellipse3D, Frame3D,
    Hyperbola3D, Line2D, Line3D, Parabola3D, Plane, Point2D, Point3D, Sphere, Surface, Torus, Vector3D,
};

use crate::geom::{cross, Frame, Geom, Vec3};

const BSPLINE_SEGMENTS: usize = 256;
const BSPLINE_GRID: usize = 48;
/// Where a curve or surface of a kind added to geomcore later is sampled when its bounds are infinite.
const UNBOUNDED: f64 = 100.0;

fn p3(p: Point3D) -> Vec3 {
    [p.x, p.y, p.z]
}

fn v3(v: Vector3D) -> Vec3 {
    [v.x, v.y, v.z]
}

fn frame(f: Frame3D) -> Frame {
    Frame { o: p3(f.origin()), x: v3(f.x_direction()), y: v3(f.y_direction()), z: v3(f.z_direction()) }
}

fn sample(eval: impl Fn(f64) -> Vec3, (t0, t1): (f64, f64)) -> Geom {
    let (t0, t1) = (t0.max(-UNBOUNDED), t1.min(UNBOUNDED));
    Geom::polyline((0..=BSPLINE_SEGMENTS).map(|i| eval(t0 + (t1 - t0) * i as f64 / BSPLINE_SEGMENTS as f64)).collect())
}

/// An (n + 1)² vertex grid, two triangles per cell.
fn grid(eval: impl Fn(f64, f64) -> Vec3, (u0, u1): (f64, f64), (v0, v1): (f64, f64)) -> Geom {
    let n = BSPLINE_GRID;
    let (u0, u1, v0, v1) = (u0.max(-UNBOUNDED), u1.min(UNBOUNDED), v0.max(-UNBOUNDED), v1.min(UNBOUNDED));
    let mut vertices = Vec::with_capacity((n + 1) * (n + 1));
    for i in 0..=n {
        for j in 0..=n {
            vertices.push(eval(u0 + (u1 - u0) * i as f64 / n as f64, v0 + (v1 - v0) * j as f64 / n as f64));
        }
    }
    let mut indices = Vec::with_capacity(6 * n * n);
    for i in 0..n {
        for j in 0..n {
            let a = (i * (n + 1) + j) as u32;
            let b = a + (n + 1) as u32;
            indices.extend([a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    Geom::mesh(vertices, indices)
}

impl From<Point3D> for Geom {
    fn from(p: Point3D) -> Geom {
        Geom::point(p3(p))
    }
}

impl From<Point2D> for Geom {
    fn from(p: Point2D) -> Geom {
        Geom::point([p.x, p.y, 0.0])
    }
}

impl From<&Line3D> for Geom {
    fn from(c: &Line3D) -> Geom {
        Geom::line(p3(c.origin()), v3(c.direction()))
    }
}

impl From<&Circle3D> for Geom {
    fn from(c: &Circle3D) -> Geom {
        Geom::circle(frame(c.frame()), c.radius())
    }
}

impl From<&Ellipse3D> for Geom {
    fn from(c: &Ellipse3D) -> Geom {
        Geom::ellipse(frame(c.frame()), c.major_radius(), c.minor_radius())
    }
}

impl From<&Parabola3D> for Geom {
    fn from(c: &Parabola3D) -> Geom {
        Geom::parabola(frame(c.frame()), c.focal())
    }
}

impl From<&Hyperbola3D> for Geom {
    fn from(c: &Hyperbola3D) -> Geom {
        Geom::hyperbola(frame(c.frame()), c.major_radius(), c.minor_radius())
    }
}

impl From<&BSplineCurve3D> for Geom {
    fn from(c: &BSplineCurve3D) -> Geom {
        sample(|t| p3(c.eval_point(t)), c.bounds())
    }
}

impl From<&Curve3D> for Geom {
    fn from(c: &Curve3D) -> Geom {
        match c {
            Curve3D::Line(c) => c.into(),
            Curve3D::Circle(c) => c.into(),
            Curve3D::Ellipse(c) => c.into(),
            Curve3D::Parabola(c) => c.into(),
            Curve3D::Hyperbola(c) => c.into(),
            Curve3D::BSpline(c) => c.into(),
            other => sample(|t| p3(other.eval_point(t)), other.bounds()),
        }
    }
}

/// A 2D line in z = 0 — as a pcurve, its x, y are the surface's u, v.
impl From<&Line2D> for Geom {
    fn from(c: &Line2D) -> Geom {
        let (o, d) = (c.origin(), c.direction());
        Geom::line([o.x, o.y, 0.0], [d.x, d.y, 0.0])
    }
}

/// A 2D circle in z = 0, with its own frame (either handedness: z is x × y).
impl From<&Circle2D> for Geom {
    fn from(c: &Circle2D) -> Geom {
        let f = c.frame();
        let (o, x, y) = (f.origin(), f.x_direction(), f.y_direction());
        let (x, y) = ([x.x, x.y, 0.0], [y.x, y.y, 0.0]);
        Geom::circle(Frame { o: [o.x, o.y, 0.0], x, y, z: cross(x, y) }, c.radius())
    }
}

impl From<&Curve2D> for Geom {
    fn from(c: &Curve2D) -> Geom {
        match c {
            Curve2D::Line(c) => c.into(),
            Curve2D::Circle(c) => c.into(),
            other => sample(
                |t| {
                    let p = other.eval_point(t);
                    [p.x, p.y, 0.0]
                },
                other.bounds(),
            ),
        }
    }
}

impl From<&Plane> for Geom {
    fn from(s: &Plane) -> Geom {
        Geom::plane(frame(s.frame()))
    }
}

impl From<&Cylinder> for Geom {
    fn from(s: &Cylinder) -> Geom {
        Geom::cylinder(frame(s.frame()), s.radius())
    }
}

impl From<&Cone> for Geom {
    fn from(s: &Cone) -> Geom {
        Geom::cone(frame(s.frame()), s.semi_angle(), s.ref_radius())
    }
}

impl From<&Sphere> for Geom {
    fn from(s: &Sphere) -> Geom {
        Geom::sphere(frame(s.frame()), s.radius())
    }
}

impl From<&Torus> for Geom {
    fn from(s: &Torus) -> Geom {
        Geom::torus(frame(s.frame()), s.major_radius(), s.minor_radius())
    }
}

/// A mesh over the surface's parameter bounds.
impl From<&BSplineSurface> for Geom {
    fn from(s: &BSplineSurface) -> Geom {
        grid(|u, v| p3(s.eval_point(u, v)), s.u_bounds(), s.v_bounds())
    }
}

impl From<&Surface> for Geom {
    fn from(s: &Surface) -> Geom {
        match s {
            Surface::Plane(s) => s.into(),
            Surface::Cylinder(s) => s.into(),
            Surface::Cone(s) => s.into(),
            Surface::Sphere(s) => s.into(),
            Surface::Torus(s) => s.into(),
            Surface::BSpline(s) => s.into(),
            other => grid(|u, v| p3(other.eval_point(u, v)), other.u_bounds(), other.v_bounds()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use geomcore::{Axis3D, Transform, Vector2D};

    const TOL: f64 = 1e-9;

    /// The protocol's parametrizations (`protocol/SCENE.md`), as the viewer evaluates them.
    fn eval_curve(g: &Geom, t: f64) -> Vec3 {
        let at = |f: &Frame, a: f64, b: f64| -> Vec3 { std::array::from_fn(|k| f.o[k] + a * f.x[k] + b * f.y[k]) };
        match g {
            Geom::Line { o, d, .. } => std::array::from_fn(|k| o[k] + t * d[k]),
            Geom::Circle { frame: f, r, .. } => at(f, r * t.cos(), r * t.sin()),
            Geom::Ellipse { frame: f, a, b, .. } => at(f, a * t.cos(), b * t.sin()),
            Geom::Parabola { frame: f, f: focal, .. } => at(f, t * t / (4.0 * focal), t),
            Geom::Hyperbola { frame: f, a, b, .. } => at(f, a * t.cosh(), b * t.sinh()),
            _ => panic!("not a curve: {g:?}"),
        }
    }

    fn eval_surface(g: &Geom, u: f64, v: f64) -> Vec3 {
        let at = |f: &Frame, a: f64, b: f64, c: f64| -> Vec3 {
            std::array::from_fn(|k| f.o[k] + a * f.x[k] + b * f.y[k] + c * f.z[k])
        };
        match g {
            Geom::Plane { frame: f, .. } => at(f, u, v, 0.0),
            Geom::Cylinder { frame: f, r, .. } => at(f, r * u.cos(), r * u.sin(), v),
            Geom::Cone { frame: f, semi_angle, ref_radius, .. } => {
                let radius = ref_radius + v * semi_angle.sin();
                at(f, radius * u.cos(), radius * u.sin(), v * semi_angle.cos())
            }
            Geom::Sphere { frame: f, r, .. } => at(f, r * v.cos() * u.cos(), r * v.cos() * u.sin(), r * v.sin()),
            Geom::Torus { frame: f, major, minor, .. } => {
                let rho = major + minor * v.cos();
                at(f, rho * u.cos(), rho * u.sin(), minor * v.sin())
            }
            _ => panic!("not a surface: {g:?}"),
        }
    }

    fn close(want: Point3D, got: Vec3) {
        let want = p3(want);
        let err = (0..3).map(|k| (want[k] - got[k]).powi(2)).sum::<f64>().sqrt();
        assert!(err <= TOL * want.iter().map(|x| x * x).sum::<f64>().sqrt().max(1.0), "{want:?} vs {got:?}");
    }

    const TS: [f64; 5] = [-1.3, -0.2, 0.0, 0.7, 2.9];

    fn p(x: f64, y: f64, z: f64) -> Point3D {
        Point3D::new(x, y, z)
    }

    fn v(x: f64, y: f64, z: f64) -> Vector3D {
        Vector3D::new(x, y, z)
    }

    #[test]
    fn analytic_curves_evaluate_like_geomcore() {
        let n = v(0.3, -0.5, 0.8);
        let curves: Vec<Curve3D> = vec![
            Line3D::new(p(1.0, 2.0, 3.0), v(0.2, 0.4, -1.0)).unwrap().into(),
            Circle3D::new(p(1.0, -2.0, 0.5), n, 2.5).unwrap().into(),
            Ellipse3D::new(p(-1.0, 0.0, 2.0), n, v(1.0, 1.0, 0.0), 3.0, 1.2).unwrap().into(),
            Parabola3D::new(p(0.0, 1.0, 0.0), n, v(0.0, 1.0, 1.0), 0.7).unwrap().into(),
            Hyperbola3D::new(p(2.0, 2.0, 2.0), n, v(1.0, 0.0, 0.0), 1.5, 0.5).unwrap().into(),
        ];
        for c in &curves {
            let g = Geom::from(c);
            for t in TS {
                close(c.eval_point(t), eval_curve(&g, t));
            }
        }
    }

    #[test]
    fn a_mirrored_circle_still_evaluates_like_geomcore() {
        let mirror = Transform::mirror_axis(Axis3D::new(Point3D::ORIGIN, Vector3D::X).unwrap());
        let c = Circle3D::new(p(1.0, 2.0, 0.0), v(0.0, 0.0, 1.0), 1.0).unwrap().transformed(mirror).unwrap();
        let g = Geom::from(&c);
        for t in TS {
            close(c.eval_point(t), eval_curve(&g, t));
        }
    }

    #[test]
    fn analytic_surfaces_evaluate_like_geomcore() {
        let axis = v(0.3, -0.5, 0.8);
        let turn = Transform::rotation(Axis3D::new(p(1.0, 0.0, 0.0), v(1.0, 1.0, 0.0)).unwrap(), 0.6);
        let surfaces: Vec<Surface> = vec![
            Plane::new(p(1.0, 2.0, 3.0), axis).unwrap().into(),
            Cylinder::new(p(0.0, 1.0, 0.0), axis, 2.0).unwrap().into(),
            Cone::new(p(1.0, 1.0, 1.0), axis, 0.4, 1.5).unwrap().into(),
            Cone::new(p(0.0, 0.0, 0.0), axis, 0.4, 0.0).unwrap().into(),
            Sphere::new(p(-1.0, 2.0, 0.5), 3.0).unwrap().transformed(turn).unwrap().into(),
            Torus::new(p(0.0, 0.0, 1.0), axis, 3.0, 1.0).unwrap().into(),
        ];
        for s in &surfaces {
            let g = Geom::from(s);
            for (u, w) in [(0.0, 0.0), (0.7, 0.3), (2.0, -1.1), (5.5, 1.4)] {
                close(s.eval_point(u, w), eval_surface(&g, u, w));
            }
        }
    }

    #[test]
    fn pcurves_from_parametrize_on_read_as_u_v() {
        let cylinder = Cylinder::new(Point3D::ORIGIN, v(0.0, 0.0, 1.0), 2.0).unwrap();
        let ring = Circle3D::new(p(0.0, 0.0, 3.0), v(0.0, 0.0, 1.0), 2.0).unwrap();
        let pc = ring.parametrize_on(cylinder).unwrap();
        assert_eq!(Geom::from(&pc), Geom::line([0.0, 3.0, 0.0], [1.0, 0.0, 0.0]));
        let plane = Plane::new(Point3D::ORIGIN, v(0.0, 0.0, 1.0)).unwrap();
        let circle = Circle3D::new(p(1.0, 1.0, 0.0), v(0.0, 0.0, 1.0), 1.0).unwrap();
        let g = Geom::from(&circle.parametrize_on(plane).unwrap());
        for t in TS {
            let (uv, xyz) = (eval_curve(&g, t), circle.eval_point(t));
            close(plane.eval_point(uv[0], uv[1]), p3(xyz));
        }
    }

    #[test]
    fn a_clockwise_2d_circle_keeps_its_direction() {
        let f = geomcore::Frame2D::new(Point2D::new(1.0, 2.0), Vector2D::X, Vector2D::new(0.0, -1.0)).unwrap();
        let c = Circle2D::from_frame(f, 2.0).unwrap();
        let g = Geom::from(&c);
        for t in TS {
            let want = c.eval_point(t);
            close(p(want.x, want.y, 0.0), eval_curve(&g, t));
        }
    }

    #[test]
    fn b_splines_are_sampled_over_their_bounds() {
        let poles = vec![p(0.0, 0.0, 0.0), p(1.0, 2.0, 0.0), p(3.0, 2.0, 1.0), p(4.0, 0.0, 0.0)];
        let c = BSplineCurve3D::new(3, poles, vec![0.0, 1.0], vec![4, 4], false).unwrap();
        let Geom::Polyline { points } = Geom::from(&c) else { panic!() };
        assert_eq!(points.len(), BSPLINE_SEGMENTS + 1);
        close(c.eval_point(0.0), points[0]);
        close(c.eval_point(1.0), points[BSPLINE_SEGMENTS]);
        let grid = vec![vec![p(0.0, 0.0, 0.0), p(0.0, 1.0, 0.0)], vec![p(1.0, 0.0, 0.0), p(1.0, 1.0, 1.0)]];
        let s = BSplineSurface::new(1, 1, grid, vec![0.0, 1.0], vec![2, 2], vec![0.0, 1.0], vec![2, 2], false, false)
            .unwrap();
        let Geom::Mesh { vertices, indices } = Geom::from(&s) else { panic!() };
        assert_eq!((vertices.len(), indices.len()), ((BSPLINE_GRID + 1).pow(2), 6 * BSPLINE_GRID * BSPLINE_GRID));
        close(s.eval_point(1.0, 1.0), *vertices.last().unwrap());
        assert!(Geom::mesh(vertices, indices).problem().is_none());
    }

    #[test]
    fn points_and_2d_points() {
        assert_eq!(Geom::from(p(1.0, 2.0, 3.0)), Geom::point([1.0, 2.0, 3.0]));
        assert_eq!(Geom::from(Point2D::new(1.0, 2.0)), Geom::point([1.0, 2.0, 0.0]));
    }
}
