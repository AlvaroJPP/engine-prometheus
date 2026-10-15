use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

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
fn project_file_exists(dir: String, rel: String) -> Result<bool, String> {
    let path = project_path(&dir, &rel)?;
    Ok(path.is_file())
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
    // Escreve em arquivo temporário antes de substituir o destino.
    let mut tmp_name = target.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp = PathBuf::from(tmp_name);
    let mut backup_name = target.as_os_str().to_owned();
    backup_name.push(".bak");
    let backup = PathBuf::from(backup_name);
    fs::write(&tmp, contents).map_err(|e| format!("Não foi possível gravar {rel}: {e}"))?;

    // O Windows não substitui um destino existente com fs::rename. Preservamos
    // o arquivo anterior como backup e restauramos se a troca não for concluída.
    let had_target = target.exists();
    if had_target {
        let _ = fs::remove_file(&backup);
        if let Err(e) = fs::rename(&target, &backup) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("Não foi possível preparar a substituição de {rel}: {e}"));
        }
    }

    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        if had_target {
            if let Err(restore_error) = fs::rename(&backup, &target) {
                return Err(format!("Falha ao salvar {rel}: {e}. Também não foi possível restaurar o arquivo anterior: {restore_error}. O backup está em {}", backup.display()));
            }
        }
        return Err(format!("Não foi possível finalizar {rel}: {e}"));
    }

    if had_target {
        let _ = fs::remove_file(&backup);
    }
    Ok(())
}


/// Procura uma instalação local do Blender. BLENDER_EXECUTABLE pode apontar
/// explicitamente para blender.exe caso ele não esteja em um caminho padrão.
fn find_blender() -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var("BLENDER_EXECUTABLE") {
        let path = PathBuf::from(configured.trim_matches('"'));
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("BLENDER_EXECUTABLE aponta para um arquivo inexistente: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
            if let Some(root) = std::env::var_os(variable) {
                let root = PathBuf::from(root);
                let roots = [
                    root.join("Blender Foundation"),
                    root.join("Programs").join("Blender Foundation"),
                ];
                for directory in roots {
                    if directory.is_dir() {
                        if let Ok(entries) = fs::read_dir(&directory) {
                            let mut installs: Vec<PathBuf> = entries.flatten()
                                .map(|entry| entry.path())
                                .filter(|path| path.is_dir())
                                .collect();
                            installs.sort();
                            installs.reverse();
                            for install in installs {
                                let exe = install.join("blender.exe");
                                if exe.is_file() { return Ok(exe); }
                                // Também reconhece instalações organizadas como Blender/4.x.
                                if let Ok(versions) = fs::read_dir(&install) {
                                    let mut versions: Vec<PathBuf> = versions.flatten()
                                        .map(|entry| entry.path())
                                        .filter(|path| path.is_dir())
                                        .collect();
                                    versions.sort();
                                    versions.reverse();
                                    for version in versions {
                                        let exe = version.join("blender.exe");
                                        if exe.is_file() { return Ok(exe); }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let app = PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender");
        if app.is_file() { return Ok(app); }
    }

    #[cfg(target_os = "linux")]
    {
        for candidate in ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"] {
            let path = PathBuf::from(candidate);
            if path.is_file() { return Ok(path); }
        }
    }

    // Se estiver no PATH, o spawn abaixo consegue resolver o nome do programa.
    Ok(PathBuf::from(if cfg!(target_os = "windows") { "blender.exe" } else { "blender" }))
}

#[tauri::command]
fn convert_blend_zip(zip_path: String) -> Result<String, String> {
    let zip_file = PathBuf::from(&zip_path);
    if !zip_file.is_file() || zip_file.extension().and_then(|e| e.to_str()).map(|e| !e.eq_ignore_ascii_case("zip")).unwrap_or(true) {
        return Err("Selecione um arquivo ZIP válido.".into());
    }

    let temp = tempfile::tempdir().map_err(|e| format!("Não foi possível criar pasta temporária: {e}"))?;
    let input = File::open(&zip_file).map_err(|e| format!("Não foi possível abrir o ZIP: {e}"))?;
    let mut archive = zip::ZipArchive::new(input).map_err(|e| format!("ZIP inválido ou corrompido: {e}"))?;
    if archive.len() > 20_000 {
        return Err("O ZIP contém arquivos demais (limite: 20.000).".into());
    }

    let mut extracted_bytes: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| format!("Não foi possível ler item do ZIP: {e}"))?;
        let relative = entry.enclosed_name().ok_or_else(|| format!("O ZIP contém um caminho inseguro: {}", entry.name()))?.to_path_buf();
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > 1_500_000_000 {
            return Err("O conteúdo descompactado excede o limite de 1,5 GB.".into());
        }
        let destination = temp.path().join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| format!("Não foi possível criar pasta extraída: {e}"))?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar pasta extraída: {e}"))?;
            }
            let mut output = File::create(&destination).map_err(|e| format!("Não foi possível extrair arquivo: {e}"))?;
            std::io::copy(&mut entry, &mut output).map_err(|e| format!("Falha ao extrair arquivo: {e}"))?;
            output.flush().map_err(|e| format!("Falha ao gravar arquivo extraído: {e}"))?;
        }
    }

    fn find_blend(directory: &Path) -> Option<PathBuf> {
        let entries = fs::read_dir(directory).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_blend(&path) { return Some(found); }
            } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("blend")).unwrap_or(false) {
                return Some(path);
            }
        }
        None
    }

    let blend_path = find_blend(temp.path())
        .ok_or_else(|| "Não encontrei nenhum arquivo .blend dentro do ZIP.".to_string())?;
    let output_path = temp.path().join("engine-prometheus-converted.glb");
    let script_path = temp.path().join("export_to_glb.py");
    let script = r#"import bpy, sys
args = sys.argv
if "--" not in args:
    raise RuntimeError("Caminho de saída não informado")
output_path = args[args.index("--") + 1]
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_apply=False,
)
"#;
    fs::write(&script_path, script).map_err(|e| format!("Não foi possível preparar conversão: {e}"))?;
    let blender = find_blender()?;
    let result = Command::new(&blender)
        .arg("-b")
        .arg(&blend_path)
        .arg("--python")
        .arg(&script_path)
        .arg("--")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Não consegui iniciar o Blender ({}). Instale o Blender ou defina BLENDER_EXECUTABLE com o caminho de blender.exe. Detalhe: {e}", blender.display()))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        let detail = if !stderr.trim().is_empty() { stderr } else { stdout };
        let excerpt: String = detail.chars().rev().take(3500).collect::<String>().chars().rev().collect();
        return Err(format!("O Blender não conseguiu converter o arquivo. Confira se o arquivo abre no Blender e se o exportador glTF está disponível.\n{excerpt}"));
    }
    let bytes = fs::read(&output_path).map_err(|e| format!("O Blender terminou, mas não gerou o GLB: {e}"))?;
    if bytes.len() < 20 || &bytes[0..4] != b"glTF" {
        return Err("O arquivo gerado não parece ser um GLB válido.".into());
    }
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project_exists,
            project_file_exists,
            read_project_file,
            write_project_file,
            convert_blend_zip
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
