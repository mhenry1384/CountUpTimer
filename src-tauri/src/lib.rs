use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    menu::{ContextMenu, Menu, MenuItem},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Position, Size, Window, WindowEvent,
};

#[tauri::command]
fn show_context_menu(app_handle: AppHandle) -> Result<(), String> {
    let about = MenuItem::with_id(&app_handle, "context-about", "About", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let settings =
        MenuItem::with_id(&app_handle, "context-settings", "Settings", true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app_handle, &[&about, &settings])
        .map_err(|e| e.to_string())?;
    let webview = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Window not found".to_string())?;
    menu.popup(webview.as_ref().window().clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_logical_size(app_handle: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window("main")
        .ok_or("Window not found")?;
    webview
        .as_ref()
        .window()
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_physical_size(app_handle: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window("main")
        .ok_or("Window not found")?;
    webview
        .as_ref()
        .window()
        .set_size(Size::Physical(PhysicalSize::new(width, height)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_physical_position(app_handle: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window("main")
        .ok_or("Window not found")?;
    webview
        .as_ref()
        .window()
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|e| e.to_string())
}

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
        .invoke_handler(tauri::generate_handler![
            set_logical_size,
            set_physical_size,
            set_physical_position,
            show_context_menu
        ])
        .on_menu_event(|app, event| {
            let action = match event.id().0.as_str() {
                "context-about" => Some("about"),
                "context-settings" => Some("settings"),
                _ => None,
            };
            if let Some(action) = action {
                if let Some(webview) = app.get_webview_window("main") {
                    let _ = webview.emit("contextmenu-action", action);
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let empty_menu = Menu::new(app)?;
                app.set_menu(empty_menu)?;
            }

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
