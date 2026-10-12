//! Conics and where they meet — the Rust twin of `examples/conics_2d.py`.
//!
//! Run:   python -m geomcore_viewer serve &   (once; any Python viewer script also starts it)
//!        cargo run --example conics --features geomcore
//! Save:  cargo run --example conics --features geomcore -- --save conics.json

use geomcore::{
    Circle3D, CircleConic3DIntersection, Ellipse3D, Frame3D, Hyperbola3D, Line3D, LineCircle3DIntersection,
    LineConic3DIntersection, Point3D, Tolerance, Vector3D,
};
use geomcore_viewer::{Opts, Viewer};

/// The points of a line ∩ conic result.
fn line_conic(hits: LineConic3DIntersection) -> Vec<Point3D> {
    match hits {
        LineConic3DIntersection::Points(a, b) => vec![a.point, b.point],
        LineConic3DIntersection::Tangent(a) => vec![a.point],
        _ => vec![],
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let save = std::env::args().skip_while(|a| a != "--save").nth(1);
    let mut view = Viewer::new("Conics and their intersections")?;
    let tol = Tolerance::DEFAULT;

    let e = Ellipse3D::from_frame(Frame3D::WORLD, 3.0, 2.0)?;
    let c = Circle3D::new(Point3D::new(2.0, 1.0, 0.0), Vector3D::Z, 1.5)?;
    let h = Hyperbola3D::from_frame(Frame3D::WORLD, 1.0, 0.5)?;
    let l = Line3D::new(Point3D::new(0.0, -3.0, 0.0), Vector3D::new(1.0, 1.0, 0.0))?;

    let conics = || Opts::new().group("conics");
    view.add(&e, conics().label("E").extra("foci", true))?;
    view.add(&c, conics().label("C"))?;
    view.add(&h, conics().label("H").extra("asymptotes", true))?;
    view.add(&l, conics().label("L"))?;

    let points = |label: &str| Opts::new().label(label).group("intersections");
    let p = match c.intersect_ellipse(&e, tol) {
        CircleConic3DIntersection::Points(hits) => hits.iter().map(|hit| hit.point).collect(),
        CircleConic3DIntersection::Tangent(hit) => vec![hit.point],
        _ => vec![],
    };
    view.add_all(p, points("P"))?;
    view.add_all(line_conic(l.intersect_ellipse(&e, tol)), points("Q"))?;
    let r = match l.intersect_circle(&c, tol) {
        LineCircle3DIntersection::Points((_, a), (_, b)) => vec![a, b],
        LineCircle3DIntersection::Tangent(_, a) => vec![a],
        _ => vec![],
    };
    view.add_all(r, points("R"))?;
    view.add_all(line_conic(l.intersect_hyperbola(&h, tol)), points("S"))?;

    if let Some(path) = save {
        println!("saved {}", view.save(path)?.display());
    }
    Ok(())
}
