mod local_api;

#[cfg(windows)]
fn windows_hello_available_impl() -> bool {
  use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};

  match UserConsentVerifier::CheckAvailabilityAsync().and_then(|op| op.join()) {
    Ok(availability) => availability == UserConsentVerifierAvailability::Available,
    Err(_) => false,
  }
}

#[cfg(windows)]
fn verify_windows_hello_impl(message: &str) -> bool {
  use windows::core::HSTRING;
  use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerificationResult};

  let message = HSTRING::from(message);
  match UserConsentVerifier::RequestVerificationAsync(&message).and_then(|op| op.join()) {
    Ok(result) => result == UserConsentVerificationResult::Verified,
    Err(_) => false,
  }
}

/// Windows Hello 是否可用（不会弹窗）
#[tauri::command]
fn windows_hello_available() -> bool {
  #[cfg(windows)]
  {
    windows_hello_available_impl()
  }
  #[cfg(not(windows))]
  {
    false
  }
}

/// Windows Hello 验证；只用于解锁，不用于重置 PIN
#[tauri::command]
fn verify_windows_hello(message: String) -> bool {
  #[cfg(windows)]
  {
    verify_windows_hello_impl(&message)
  }
  #[cfg(not(windows))]
  {
    let _ = message;
    false
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      windows_hello_available,
      verify_windows_hello,
      local_api::local_api_start,
      local_api::local_api_update,
      local_api::local_api_stop,
      local_api::local_api_status
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
