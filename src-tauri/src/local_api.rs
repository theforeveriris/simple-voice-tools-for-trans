//! 桌面本地只读 API。
//!
//! 数据在 WebView 的 IndexedDB 里，Rust 侧无法直接读取，因此由前端把
//! `buildRecordsPayload` 生成的快照推给这里；本模块只负责在 `127.0.0.1`
//! 上提供只读查询。服务默认不启动、每次启动 App 都是关闭状态，并要求
//! Bearer token。生命周期与桌面进程一致。

use std::collections::BTreeMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

const DEFAULT_PORT: u16 = 47821;

struct Server {
  addr: SocketAddr,
  token: String,
  stop: Arc<AtomicBool>,
}

static SNAPSHOT: OnceLock<Mutex<String>> = OnceLock::new();
static SERVER: OnceLock<Mutex<Option<Server>>> = OnceLock::new();

fn snapshot() -> &'static Mutex<String> {
  SNAPSHOT.get_or_init(|| {
    Mutex::new(
      r#"{"app":"simple-voice-tools-for-trans","version":2,"records":[]}"#.to_string(),
    )
  })
}

fn server() -> &'static Mutex<Option<Server>> {
  SERVER.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize)]
pub struct ApiStatus {
  running: bool,
  url: Option<String>,
  token: Option<String>,
}

fn status_of(running: Option<&Server>) -> ApiStatus {
  match running {
    Some(server) => ApiStatus {
      running: true,
      url: Some(format!("http://{}", server.addr)),
      token: Some(server.token.clone()),
    },
    None => ApiStatus {
      running: false,
      url: None,
      token: None,
    },
  }
}

fn current_status() -> ApiStatus {
  status_of(server().lock().unwrap().as_ref())
}

/// 启动（或复用）本地 API；固定端口便于 CLI 直接使用。
#[tauri::command]
pub fn local_api_start(snapshot_json: String) -> Result<ApiStatus, String> {
  *snapshot().lock().unwrap() = snapshot_json;
  let mut guard = server().lock().unwrap();
  if let Some(server) = guard.as_ref() {
    return Ok(status_of(Some(server)));
  }
  let listener = TcpListener::bind(("127.0.0.1", DEFAULT_PORT))
    .map_err(|err| format!("cannot bind 127.0.0.1:{DEFAULT_PORT}: {err}"))?;
  listener
    .set_nonblocking(true)
    .map_err(|err| format!("cannot configure listener: {err}"))?;
  let addr = listener
    .local_addr()
    .map_err(|err| format!("cannot read listener address: {err}"))?;
  let token = random_token()?;
  let stop = Arc::new(AtomicBool::new(false));
  *guard = Some(Server {
    addr,
    token: token.clone(),
    stop: stop.clone(),
  });
  drop(guard);
  let token_for_thread = token.clone();
  thread::spawn(move || serve(listener, token_for_thread, stop));
  Ok(ApiStatus {
    running: true,
    url: Some(format!("http://{addr}")),
    token: Some(token),
  })
}

/// 前端记录变化时更新快照；服务未启动时也允许更新，下次启动直接使用。
#[tauri::command]
pub fn local_api_update(snapshot_json: String) -> bool {
  *snapshot().lock().unwrap() = snapshot_json;
  server().lock().unwrap().is_some()
}

#[tauri::command]
pub fn local_api_stop() {
  if let Some(server) = server().lock().unwrap().take() {
    server.stop.store(true, Ordering::Relaxed);
  }
}

#[tauri::command]
pub fn local_api_status() -> ApiStatus {
  current_status()
}

fn random_token() -> Result<String, String> {
  // 直接取操作系统随机源；不要用时间戳/进程号派生，避免可预测 token
  let mut bytes = [0u8; 16];
  getrandom::fill(&mut bytes).map_err(|err| format!("secure random unavailable: {err}"))?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn serve(listener: TcpListener, token: String, stop: Arc<AtomicBool>) {
  loop {
    if stop.load(Ordering::Relaxed) {
      break;
    }
    match listener.accept() {
      Ok((mut stream, _)) => handle(&mut stream, &token, &stop),
      Err(err) if err.kind() == ErrorKind::WouldBlock => {
        thread::sleep(Duration::from_millis(80));
      }
      Err(_) => thread::sleep(Duration::from_millis(80)),
    }
  }
}

fn handle(stream: &mut TcpStream, token: &str, stop: &AtomicBool) {
  // accepted socket 可能继承 listener 的非阻塞标志；切回阻塞并限制读写时长
  let _ = stream.set_nonblocking(false);
  let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
  let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
  let mut buffer: Vec<u8> = Vec::with_capacity(8192);
  let mut chunk = [0u8; 4096];
  let started = Instant::now();
  loop {
    // 慢客户端不能靠每次 read 的超时无限续命：整个头部只给 3 秒
    if started.elapsed() > Duration::from_secs(3) {
      return;
    }
    match stream.read(&mut chunk) {
      Ok(0) => break,
      Ok(read) => {
        buffer.extend_from_slice(&chunk[..read]);
        // 读完整个头部再解析；同时限制上限，避免慢客户端无限占用内存
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") || buffer.len() >= 64 * 1024 {
          break;
        }
      }
      Err(_) => return,
    }
  }
  if buffer.is_empty() {
    return;
  }
  let request = String::from_utf8_lossy(&buffer);
  let mut lines = request.split("\r\n");
  let Some(request_line) = lines.next() else {
    return;
  };
  let mut parts = request_line.split_whitespace();
  let method = parts.next().unwrap_or("");
  let target = parts.next().unwrap_or("/");
  let headers: Vec<&str> = lines.collect();

  if method == "OPTIONS" {
    respond(stream, "204 No Content", "text/plain", "");
    return;
  }
  if stop.load(Ordering::Relaxed) {
    respond_json(stream, "503 Service Unavailable", r#"{"error":"stopping"}"#);
    return;
  }
  if method != "GET" {
    respond_json(stream, "405 Method Not Allowed", r#"{"error":"method_not_allowed"}"#);
    return;
  }
  if !host_allowed(&headers) {
    respond_json(stream, "403 Forbidden", r#"{"error":"host_not_allowed"}"#);
    return;
  }
  let (path, query) = target.split_once('?').unwrap_or((target, ""));
  if !authorized(&headers, query, token) {
    respond_json(stream, "401 Unauthorized", r#"{"error":"unauthorized"}"#);
    return;
  }
  // 锁定 / 进入诱饵库会设置 stop；已建立的连接也不能继续拿到真实快照
  if stop.load(Ordering::Relaxed) {
    respond_json(stream, "503 Service Unavailable", r#"{"error":"stopping"}"#);
    return;
  }

  match path {
    "/health" => respond_json(stream, "200 OK", r#"{"ok":true}"#),
    "/records" => {
      let body = snapshot().lock().unwrap().clone();
      respond_json(stream, "200 OK", &body);
    }
    "/trends" => {
      let since = parse_bound(query_param(query, "since").as_deref(), false);
      let until = parse_bound(query_param(query, "until").as_deref(), true);
      let body = trends_json(&snapshot().lock().unwrap(), since, until);
      respond_json(stream, "200 OK", &body);
    }
    "/export" => {
      let since = parse_bound(query_param(query, "since").as_deref(), false);
      let until = parse_bound(query_param(query, "until").as_deref(), true);
      let format = query_param(query, "format").unwrap_or_else(|| "csv".to_string());
      let body = if format.eq_ignore_ascii_case("json") {
        export_json(&snapshot().lock().unwrap(), since, until)
      } else {
        export_csv(&snapshot().lock().unwrap(), since, until)
      };
      let content_type = if format.eq_ignore_ascii_case("json") {
        "application/json; charset=utf-8"
      } else {
        "text/csv; charset=utf-8"
      };
      respond(stream, "200 OK", content_type, &body);
    }
    _ => respond_json(stream, "404 Not Found", r#"{"error":"not_found"}"#),
  }
}

fn host_allowed(headers: &[&str]) -> bool {
  headers.iter().any(|line| {
    let Some((name, value)) = line.split_once(':') else {
      return false;
    };
    if !name.eq_ignore_ascii_case("host") {
      return false;
    }
    let value = value.trim();
    value.starts_with("127.0.0.1:") || value.starts_with("localhost:")
  })
}

fn authorized(headers: &[&str], query: &str, token: &str) -> bool {
  let bearer = headers.iter().find_map(|line| {
    let (name, value) = line.split_once(':')?;
    if !name.eq_ignore_ascii_case("authorization") {
      return None;
    }
    let value = value.trim();
    value
      .strip_prefix("Bearer ")
      .or_else(|| value.strip_prefix("bearer "))
  });
  let provided = bearer
    .map(str::to_string)
    .or_else(|| query_param(query, "token"));
  provided
    .as_deref()
    .is_some_and(|value| constant_time_eq(value.as_bytes(), token.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
  if left.len() != right.len() {
    return false;
  }
  let mut diff = 0u8;
  for (a, b) in left.iter().zip(right) {
    diff |= a ^ b;
  }
  diff == 0
}

fn query_param(query: &str, key: &str) -> Option<String> {
  query.split('&').find_map(|pair| {
    let (name, value) = pair.split_once('=')?;
    if name == key {
      Some(value.replace('+', " "))
    } else {
      None
    }
  })
}

fn respond_json(stream: &mut TcpStream, status: &str, body: &str) {
  respond(stream, status, "application/json; charset=utf-8", body);
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
  let response = format!(
    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
    body.len()
  );
  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}

/* ------------------------------ 数据查询 ------------------------------ */

fn parse_records(snapshot: &str) -> Vec<Value> {
  serde_json::from_str::<Value>(snapshot)
    .ok()
    .and_then(|value| value.get("records").and_then(Value::as_array).cloned())
    .unwrap_or_default()
}

fn record_number(record: &Value, path: &[&str]) -> Option<f64> {
  let mut value = record;
  for key in path {
    value = value.get(*key)?;
  }
  value.as_f64()
}

fn in_range(ts: f64, since: Option<f64>, until: Option<f64>) -> bool {
  if let Some(start) = since
    && ts < start
  {
    return false;
  }
  if let Some(end) = until
    && ts > end
  {
    return false;
  }
  true
}

#[derive(Default)]
struct DayAgg {
  count: u32,
  duration: f64,
  f0_sum: f64,
  f0_n: u32,
  cpps_sum: f64,
  cpps_n: u32,
  jitter_sum: f64,
  jitter_n: u32,
  shimmer_sum: f64,
  shimmer_n: u32,
  hnr_sum: f64,
  hnr_n: u32,
}

fn trends_json(snapshot: &str, since: Option<f64>, until: Option<f64>) -> String {
  let mut days: BTreeMap<String, DayAgg> = BTreeMap::new();
  for record in parse_records(snapshot) {
    let ts = record.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0);
    if !in_range(ts, since, until) {
      continue;
    }
    let aggregate = days.entry(day_key(ts as i64)).or_default();
    aggregate.count += 1;
    aggregate.duration += record
      .get("durationSec")
      .and_then(Value::as_f64)
      .unwrap_or(0.0);
    if let Some(value) = record_number(&record, &["stats", "avgF0"]) {
      aggregate.f0_sum += value;
      aggregate.f0_n += 1;
    }
    if let Some(value) = record_number(&record, &["stats", "cppsDb"]) {
      aggregate.cpps_sum += value;
      aggregate.cpps_n += 1;
    }
    if let Some(value) = record_number(&record, &["stats", "jitterPct"]) {
      aggregate.jitter_sum += value;
      aggregate.jitter_n += 1;
    }
    if let Some(value) = record_number(&record, &["stats", "shimmerPct"]) {
      aggregate.shimmer_sum += value;
      aggregate.shimmer_n += 1;
    }
    if let Some(value) = record_number(&record, &["stats", "hnrDb"]) {
      aggregate.hnr_sum += value;
      aggregate.hnr_n += 1;
    }
  }
  let rows: Vec<Value> = days
    .into_iter()
    .map(|(date, aggregate)| {
      json!({
        "date": date,
        "count": aggregate.count,
        "durationSec": round(aggregate.duration),
        "avgF0": average(aggregate.f0_sum, aggregate.f0_n),
        "avgCppsDb": average(aggregate.cpps_sum, aggregate.cpps_n),
        "avgJitterPct": average(aggregate.jitter_sum, aggregate.jitter_n),
        "avgShimmerPct": average(aggregate.shimmer_sum, aggregate.shimmer_n),
        "avgHnrDb": average(aggregate.hnr_sum, aggregate.hnr_n),
      })
    })
    .collect();
  json!({ "days": rows }).to_string()
}

fn average(sum: f64, count: u32) -> Option<f64> {
  if count == 0 {
    None
  } else {
    Some(round(sum / count as f64))
  }
}

fn round(value: f64) -> f64 {
  (value * 100.0).round() / 100.0
}

fn export_json(snapshot: &str, since: Option<f64>, until: Option<f64>) -> String {
  let value: Value = serde_json::from_str(snapshot).unwrap_or_else(|_| json!({}));
  let records: Vec<Value> = parse_records(snapshot)
    .into_iter()
    .filter(|record| {
      let ts = record.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0);
      in_range(ts, since, until)
    })
    .collect();
  json!({
    "app": value.get("app").cloned().unwrap_or_else(|| json!("simple-voice-tools-for-trans")),
    "version": value.get("version").cloned().unwrap_or_else(|| json!(2)),
    "records": records,
  })
  .to_string()
}

fn export_csv(snapshot: &str, since: Option<f64>, until: Option<f64>) -> String {
  let mut output = String::from(
    "id,created_at,date,time,duration_sec,mode,avg_f0,median_f0,min_f0,max_f0,avg_db,peak_db,jitter_pct,shimmer_pct,hnr_db,cpps_db,note\r\n",
  );
  for record in parse_records(snapshot) {
    let ts = record.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0);
    if !in_range(ts, since, until) {
      continue;
    }
    let (date, time) = timestamp(ts as i64);
    let row = [
      text(record.get("id")),
      (ts as i64).to_string(),
      date,
      time,
      number(record.get("durationSec").and_then(Value::as_f64)),
      text(record.get("mode")),
      number(record_number(&record, &["stats", "avgF0"])),
      number(record_number(&record, &["stats", "medianF0"])),
      number(record_number(&record, &["stats", "minF0"])),
      number(record_number(&record, &["stats", "maxF0"])),
      number(record_number(&record, &["stats", "avgDb"])),
      number(record_number(&record, &["stats", "peakDb"])),
      number(record_number(&record, &["stats", "jitterPct"])),
      number(record_number(&record, &["stats", "shimmerPct"])),
      number(record_number(&record, &["stats", "hnrDb"])),
      number(record_number(&record, &["stats", "cppsDb"])),
      text(record.get("note")),
    ];
    output.push_str(
      &row
        .iter()
        .map(|cell| csv_cell(cell))
        .collect::<Vec<_>>()
        .join(","),
    );
    output.push_str("\r\n");
  }
  output
}

fn text(value: Option<&Value>) -> String {
  value.and_then(Value::as_str).unwrap_or("").to_string()
}

fn number(value: Option<f64>) -> String {
  value.map(|number| format!("{number:.2}")).unwrap_or_default()
}

fn csv_cell(value: &str) -> String {
  if value
    .chars()
    .any(|ch| ch == ',' || ch == '"' || ch == '\n' || ch == '\r')
  {
    format!("\"{}\"", value.replace('"', "\"\""))
  } else {
    value.to_string()
  }
}

/* ------------------------------ 日期工具 ------------------------------ */

fn parse_bound(raw: Option<&str>, end_of_day: bool) -> Option<f64> {
  let raw = raw?.trim();
  if raw.is_empty() {
    return None;
  }
  if let Ok(epoch_ms) = raw.parse::<i64>() {
    return Some(epoch_ms as f64);
  }
  let parts: Vec<i64> = raw.split('-').filter_map(|part| part.parse().ok()).collect();
  if parts.len() != 3 {
    return None;
  }
  let (year, month, day) = (parts[0], parts[1], parts[2]);
  if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
    return None;
  }
  let days = days_from_civil(year, month as u32, day as u32);
  let millis = days * 86_400_000 + if end_of_day { 86_399_999 } else { 0 };
  Some(millis as f64)
}

fn day_key(epoch_ms: i64) -> String {
  let days = epoch_ms.div_euclid(86_400_000);
  let (year, month, day) = civil_from_days(days);
  format!("{year:04}-{month:02}-{day:02}")
}

fn timestamp(epoch_ms: i64) -> (String, String) {
  let days = epoch_ms.div_euclid(86_400_000);
  let rem = epoch_ms.rem_euclid(86_400_000);
  let (year, month, day) = civil_from_days(days);
  let seconds = rem / 1000;
  (
    format!("{year:04}-{month:02}-{day:02}"),
    format!(
      "{:02}:{:02}:{:02}",
      seconds / 3600,
      (seconds % 3600) / 60,
      seconds % 60
    ),
  )
}

/** Howard Hinnant 的 civil_from_days（UTC，无外部依赖） */
fn civil_from_days(days: i64) -> (i64, u32, u32) {
  let z = days + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let year = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = doy - (153 * mp + 2) / 5 + 1;
  let month = mp + if mp < 10 { 3 } else { -9 };
  (
    year + if month <= 2 { 1 } else { 0 },
    month as u32,
    day as u32,
  )
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
  let year = year - if month <= 2 { 1 } else { 0 };
  let era = if year >= 0 { year } else { year - 399 } / 400;
  let yoe = year - era * 400;
  let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
  let doy = (153 * mp + 2) / 5 + day as i64 - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn date_round_trip() {
    assert_eq!(day_key(0), "1970-01-01");
    assert_eq!(day_key(1_767_225_600_000), "2026-01-01");
    let bound = parse_bound(Some("2026-01-01"), false).unwrap();
    assert_eq!(bound, 1_767_225_600_000.0);
  }

  #[test]
  fn csv_escapes_quotes_and_commas() {
    assert_eq!(csv_cell("a,b"), "\"a,b\"");
    assert_eq!(csv_cell("a\"b"), "\"a\"\"b\"");
  }

  #[test]
  fn http_records_requires_token() {
    let snapshot = r#"{"app":"x","version":2,"records":[]}"#.to_string();
    let status = local_api_start(snapshot).unwrap();
    let url = status.url.clone().unwrap();
    let token = status.token.clone().unwrap();
    let address = url.strip_prefix("http://").unwrap();
    let port: u16 = address.rsplit_once(':').unwrap().1.parse().unwrap();

    let unauthorized = request(port, address, "/records", None);
    assert!(unauthorized.starts_with("HTTP/1.1 401"), "{unauthorized}");
    let authorized = request(port, address, "/records", Some(&token));
    assert!(authorized.starts_with("HTTP/1.1 200"), "{authorized}");
    assert!(authorized.contains(r#""records":[]"#));
    local_api_stop();
  }

  fn request(port: u16, host: &str, path: &str, token: Option<&str>) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let auth = token
      .map(|value| format!("Authorization: Bearer {value}\r\n"))
      .unwrap_or_default();
    let request = format!(
      "GET {path} HTTP/1.1\r\nHost: {host}\r\n{auth}Connection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
  }

  #[test]
  fn trends_group_by_day() {
    let snapshot = format!(
      r#"{{"records":[{{"createdAt":{},"durationSec":2,"stats":{{"avgF0":100,"cppsDb":10}}}}]}}"#,
      1_767_225_600_000i64
    );
    let value: Value = serde_json::from_str(&trends_json(&snapshot, None, None)).unwrap();
    let days = value.get("days").and_then(Value::as_array).unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].get("date").and_then(Value::as_str), Some("2026-01-01"));
    assert_eq!(days[0].get("count").and_then(Value::as_u64), Some(1));
    assert_eq!(days[0].get("avgF0").and_then(Value::as_f64), Some(100.0));
  }
}
