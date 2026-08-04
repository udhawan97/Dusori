use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, mpsc},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use rand::random;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

// Keep the visible URL at SvelteKit's configured base. Tauri resolves the trailing
// slash to the embedded index.html without exposing `/index.html` as an app route.
const DESKTOP_APP_PATH: &str = "Dusori/app/";
const MAX_UPDATE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSession {
    origin: String,
    token: String,
}

struct CompanionState {
    child: Mutex<Child>,
    session: DesktopSession,
}

struct WorkspaceRoot(PathBuf);

#[derive(Default)]
struct PendingUpdate(Mutex<Option<DownloadedUpdate>>);

struct DownloadedUpdate {
    bytes: Vec<u8>,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFileSnapshot {
    content: String,
    hash: String,
    modified_at: u64,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStorageEntry {
    kind: &'static str,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdate {
    available: bool,
    body: Option<String>,
    current_version: String,
    date: Option<String>,
    version: Option<String>,
}

fn sha256(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

fn validate_update_content_length(content_length: Option<u64>, limit: u64) -> Result<(), String> {
    if content_length.is_some_and(|length| length > limit) {
        return Err("The update exceeded Dusori's 512 MiB safety limit.".into());
    }
    Ok(())
}

fn append_bounded_update_chunk(
    buffer: &mut Vec<u8>,
    chunk: &[u8],
    limit: u64,
) -> Result<(), String> {
    let next = (buffer.len() as u64)
        .checked_add(chunk.len() as u64)
        .ok_or_else(|| "The update size overflowed its safety counter.".to_string())?;
    if next > limit {
        return Err("The update exceeded Dusori's 512 MiB safety limit.".into());
    }
    buffer.extend_from_slice(chunk);
    Ok(())
}

fn verify_update_signature(data: &[u8], encoded_signature: &str) -> Result<(), String> {
    let encoded_public_key = env!("DUSORI_UPDATER_PUBLIC_KEY");
    if encoded_public_key.contains("NOT_PROVISIONED") {
        return Err("This build does not contain a release updater public key.".into());
    }
    let public_key_text = BASE64
        .decode(encoded_public_key)
        .map_err(|_| "The updater public key is not valid base64.".to_string())?;
    let public_key_text = std::str::from_utf8(&public_key_text)
        .map_err(|_| "The updater public key is not valid UTF-8.".to_string())?;
    let public_key = PublicKey::decode(public_key_text)
        .map_err(|error| format!("The updater public key is invalid: {error}"))?;
    let signature_text = BASE64
        .decode(encoded_signature)
        .map_err(|_| "The update signature is not valid base64.".to_string())?;
    let signature_text = std::str::from_utf8(&signature_text)
        .map_err(|_| "The update signature is not valid UTF-8.".to_string())?;
    let signature = Signature::decode(signature_text)
        .map_err(|error| format!("The update signature is invalid: {error}"))?;
    public_key
        .verify(data, &signature, true)
        .map_err(|error| format!("The update signature did not verify: {error}"))
}

fn validate_downloaded_version(downloaded: &str, offered: &str) -> Result<(), String> {
    if downloaded != offered {
        return Err(
            "The offered update changed after download. Check and download it again.".into(),
        );
    }
    Ok(())
}

async fn download_bounded_update(update: &tauri_plugin_updater::Update) -> Result<Vec<u8>, String> {
    let mut client = reqwest::Client::builder().user_agent("Dusori desktop updater");
    if let Some(timeout) = update.timeout {
        client = client.timeout(timeout);
    }
    if update.no_proxy {
        client = client.no_proxy();
    } else if let Some(proxy) = &update.proxy {
        client =
            client.proxy(reqwest::Proxy::all(proxy.as_str()).map_err(|error| error.to_string())?);
    }
    let mut headers = update.headers.clone();
    headers
        .entry(reqwest::header::ACCEPT)
        .or_insert(reqwest::header::HeaderValue::from_static(
            "application/octet-stream",
        ));
    let response = client
        .build()
        .map_err(|error| error.to_string())?
        .get(update.download_url.clone())
        .headers(headers)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Update download failed with HTTP status {}.",
            response.status()
        ));
    }
    let content_length = response.content_length();
    validate_update_content_length(content_length, MAX_UPDATE_BYTES)?;
    let mut bytes = Vec::with_capacity(
        content_length
            .unwrap_or_default()
            .min(MAX_UPDATE_BYTES)
            .try_into()
            .unwrap_or_default(),
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        append_bounded_update_chunk(&mut bytes, &chunk, MAX_UPDATE_BYTES)?;
    }
    verify_update_signature(&bytes, &update.signature)?;
    Ok(bytes)
}

fn normalized_segments(path: &str, allow_empty: bool) -> Result<Vec<&str>, String> {
    if path.starts_with('/')
        || (path.len() >= 3
            && path.as_bytes()[0].is_ascii_alphabetic()
            && path.as_bytes()[1] == b':'
            && matches!(path.as_bytes()[2], b'/' | b'\\'))
    {
        return Err("Workspace paths must be relative.".into());
    }
    let normalized = path
        .strip_prefix("./")
        .unwrap_or(path)
        .trim_end_matches('/');
    if normalized.is_empty() {
        return if allow_empty {
            Ok(Vec::new())
        } else {
            Err("A workspace file path is required.".into())
        };
    }
    let segments: Vec<&str> = normalized.split('/').collect();
    for segment in &segments {
        let lower = segment.to_ascii_lowercase();
        let base = lower.split('.').next().unwrap_or_default();
        let windows_reserved = matches!(base, "con" | "prn" | "aux" | "nul")
            || (base.len() == 4
                && (base.starts_with("com") || base.starts_with("lpt"))
                && matches!(base.as_bytes()[3], b'1'..=b'9'));
        if segment.is_empty()
            || matches!(*segment, "." | "..")
            || segment.chars().count() > 80
            || segment
                .chars()
                .any(|character| character <= '\u{1f}' || "<>:\"\\|?*".contains(character))
            || windows_reserved
        {
            return Err(format!("Workspace path segment is not portable: {segment}"));
        }
    }
    Ok(segments)
}

fn checked_path(root: &Path, path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    let segments = normalized_segments(path, allow_empty)?;
    let mut current = root.to_path_buf();
    for segment in segments {
        current.push(segment);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("Symbolic links are not allowed inside a Dusori workspace.".into());
            }
        }
    }
    Ok(current)
}

fn ensure_checked_directory(root: &Path, path: &str) -> Result<PathBuf, String> {
    let segments = normalized_segments(path, true)?;
    let mut current = root.to_path_buf();
    for segment in segments {
        current.push(segment);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("A workspace directory path is unsafe or occupied by a file.".into());
            }
        } else {
            fs::create_dir(&current).map_err(|error| error.to_string())?;
        }
    }
    Ok(current)
}

fn file_snapshot(root: &Path, path: &str) -> Result<Option<DesktopFileSnapshot>, String> {
    let checked = checked_path(root, path, false)?;
    if !checked.exists() {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&checked).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The requested workspace path is not a file.".into());
    }
    let bytes = fs::read(&checked).map_err(|error| error.to_string())?;
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "Dusori workspace text files must be UTF-8.".to_string())?;
    let modified_at = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(Some(DesktopFileSnapshot {
        content,
        hash: sha256(&bytes),
        modified_at,
        path: path.replace('\\', "/"),
    }))
}

#[tauri::command]
fn desktop_session(state: tauri::State<'_, CompanionState>) -> DesktopSession {
    state.session.clone()
}

#[tauri::command]
fn workspace_ensure_directory(
    root: tauri::State<'_, WorkspaceRoot>,
    path: String,
) -> Result<(), String> {
    ensure_checked_directory(&root.0, &path).map(|_| ())
}

#[tauri::command]
fn workspace_read(
    root: tauri::State<'_, WorkspaceRoot>,
    path: String,
) -> Result<Option<DesktopFileSnapshot>, String> {
    file_snapshot(&root.0, &path)
}

fn visit_directory(
    directory: &Path,
    prefix: &str,
    recursive: bool,
    output: &mut Vec<DesktopStorageEntry>,
) -> Result<(), String> {
    for item in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "Workspace paths must be valid UTF-8.".to_string())?;
        let item_path = item.path();
        let metadata = fs::symlink_metadata(&item_path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Symbolic links are not allowed inside a Dusori workspace.".into());
        }
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let kind = if metadata.is_dir() {
            "directory"
        } else {
            "file"
        };
        output.push(DesktopStorageEntry {
            kind,
            path: relative.clone(),
        });
        if recursive && metadata.is_dir() {
            visit_directory(&item_path, &relative, true, output)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn workspace_list(
    root: tauri::State<'_, WorkspaceRoot>,
    path: String,
    recursive: bool,
) -> Result<Vec<DesktopStorageEntry>, String> {
    let directory = checked_path(&root.0, &path, true)?;
    if !directory.exists() {
        return Err("The requested workspace directory does not exist.".into());
    }
    let normalized = normalized_segments(&path, true)?.join("/");
    let mut output = Vec::new();
    visit_directory(&directory, &normalized, recursive, &mut output)?;
    output.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(output)
}

#[tauri::command]
fn workspace_write(
    root: tauri::State<'_, WorkspaceRoot>,
    path: String,
    content: String,
    expected_hash: Option<String>,
    expect_missing: bool,
) -> Result<DesktopFileSnapshot, String> {
    write_workspace_file(
        &root.0,
        &path,
        &content,
        expected_hash.as_deref(),
        expect_missing,
    )
}

fn write_workspace_file(
    root: &Path,
    path: &str,
    content: &str,
    expected_hash: Option<&str>,
    expect_missing: bool,
) -> Result<DesktopFileSnapshot, String> {
    let current = file_snapshot(root, path)?;
    let actual_hash = current.as_ref().map(|snapshot| snapshot.hash.as_str());
    let conflict = expect_missing && current.is_some()
        || expected_hash.is_some_and(|expected| actual_hash != Some(expected));
    if conflict {
        return Err(format!(
            "DUSORI_STORAGE_CONFLICT|{}|{}|{}",
            path,
            expected_hash.unwrap_or("missing"),
            actual_hash.unwrap_or("missing")
        ));
    }

    let segments = normalized_segments(path, false)?;
    let parent = segments[..segments.len() - 1].join("/");
    let parent_path = ensure_checked_directory(root, &parent)?;
    let target = checked_path(root, path, false)?;
    AtomicFile::new(&target, AllowOverwrite)
        .write(|file| {
            file.write_all(content.as_bytes())?;
            file.sync_all()
        })
        .map_err(|error| error.to_string())?;
    File::open(&parent_path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    file_snapshot(root, path)?.ok_or_else(|| "The workspace write did not persist.".into())
}

#[tauri::command]
fn workspace_remove(
    root: tauri::State<'_, WorkspaceRoot>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let target = checked_path(&root.0, &path, false)?;
    if !target.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(target).map_err(|error| error.to_string())
        } else {
            fs::remove_dir(target).map_err(|error| error.to_string())
        }
    } else {
        fs::remove_file(target).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn workspace_move(
    root: tauri::State<'_, WorkspaceRoot>,
    from: String,
    to: String,
) -> Result<(), String> {
    let source = checked_path(&root.0, &from, false)?;
    if !source.exists() {
        return Err("The source workspace path does not exist.".into());
    }
    let target = checked_path(&root.0, &to, false)?;
    if target.exists() {
        return Err("The destination workspace path already exists.".into());
    }
    let segments = normalized_segments(&to, false)?;
    ensure_checked_directory(&root.0, &segments[..segments.len() - 1].join("/"))?;
    fs::rename(source, target).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<DesktopUpdate, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(match update {
        Some(update) => DesktopUpdate {
            available: true,
            body: update.body.clone(),
            current_version,
            date: update.date.map(|date| date.to_string()),
            version: Some(update.version.clone()),
        },
        None => DesktopUpdate {
            available: false,
            body: None,
            current_version,
            date: None,
            version: None,
        },
    })
}

#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<DesktopUpdate, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available.".to_string())?;
    let version = update.version.clone();
    let body = update.body.clone();
    let date = update.date.map(|value| value.to_string());
    let bytes = download_bounded_update(&update).await?;
    pending
        .0
        .lock()
        .map_err(|_| "The pending update lock was poisoned.".to_string())?
        .replace(DownloadedUpdate {
            bytes,
            version: version.clone(),
        });
    Ok(DesktopUpdate {
        available: true,
        body,
        current_version,
        date,
        version: Some(version),
    })
}

#[tauri::command]
fn discard_downloaded_update(pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    pending
        .0
        .lock()
        .map_err(|_| "The pending update lock was poisoned.".to_string())?
        .take();
    Ok(())
}

#[tauri::command]
async fn install_downloaded_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    confirmed: bool,
) -> Result<String, String> {
    if !confirmed {
        return Err(
            "Installation requires an explicit confirmation after saving current work.".into(),
        );
    }
    let downloaded = pending
        .0
        .lock()
        .map_err(|_| "The pending update lock was poisoned.".to_string())?
        .take()
        .ok_or_else(|| "Download the update before installing it.".to_string())?;
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The downloaded update is no longer offered.".to_string())?;
    validate_downloaded_version(&downloaded.version, &update.version)?;
    update
        .install(downloaded.bytes)
        .map_err(|error| error.to_string())?;
    Ok(update.version)
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Restart requires an explicit confirmation after saving current work.".into());
    }
    app.restart();
}

fn spawn_companion(app: &tauri::AppHandle) -> Result<CompanionState, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let target = env!("DUSORI_TARGET_TRIPLE");
    let executable_suffix = if cfg!(windows) { ".exe" } else { "" };
    let node = resource_dir.join(format!("resources/node-{target}{executable_suffix}"));
    let companion = resource_dir.join("resources/companion.cjs");
    if !node.is_file() || !companion.is_file() {
        return Err("The packaged Node runtime or Dusori companion resource is missing.".into());
    }

    let token = hex::encode(random::<[u8; 32]>());
    let desktop_origin = if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let mut child = Command::new(node)
        .arg(companion)
        .env("DUSORI_SESSION_TOKEN", &token)
        .env("DUSORI_DESKTOP_ORIGIN", desktop_origin)
        .env("DUSORI_DESKTOP_PARENT_PID", std::process::id().to_string())
        .env("DUSORI_NO_OPEN", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start the packaged companion: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("The packaged companion did not expose its readiness pipe.".into());
    };
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout)
            .read_line(&mut line)
            .map(|_| line)
            .map_err(|error| format!("Could not read companion readiness: {error}"));
        let _ = sender.send(result);
    });
    let line = match receiver.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The packaged companion did not become ready within 10 seconds.".into());
        }
    };
    let session = (|| {
        let ready = line.strip_prefix("DUSORI_READY ").ok_or_else(|| {
            "The packaged companion returned an invalid readiness message.".to_string()
        })?;
        let value: serde_json::Value = serde_json::from_str(ready)
            .map_err(|_| "The companion readiness message was invalid.".to_string())?;
        let port = value
            .get("port")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| "The companion readiness port was invalid.".to_string())?;
        Ok::<_, String>(DesktopSession {
            origin: format!("http://127.0.0.1:{port}"),
            token,
        })
    })();
    match session {
        Ok(session) => Ok(CompanionState {
            child: Mutex::new(child),
            session,
        }),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

fn build_app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            desktop_session,
            workspace_ensure_directory,
            workspace_list,
            workspace_move,
            workspace_read,
            workspace_remove,
            workspace_write,
            check_for_update,
            download_update,
            discard_downloaded_update,
            install_downloaded_update,
            restart_app
        ])
        .setup(|app| {
            let workspace = app.path().app_data_dir()?.join("workspace");
            fs::create_dir_all(&workspace)?;
            let workspace = workspace.canonicalize()?;
            app.manage(WorkspaceRoot(workspace));
            app.manage(spawn_companion(app.handle()).map_err(std::io::Error::other)?);

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(DESKTOP_APP_PATH.into()))
                .title("Dusori")
                .inner_size(1280.0, 820.0)
                .min_inner_size(360.0, 640.0)
                .on_navigation(|url| {
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http"
                            && url.host_str() == Some("tauri.localhost")
                            && url.port().is_none())
                })
                .build()?;
            Ok(())
        })
}

pub fn run() {
    let app = build_app()
        .build(tauri::generate_context!())
        .expect("error while building the Dusori desktop app");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) && let Some(state) = handle.try_state::<CompanionState>()
            && let Ok(mut child) = state.child.lock()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        DESKTOP_APP_PATH, append_bounded_update_chunk, checked_path, normalized_segments,
        validate_downloaded_version, validate_update_content_length, verify_update_signature,
        write_workspace_file,
    };

    #[test]
    fn desktop_window_opens_at_the_svelte_base_route() {
        assert_eq!(DESKTOP_APP_PATH, "Dusori/app/");
        assert!(!DESKTOP_APP_PATH.ends_with("index.html"));
    }

    #[test]
    fn accepts_portable_workspace_paths() {
        assert_eq!(
            normalized_segments("topics/ai/note.md", false).unwrap(),
            ["topics", "ai", "note.md"]
        );
    }

    #[test]
    fn rejects_escape_and_absolute_paths() {
        assert!(normalized_segments("../outside", false).is_err());
        assert!(normalized_segments("/tmp/outside", false).is_err());
        assert!(normalized_segments("C:\\outside", false).is_err());
        assert!(normalized_segments("Topics/con/note.md", false).is_err());
        assert!(normalized_segments("Topics/ai\\note.md", false).is_err());
        assert!(normalized_segments("", false).is_err());
    }

    #[test]
    fn hash_guarded_write_preserves_the_winner() {
        let workspace = tempfile::tempdir().unwrap();
        let first =
            write_workspace_file(workspace.path(), "Topics/ai/note.md", "first", None, true)
                .unwrap();
        let second = write_workspace_file(
            workspace.path(),
            "Topics/ai/note.md",
            "second",
            Some(&first.hash),
            false,
        )
        .unwrap();
        let conflict = write_workspace_file(
            workspace.path(),
            "Topics/ai/note.md",
            "stale",
            Some(&first.hash),
            false,
        )
        .unwrap_err();
        assert!(conflict.starts_with("DUSORI_STORAGE_CONFLICT|"));
        assert!(conflict.ends_with(&second.hash));
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("Topics/ai/note.md")).unwrap(),
            "second"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_inside_workspace() {
        use std::os::unix::fs::symlink;

        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), workspace.path().join("escape")).unwrap();
        assert!(checked_path(workspace.path(), "escape/private.md", false).is_err());
        assert!(!outside.path().join("private.md").exists());
    }

    #[test]
    fn rejects_oversized_declared_and_streamed_updates_before_buffering_them() {
        assert!(validate_update_content_length(Some(5), 4).is_err());
        let mut bytes = vec![1, 2, 3];
        assert!(append_bounded_update_chunk(&mut bytes, &[4, 5], 4).is_err());
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn rejects_an_invalid_updater_signature() {
        assert!(verify_update_signature(b"artifact", "not-base64").is_err());
    }

    #[test]
    fn rejects_changed_update_metadata_before_installation() {
        assert!(validate_downloaded_version("0.12.0", "0.12.1").is_err());
        assert!(validate_downloaded_version("0.12.0", "0.12.0").is_ok());
    }
}
