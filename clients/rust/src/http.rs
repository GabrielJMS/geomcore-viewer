//! Just enough HTTP/1.1 for the viewer's local API, on `std` alone.

use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde_json::Value;

pub(crate) const APP: &str = "geomcore-viewer";
pub(crate) const PROTOCOL: u64 = 2;

/// Where the server listens, from an `http://host[:port][/]` URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Endpoint {
    pub host: String,
    pub port: u16,
}

impl Endpoint {
    /// A URL without a port means port 80, as `http://` says.
    pub fn parse(url: &str) -> Result<Endpoint, String> {
        let rest = url.strip_prefix("http://").ok_or_else(|| format!("{url:?}: only http:// URLs are supported"))?;
        let authority = rest.strip_suffix('/').unwrap_or(rest);
        if authority.contains('/') {
            return Err(format!("{url:?}: the URL must not have a path"));
        }
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) => {
                let port = port.parse::<u16>().map_err(|_| format!("{url:?} has a malformed port"))?;
                (host, port)
            }
            None => (authority, 80),
        };
        if host.is_empty() {
            return Err(format!("{url:?} has no host"));
        }
        Ok(Endpoint { host: host.into(), port })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Response {
    pub status: u16,
    pub body: String,
}

/// The request bytes: the server checks that `Host` names it, port included.
pub(crate) fn format_request(ep: &Endpoint, method: &str, path: &str, body: Option<&str>) -> String {
    let body = body.unwrap_or("");
    format!(
        "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        ep.host,
        ep.port,
        body.len()
    )
}

/// One request and its whole response. Connection, timeout and read errors are
/// `io::Error`s; an answer that is not HTTP is `ErrorKind::InvalidData`.
pub(crate) fn request(
    ep: &Endpoint,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
) -> io::Result<Response> {
    let mut last = io::Error::new(io::ErrorKind::NotFound, format!("{} resolves to no address", ep.host));
    let mut stream = None;
    for addr in (ep.host.as_str(), ep.port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(err) => last = err,
        }
    }
    let mut stream = stream.ok_or(last)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(format_request(ep, method, path, body).as_bytes())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    parse_response(&raw).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not an HTTP response"))
}

fn parse_response(raw: &[u8]) -> Option<Response> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = head.split("\r\n");
    let mut status_line = lines.next()?.split_whitespace();
    if !status_line.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let status = status_line.next()?.parse().ok()?;
    let mut body = &raw[split + 4..];
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                let n: usize = value.trim().parse().ok()?;
                body = body.get(..n)?; // a body cut short is not a whole response
            }
        }
    }
    Some(Response { status, body: String::from_utf8_lossy(body).into_owned() })
}

/// What answers at an endpoint (Python: `spawn.probe`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Probe {
    /// A v2 geomcore-viewer.
    Ours,
    /// A geomcore-viewer that rejects this `Host` (a tunnel that changes the port).
    Refused,
    /// Something else.
    Foreign,
    /// Something accepts the connection but does not answer in time.
    Unresponsive,
    /// Nothing listens.
    Nothing,
}

pub(crate) fn probe(ep: &Endpoint, timeout: Duration) -> Probe {
    let res = match request(ep, "GET", "/api/health", None, timeout) {
        Ok(res) => res,
        Err(err) if err.kind() == io::ErrorKind::InvalidData => return Probe::Foreign,
        Err(err) if matches!(err.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock) => {
            return Probe::Unresponsive
        }
        Err(_) => return Probe::Nothing,
    };
    let doc: Value = serde_json::from_str(&res.body).unwrap_or(Value::Null);
    let ours = doc.get("app").and_then(Value::as_str) == Some(APP);
    match res.status {
        200 if ours && doc.get("protocol").and_then(Value::as_u64) == Some(PROTOCOL) => Probe::Ours,
        403 if ours => Probe::Refused,
        _ => Probe::Foreign,
    }
}

/// What to tell the user when a geomcore-viewer refuses `url` (Python: `spawn.refused_hint`).
pub(crate) fn refused_hint(url: &str, port: u16) -> String {
    format!(
        "the geomcore-viewer at {url} refused the request: it only answers to its own address, \
         so an SSH tunnel must keep the port (ssh -L {port}:127.0.0.1:{port} <host>)"
    )
}

#[cfg(test)]
pub(crate) mod stub {
    //! A scripted local server for tests: answers each request with `answer(method, path, body)`
    //! and records what it received.

    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    pub type Seen = Arc<Mutex<Vec<(String, String, String)>>>;

    pub fn serve(answer: impl Fn(&str, &str, &str) -> (u16, String) + Send + 'static) -> (u16, Seen) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen: Seen = Arc::default();
        let log = Arc::clone(&seen);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
                let mut length = 0;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header == "\r\n" || header.is_empty() {
                        break;
                    }
                    if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body = String::from_utf8(body).unwrap();
                let (status, reply) = answer(&method, &path, &body);
                log.lock().unwrap().push((method, path, body));
                let _ = write!(
                    stream,
                    "HTTP/1.0 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        (port, seen)
    }

    /// A geomcore-viewer that accepts everything.
    pub fn viewer() -> (u16, Seen) {
        serve(|_, path, _| {
            let body =
                if path == "/api/health" { r#"{"app": "geomcore-viewer", "protocol": 2}"# } else { r#"{"ok": true}"# };
            (200, body.into())
        })
    }

    /// A port where nothing listens.
    pub fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn local(port: u16) -> Endpoint {
        Endpoint { host: "127.0.0.1".into(), port }
    }

    const T: Duration = Duration::from_millis(500);

    #[test]
    fn parses_urls_like_the_python_client() {
        assert_eq!(Endpoint::parse("http://127.0.0.1:8799"), Ok(local(8799)));
        assert_eq!(Endpoint::parse("http://localhost:8799/"), Ok(Endpoint { host: "localhost".into(), port: 8799 }));
        assert_eq!(Endpoint::parse("http://127.0.0.1"), Ok(local(80)), "no port means 80");
        assert!(Endpoint::parse("https://127.0.0.1:8799").unwrap_err().contains("only http://"));
        assert!(Endpoint::parse("http://127.0.0.1:87x9").unwrap_err().contains("malformed port"));
        assert!(Endpoint::parse("http://127.0.0.1:8799/viewer").unwrap_err().contains("path"));
        assert!(Endpoint::parse("http://:8799").unwrap_err().contains("no host"));
    }

    #[test]
    fn request_names_host_and_port_and_sends_json() {
        let req = format_request(&local(8799), "POST", "/api/clear", Some("{}"));
        assert!(req.starts_with("POST /api/clear HTTP/1.1\r\nHost: 127.0.0.1:8799\r\n"));
        assert!(req.contains("Content-Type: application/json\r\nContent-Length: 2\r\n"));
        assert!(req.ends_with("\r\n\r\n{}"));
    }

    #[test]
    fn reads_the_whole_response() {
        let long = format!("{{\"error\": \"{}\"}}", "x".repeat(5000));
        let reply = long.clone();
        let (port, seen) = stub::serve(move |_, _, _| (400, reply.clone()));
        let res = request(&local(port), "POST", "/api/objects", Some(r#"{"objects": []}"#), T).unwrap();
        assert_eq!(res, Response { status: 400, body: long });
        assert_eq!(seen.lock().unwrap()[0], ("POST".into(), "/api/objects".into(), r#"{"objects": []}"#.into()));
    }

    #[test]
    fn parse_response_rejects_what_is_not_http() {
        assert_eq!(parse_response(b"SSH-2.0-OpenSSH\r\n\r\n"), None);
        assert_eq!(parse_response(b"HTTP/1.0 200 OK\r\nContent-Length: 10\r\n\r\nshort"), None);
        assert_eq!(
            parse_response(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\n{}"),
            Some(Response { status: 200, body: "{}".into() })
        );
    }

    #[test]
    fn probe_tells_who_answers() {
        assert_eq!(probe(&local(stub::viewer().0), T), Probe::Ours);
        let (refusing, _) = stub::serve(|_, _, _| (403, r#"{"error": "no", "app": "geomcore-viewer"}"#.into()));
        assert_eq!(probe(&local(refusing), T), Probe::Refused);
        let (other, _) = stub::serve(|_, _, _| (200, "<html></html>".into()));
        assert_eq!(probe(&local(other), T), Probe::Foreign);
        let (old, _) = stub::serve(|_, _, _| (200, r#"{"app": "geomcore-viewer", "protocol": 1}"#.into()));
        assert_eq!(probe(&local(old), T), Probe::Foreign);
        assert_eq!(probe(&local(stub::closed_port()), T), Probe::Nothing);
    }

    #[test]
    fn probe_gives_up_on_a_server_that_never_answers() {
        let hung = TcpListener::bind("127.0.0.1:0").unwrap(); // accepts (backlog) but never replies
        let port = hung.local_addr().unwrap().port();
        assert_eq!(probe(&local(port), Duration::from_millis(200)), Probe::Unresponsive);
    }

    #[test]
    fn refused_hint_keeps_the_port() {
        let hint = refused_hint("http://127.0.0.1:8799", 8799);
        assert!(hint.ends_with("(ssh -L 8799:127.0.0.1:8799 <host>)"), "{hint}");
    }
}
