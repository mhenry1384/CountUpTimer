use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, Window, WindowEvent,
};

static WINDOW_SAVE_ENABLED: AtomicBool = AtomicBool::new(false);

const WINDOW_STATE_FILE_NAME: &str = "window-state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
}

fn app_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve config directory: {error}"))?;

    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Failed to create config directory: {error}"))?;

    Ok(config_dir.join(file_name))
}

fn read_json_file<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;

    serde_json::from_str(&contents)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn write_json_file<T>(path: &Path, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    let contents = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;

    fs::write(path, format!("{contents}\n"))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn restore_window_state(window: &Window) -> Result<(), String> {
    let state_path = app_file_path(&window.app_handle(), WINDOW_STATE_FILE_NAME)?;
    if !state_path.exists() {
        return Ok(());
    }

    let state: WindowState = read_json_file(&state_path)?;
    if state.width <= 0.0 || state.height <= 0.0 {
        return Ok(());
    }

    window
        .set_position(Position::Logical(LogicalPosition::new(state.x, state.y)))
        .map_err(|error| format!("Failed to restore window position: {error}"))?;

    window
        .set_size(Size::Logical(LogicalSize::new(state.width, state.height)))
        .map_err(|error| format!("Failed to restore window size: {error}"))?;

    if state.maximized {
        window
            .maximize()
            .map_err(|error| format!("Failed to maximize window: {error}"))?;
    }

    Ok(())
}

fn save_window_state(window: &Window) -> Result<(), String> {
    let physical_size = window
        .outer_size()
        .map_err(|error| format!("Failed to read window size: {error}"))?;
    let physical_position = window
        .outer_position()
        .map_err(|error| format!("Failed to read window position: {error}"))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("Failed to read window scale factor: {error}"))?;

    let size = physical_size.to_logical::<f64>(scale_factor);
    let position = physical_position.to_logical::<f64>(scale_factor);

    if size.width <= 0.0 || size.height <= 0.0 {
        return Ok(());
    }

    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
    };

    let state_path = app_file_path(&window.app_handle(), WINDOW_STATE_FILE_NAME)?;
    write_json_file(&state_path, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));

                if let Some(window) = app_handle.get_webview_window("main") {
                    let host_window = window.as_ref().window();
                    let _ = restore_window_state(&host_window);
                    let _ = host_window.show();
                }

                WINDOW_SAVE_ENABLED.store(true, Ordering::Release);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
            ) || (WINDOW_SAVE_ENABLED.load(Ordering::Acquire)
                && matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)))
            {
                let _ = save_window_state(window);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
