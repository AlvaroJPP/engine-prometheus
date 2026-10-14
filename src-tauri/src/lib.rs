use std::fs;
use std::path::{Component, Path, PathBuf};

/// Junta a pasta do projeto com um caminho relativo, recusando "..", caminhos absolutos etc.
fn project_path(dir: &str, rel: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(dir);
    if !base.is_dir() {
        return Err("Pasta do projeto não encontrada.".into());
    }
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("Caminho inválido: {rel}"));
    }
    Ok(base.join(rel_path))
}

#[tauri::command]
fn project_exists(dir: String) -> bool {
    Path::new(&dir).join("project.json").is_file()
}

#[tauri::command]
fn read_project_file(dir: String, rel: String) -> Result<String, String> {
    let path = project_path(&dir, &rel)?;
    fs::read_to_string(&path).map_err(|e| format!("Não foi possível ler {rel}: {e}"))
}

#[tauri::command]
fn write_project_file(dir: String, rel: String, contents: String) -> Result<(), String> {
    let target = project_path(&dir, &rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar a pasta: {e}"))?;
    }
    // Escreve num arquivo temporário e troca no final, para não corromper o projeto se algo falhar.
    let mut tmp_name = target.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp = PathBuf::from(tmp_name);
    fs::write(&tmp, contents).map_err(|e| format!("Não foi possível gravar {rel}: {e}"))?;

    // No Windows, rename não substitui um destino existente. Isso fazia o segundo
    // salvamento falhar para project.json, cenas e logic/events.json.
    match fs::rename(&tmp, &target) {
        Ok(()) => Ok(()),
        Err(first_error) if target.exists() => {
            fs::remove_file(&target)
                .map_err(|e| format!("Não foi possível substituir {rel}: {e}"))?;
            fs::rename(&tmp, &target)
                .map_err(|e| format!("Não foi possível finalizar {rel}: {e}"))
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(format!("Não foi possível finalizar {rel}: {e}"))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project_exists,
            read_project_file,
            write_project_file
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
