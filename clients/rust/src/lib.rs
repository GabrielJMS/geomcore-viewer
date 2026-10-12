//! Rust client for `geomcore-viewer`: show geometry live in the browser viewer
//! (scene protocol v2, `protocol/SCENE.md`).

mod geom;
mod object;

pub use geom::{Frame, Geom, NoteLevel, Vec3, Window};
pub use object::{indexed, Object, Opts, Style, EXTRAS, PALETTE};
