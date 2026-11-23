//! The Rust regex engine of regex-bench, exposed to JavaScript as a plain C-ABI WebAssembly module
//! (see docs/Decisions/ADR-006-rust-core-c-abi.md).
//!
//! Protocol: the host calls `alloc(len)`, writes a UTF-8 JSON request there, then calls `run(ptr, len)`.
//! `run` returns a pointer to a buffer that starts with a little-endian u32 length followed by that many bytes of
//! UTF-8 JSON. The host frees both buffers with `dealloc(ptr, len)` (the response's len includes the 4-byte
//! prefix).
//!
//! All positions in responses are UTF-16 code unit offsets, so they index JavaScript strings directly.

use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub pattern: String,
    #[serde(default)]
    pub flags: String,
    #[serde(default)]
    pub text: String,
    /// Find every match (true) or only the first one.
    #[serde(default = "yes")]
    pub global: bool,
    /// Stop after this many matches.
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn yes() -> bool {
    true
}
fn default_limit() -> usize {
    10_000
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub matches: Vec<Match>,
    /// Group names by group index (index 0 is the whole match and has no name).
    pub group_names: Vec<Option<String>>,
    pub capped: bool,
}

#[derive(Serialize)]
pub struct Match {
    pub start: usize,
    pub end: usize,
    /// `[start, end]` of each capture group (1-based groups at index 0..), or null when it didn't participate.
    pub groups: Vec<Option<[usize; 2]>>,
}

fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Runs a request. Pure Rust; the C ABI below only moves bytes.
pub fn execute(req: &Request) -> Response {
    let mut b = RegexBuilder::new(&req.pattern);
    b.size_limit(32 * 1024 * 1024).dfa_size_limit(32 * 1024 * 1024).nest_limit(500);
    for f in req.flags.chars() {
        match f {
            'i' => {
                b.case_insensitive(true);
            }
            'm' => {
                b.multi_line(true);
            }
            's' => {
                b.dot_matches_new_line(true);
            }
            'x' => {
                b.ignore_whitespace(true);
            }
            'U' => {
                b.swap_greed(true);
            }
            'R' => {
                b.crlf(true);
            }
            'g' | 'u' => {}
            other => {
                return Response { error: Some(format!("unknown flag '{other}'")), ..Default::default() };
            }
        }
    }
    let re = match b.build() {
        Ok(re) => re,
        Err(e) => return Response { error: Some(e.to_string()), ..Default::default() },
    };
    let group_names: Vec<Option<String>> = re.capture_names().map(|n| n.map(str::to_owned)).collect();
    let text = req.text.as_str();
    let mut matches = Vec::new();
    let mut capped = false;
    // Converts byte offsets to UTF-16 offsets incrementally, since match starts only increase.
    let mut cursor_byte = 0usize;
    let mut cursor_u16 = 0usize;
    let mut locs = re.capture_locations();
    let mut at = 0usize;
    while at <= text.len() {
        let Some(m) = re.captures_read_at(&mut locs, text, at) else { break };
        if matches.len() >= req.limit {
            capped = true;
            break;
        }
        cursor_u16 += utf16_len(&text[cursor_byte..m.start()]);
        cursor_byte = m.start();
        let start = cursor_u16;
        let end = start + utf16_len(m.as_str());
        let mut groups = Vec::with_capacity(locs.len().saturating_sub(1));
        for g in 1..locs.len() {
            groups.push(locs.get(g).map(|(gs, ge)| {
                // Rust regex has no lookaround, so groups lie inside the match and can be measured from its start.
                let s = start + utf16_len(&text[m.start()..gs]);
                [s, s + utf16_len(&text[gs..ge])]
            }));
        }
        matches.push(Match { start, end, groups });
        if !req.global {
            break;
        }
        at = if m.end() > m.start() {
            m.end()
        } else {
            // Empty match: step over one character, never into the middle of one.
            match text[m.end()..].chars().next() {
                Some(c) => m.end() + c.len_utf8(),
                None => break,
            }
        };
    }
    Response { ok: true, error: None, matches, group_names, capped }
}

fn respond(json: &[u8]) -> Response {
    match serde_json::from_slice::<Request>(json) {
        Ok(req) => execute(&req),
        Err(e) => Response { error: Some(format!("bad request: {e}")), ..Default::default() },
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from `alloc(len)` (or be a response buffer of total length `len`) and not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// # Safety
/// `ptr..ptr+len` must be a buffer obtained from `alloc` and filled with the request.
#[no_mangle]
pub unsafe extern "C" fn run(ptr: *const u8, len: usize) -> *mut u8 {
    let input = std::slice::from_raw_parts(ptr, len);
    let out = serde_json::to_vec(&respond(input)).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
    let mut buf = Vec::with_capacity(out.len() + 4);
    buf.extend_from_slice(&(out.len() as u32).to_le_bytes());
    buf.extend_from_slice(&out);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(pattern: &str, flags: &str, text: &str) -> Request {
        Request { pattern: pattern.into(), flags: flags.into(), text: text.into(), global: true, limit: 100 }
    }

    #[test]
    fn named_groups_and_utf16_offsets() {
        let r = execute(&req(r"(?P<y>\d{4})-(\d\d)", "", "😀 2024-05 x 1999-12"));
        assert!(r.ok);
        assert_eq!(r.group_names, vec![None, Some("y".into()), None]);
        assert_eq!(r.matches.len(), 2);
        // The emoji is 2 UTF-16 units, plus a space.
        assert_eq!((r.matches[0].start, r.matches[0].end), (3, 10));
        assert_eq!(r.matches[0].groups[0], Some([3, 7]));
        assert_eq!(r.matches[1].groups[1], Some([18, 20]));
    }

    #[test]
    fn empty_matches_advance() {
        let r = execute(&req("", "", "aé"));
        assert_eq!(r.matches.iter().map(|m| m.start).collect::<Vec<_>>(), vec![0, 1, 2]);
    }

    #[test]
    fn errors_are_reported() {
        let r = execute(&req("(a", "", ""));
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("unclosed"));
    }

    #[test]
    fn cap() {
        let mut q = req("a", "", "aaaa");
        q.limit = 2;
        let r = execute(&q);
        assert!(r.capped);
        assert_eq!(r.matches.len(), 2);
    }

    #[test]
    fn flags() {
        let r = execute(&req("^b", "im", "a\nB"));
        assert_eq!(r.matches.len(), 1);
    }
}
