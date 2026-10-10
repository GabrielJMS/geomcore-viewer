//! Rust client for `geomcore-viewer` (scene protocol v1).
//!
//! Entities are pushed to the local viewer server over plain HTTP (`std`
//! only — no HTTP client dependency). `serde_json` builds the payloads.
//!
//! ```no_run
//! use geomcore_viewer::{Client, Entity};
//!
//! let client = Client::local();
//! client.add(&Entity::curve3d("circle", "#ff5533", vec![[2.0, 0.0, 0.0]]))?;
//! # Ok::<(), std::io::Error>(())
//! ```

use std::io::{Read, Write};
use std::net::TcpStream;

/// One scene entity. Use [`Entity::wire`] for the on-the-wire JSON
/// (`protocol/SCENE.md` field names).
#[derive(Debug, Clone)]
pub struct Entity {
    pub id: String,
    pub kind: &'static str,
    pub name: Option<String>,
    pub color: Option<String>,
    pub points: Option<Vec<[f64; 3]>>,
    pub points2d: Option<Vec<[f64; 2]>>,
    pub vertices: Option<Vec<[f64; 3]>>,
    pub indices: Option<Vec<u32>>,
    pub positions: Option<Vec<[f64; 3]>>,
    pub positions2d: Option<Vec<[f64; 2]>>,
    pub size: Option<f64>,
}

impl Entity {
    /// Raw JSON map used on the wire (`points2d` -> `points`, etc.).
    fn wire(&self) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        m.insert("id".into(), self.id.clone().into());
        m.insert("kind".into(), self.kind.into());
        if let Some(n) = &self.name {
            m.insert("name".into(), n.clone().into());
        }
        if let Some(c) = &self.color {
            m.insert("color".into(), c.clone().into());
        }
        if let Some(p) = &self.points {
            m.insert("points".into(), serde_json::to_value(p).unwrap());
        }
        if let Some(p) = &self.points2d {
            m.insert("points".into(), serde_json::to_value(p).unwrap());
        }
        if let Some(v) = &self.vertices {
            m.insert("vertices".into(), serde_json::to_value(v).unwrap());
        }
        if let Some(i) = &self.indices {
            m.insert("indices".into(), serde_json::to_value(i).unwrap());
        }
        if let Some(p) = &self.positions {
            m.insert("positions".into(), serde_json::to_value(p).unwrap());
        }
        if let Some(p) = &self.positions2d {
            m.insert("positions".into(), serde_json::to_value(p).unwrap());
        }
        if let Some(s) = self.size {
            m.insert("size".into(), s.into());
        }
        serde_json::Value::Object(m)
    }

    /// 3D polyline (`curve3d`).
    pub fn curve3d(id: &str, color: &str, points: Vec<[f64; 3]>) -> Self {
        Self::base(id, "curve3d", color, |e| e.points = Some(points))
    }

    /// 2D polyline in parameter space (`curve2d`).
    pub fn curve2d(id: &str, color: &str, points: Vec<[f64; 2]>) -> Self {
        Self::base(id, "curve2d", color, |e| e.points2d = Some(points))
    }

    /// Triangulated surface (`surface`).
    pub fn surface(id: &str, color: &str, vertices: Vec<[f64; 3]>, indices: Vec<u32>) -> Self {
        Self::base(id, "surface", color, |e| {
            e.vertices = Some(vertices);
            e.indices = Some(indices);
        })
    }

    fn base(id: &str, kind: &'static str, color: &str, fill: impl FnOnce(&mut Self)) -> Self {
        let mut e = Self {
            id: id.into(),
            kind,
            name: Some(id.into()),
            color: Some(color.into()),
            points: None,
            points2d: None,
            vertices: None,
            indices: None,
            positions: None,
            positions2d: None,
            size: None,
        };
        fill(&mut e);
        e
    }
}

/// Pushes entities to a running viewer server (`POST /api/add`).
pub struct Client {
    host: String,
    port: u16,
}

impl Client {
    /// Default local server address (`127.0.0.1:8765`).
    pub fn local() -> Self {
        Self { host: "127.0.0.1".into(), port: 8765 }
    }

    pub fn new(host: &str, port: u16) -> Self {
        Self { host: host.into(), port }
    }

    /// Upsert one entity (replaces any entity with the same `id`).
    pub fn add(&self, entity: &Entity) -> std::io::Result<()> {
        self.post("/api/add", &entity.wire().to_string())
    }

    /// Empty the scene.
    pub fn clear(&self) -> std::io::Result<()> {
        self.post("/api/clear", "{}")
    }

    /// The server only answers requests whose `Host` names it (with its port).
    fn request(&self, path: &str, body: &str) -> String {
        format!(
            "POST {path} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            self.host,
            self.port,
            body.len()
        )
    }

    fn post(&self, path: &str, body: &str) -> std::io::Result<()> {
        let mut stream = TcpStream::connect((self.host.as_str(), self.port))?;
        let req = self.request(path, body);
        stream.write_all(req.as_bytes())?;
        let mut head = [0u8; 12];
        stream.read_exact(&mut head)?;
        if !head.starts_with(b"HTTP/1.") {
            return Err(std::io::Error::new(std::io::ErrorKind::Other, "bad HTTP response"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_names_host_and_port_and_sends_json() {
        let req = Client::new("127.0.0.1", 8799).request("/api/clear", "{}");
        assert!(req.starts_with("POST /api/clear HTTP/1.1\r\nHost: 127.0.0.1:8799\r\n"));
        assert!(req.contains("Content-Type: application/json\r\n"));
        assert!(req.ends_with("\r\n\r\n{}"));
    }

    #[test]
    fn wire_format_matches_protocol() {
        let e = Entity::curve3d("c", "#ff5533", vec![[2.0, 0.0, 0.0]]);
        let w = e.wire();
        assert_eq!(w["id"], "c");
        assert_eq!(w["kind"], "curve3d");
        assert_eq!(w["points"][0][0], 2.0);
        assert!(w.get("points2d").is_none());
    }

    #[test]
    fn surface_wire_format() {
        let e = Entity::surface("s", "#4d94ff", vec![[0.0, 0.0, 0.0]], vec![0, 1, 2]);
        let w = e.wire();
        assert_eq!(w["kind"], "surface");
        assert_eq!(w["indices"][2], 2);
    }
}
