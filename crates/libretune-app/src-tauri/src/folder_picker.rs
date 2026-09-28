//! Folder picking on Android.
//!
//! The dialog plugin has no folder picker on mobile, and Android's own picker
//! returns a content:// URI that `std::fs` cannot open. The Kotlin side
//! (`FolderPickerPlugin`, in `gen/android`) shows the system picker and copies
//! the chosen folder into the app's cache; this returns the copy's real path.
//! Desktop keeps using the dialog plugin directly from the frontend.

#[cfg(target_os = "android")]
mod imp {
    use serde::Deserialize;
    use std::sync::OnceLock;
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::Wry;

    static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

    #[derive(Deserialize)]
    struct Picked {
        #[serde(default)]
        path: Option<String>,
    }

    pub fn init() -> TauriPlugin<Wry> {
        Builder::new("folderpicker")
            .setup(|_app, api| {
                let handle = api.register_android_plugin("com.libretune.app", "FolderPickerPlugin")?;
                let _ = PLUGIN.set(handle);
                Ok(())
            })
            .build()
    }

    pub async fn pick(include_dirs: Vec<String>) -> Result<Option<String>, String> {
        let plugin = PLUGIN
            .get()
            .ok_or_else(|| "folder picker plugin not initialised".to_string())?;
        plugin
            .run_mobile_plugin_async::<Picked>(
                "pickFolder",
                serde_json::json!({ "includeDirs": include_dirs }),
            )
            .await
            .map(|p| p.path)
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    use tauri::plugin::{Builder, TauriPlugin};
    use tauri::Wry;

    pub fn init() -> TauriPlugin<Wry> {
        Builder::new("folderpicker").build()
    }

    pub async fn pick(_include_dirs: Vec<String>) -> Result<Option<String>, String> {
        Err("pick_folder_copy is Android-only; use the dialog plugin on desktop".to_string())
    }
}

pub use imp::init;

/// Shows the Android folder picker and returns the path of a local copy of the
/// chosen folder, or `None` if the user cancelled. Only top-level files and the
/// subfolders named in `include_dirs` are copied.
#[tauri::command]
pub async fn pick_folder_copy(include_dirs: Vec<String>) -> Result<Option<String>, String> {
    imp::pick(include_dirs).await
}
