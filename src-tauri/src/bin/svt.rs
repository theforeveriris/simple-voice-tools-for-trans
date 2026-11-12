//! `svt` —— 桌面本地只读 API 的命令行客户端。
//!
//! 前提：在 App 的 设置 → 数据 → 本地只读 API 中启动服务，并复制 URL / token。
//! 只支持本机 HTTP（127.0.0.1），不处理 https。
//!
//! 例：
//!   svt records --token <token>
//!   svt trends --since 2026-01-01 --token <token>
//!   svt export --since 2026-01-01 --format csv --token <token>

use std::io::{Read, Write};
use std::net::TcpStream;

fn usage() {
  println!(
    "svt — read-only client for the Simple Voice Tool desktop API\n\n\
     Usage:\n  svt <records|trends|export> [options]\n\n\
     Options:\n\
       --url <url>       API base URL (default: $SVT_API_URL or http://127.0.0.1:47821)\n\
       --token <token>   API token (default: $SVT_API_TOKEN)\n\
       --since <date>    include records on/after YYYY-MM-DD (or epoch ms)\n\
       --until <date>    include records on/before YYYY-MM-DD (or epoch ms)\n\
       --format <fmt>    export format: csv (default) or json\n\
       --help            show this help\n\n\
     Start the server in the app: Settings → Data → Local read-only API."
  );
}

fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
    usage();
    return;
  }
  let mut command = String::new();
  let mut url = std::env::var("SVT_API_URL").unwrap_or_else(|_| "http://127.0.0.1:47821".to_string());
  let mut token = std::env::var("SVT_API_TOKEN").unwrap_or_default();
  let mut since = None;
  let mut until = None;
  let mut format = "csv".to_string();

  let mut index = 0;
  while index < args.len() {
    let arg = &args[index];
    match arg.as_str() {
      "--url" | "--token" | "--since" | "--until" | "--format" => {
        let Some(value) = args.get(index + 1) else {
          eprintln!("missing value for {arg}");
          std::process::exit(2);
        };
        match arg.as_str() {
          "--url" => url = value.clone(),
          "--token" => token = value.clone(),
          "--since" => since = Some(value.clone()),
          "--until" => until = Some(value.clone()),
          "--format" => format = value.clone(),
          _ => {}
        }
        index += 2;
      }
      other if other.starts_with('-') => {
        eprintln!("unknown option: {other}");
        std::process::exit(2);
      }
      other => {
        if command.is_empty() {
          command = other.to_string();
        } else {
          eprintln!("unexpected argument: {other}");
          std::process::exit(2);
        }
        index += 1;
      }
    }
  }

  if command.is_empty() {
    usage();
    return;
  }
  if !matches!(command.as_str(), "records" | "trends" | "export") {
    eprintln!("unknown command: {command}");
    std::process::exit(2);
  }
  if token.trim().is_empty() {
    eprintln!("missing --token (or set SVT_API_TOKEN)");
    std::process::exit(2);
  }

  let mut query: Vec<String> = Vec::new();
  if let Some(value) = since {
    query.push(format!("since={}", encode(&value)));
  }
  if let Some(value) = until {
    query.push(format!("until={}", encode(&value)));
  }
  if command == "export" {
    query.push(format!("format={}", encode(&format)));
  }
  let path = if query.is_empty() {
    format!("/{command}")
  } else {
    format!("/{command}?{}", query.join("&"))
  };

  match get(&url, &token, &path) {
    Ok(body) => {
      let mut stdout = std::io::stdout();
      let _ = stdout.write_all(body.as_bytes());
      if !body.ends_with('\n') {
        let _ = stdout.write_all(b"\n");
      }
    }
    Err(err) => {
      eprintln!("{err}");
      std::process::exit(1);
    }
  }
}

/// 日期 / 格式参数只含 ASCII 安全字符；这里只处理空格与百分号之外的常见情况。
fn encode(value: &str) -> String {
  value
    .bytes()
    .map(|byte| match byte {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
        (byte as char).to_string()
      }
      other => format!("%{other:02X}"),
    })
    .collect()
}

fn get(base_url: &str, token: &str, path: &str) -> Result<String, String> {
  let rest = base_url
    .strip_prefix("http://")
    .ok_or_else(|| "only http:// URLs are supported (the API is local)".to_string())?;
  let (host, port) = match rest.rsplit_once(':') {
    Some((host, port)) => (host, port.parse::<u16>().map_err(|_| "invalid port".to_string())?),
    None => (rest, 80),
  };
  let mut stream = TcpStream::connect((host, port))
    .map_err(|err| format!("cannot connect to {host}:{port}: {err}"))?;
  stream
    .set_read_timeout(Some(std::time::Duration::from_secs(30)))
    .map_err(|err| err.to_string())?;
  let request = format!(
    "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAuthorization: Bearer {token}\r\nAccept: */*\r\nConnection: close\r\n\r\n"
  );
  stream
    .write_all(request.as_bytes())
    .map_err(|err| format!("request failed: {err}"))?;
  let mut response = String::new();
  stream
    .read_to_string(&mut response)
    .map_err(|err| format!("response read failed: {err}"))?;
  let status = response.lines().next().unwrap_or("HTTP/1.1 000");
  if !status.contains(" 200 ") {
    let body = response.split("\r\n\r\n").nth(1).unwrap_or("").trim();
    return Err(format!("API error: {status}{}{body}", if body.is_empty() { "" } else { " — " }));
  }
  Ok(
    response
      .split("\r\n\r\n")
      .nth(1)
      .unwrap_or("")
      .to_string(),
  )
}
