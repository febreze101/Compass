//! Compass desktop shell.
//!
//! The Rust side exists for the two things a webview cannot do itself: store a
//! secret in the OS credential store, and receive Google's OAuth redirect on a
//! loopback address. Everything else is the shared web app.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;

use tauri::Manager;

/// Service name under which secrets appear in Windows Credential Manager.
const KEYRING_SERVICE: &str = "app.compass.agenda";

/// Shown in the browser tab Google redirects to, which the user is left looking
/// at once the app takes over.
const CALLBACK_PAGE: &str = "HTTP/1.1 200 OK\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Connection: close\r\n\
\r\n\
<!doctype html><html><head><title>Compass</title></head>\
<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0\">\
<div style=\"text-align:center\"><h1 style=\"font-weight:500\">Compass is connected.</h1>\
<p style=\"color:#666\">You can close this tab and return to the app.</p></div>\
</body></html>";

/// Holds the loopback listener between `oauth_start` and `oauth_await`.
///
/// The port has to be known *before* the authorization URL is built, because it
/// is part of the `redirect_uri` Google validates — so binding and accepting
/// are two separate steps.
#[derive(Default)]
struct OAuthServer(Mutex<Option<TcpListener>>);

// ── Secrets ──────────────────────────────────────────────────────────────────

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        // A missing entry is the normal "not signed in" case, not a failure.
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// ── OAuth loopback ───────────────────────────────────────────────────────────

/// Binds a loopback listener on a free port and reports it.
///
/// Google's desktop OAuth clients accept `http://127.0.0.1` on *any* port, so
/// an ephemeral one avoids clashing with whatever else is running.
#[tauri::command]
fn oauth_start(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let state = app.state::<OAuthServer>();
    let mut held = state.0.lock().map_err(|_| "OAuth state poisoned".to_string())?;
    *held = Some(listener);
    Ok(port)
}

/// Waits for Google's redirect and returns the URL it arrived on.
#[tauri::command]
async fn oauth_await(app: tauri::AppHandle) -> Result<String, String> {
    // The listener is taken out before any await, so the lock is never held
    // across a suspension point.
    let listener = {
        let state = app.state::<OAuthServer>();
        let mut held = state.0.lock().map_err(|_| "OAuth state poisoned".to_string())?;
        held.take()
            .ok_or_else(|| "No sign-in is in progress.".to_string())?
    };

    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    // `accept` blocks, so it goes on the blocking pool rather than stalling the
    // async runtime the rest of the app shares.
    tauri::async_runtime::spawn_blocking(move || {
        let (stream, _) = listener.accept().map_err(|error| error.to_string())?;

        let mut request_line = String::new();
        BufReader::new(&stream)
            .read_line(&mut request_line)
            .map_err(|error| error.to_string())?;

        // "GET /oauth/callback?code=…&state=… HTTP/1.1"
        let target = request_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "Malformed request from the browser.".to_string())?
            .to_string();

        let mut stream = stream;
        let _ = stream.write_all(CALLBACK_PAGE.as_bytes());
        let _ = stream.flush();

        Ok::<String, String>(format!("http://127.0.0.1:{port}{target}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthServer::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_delete,
            oauth_start,
            oauth_await
        ])
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
