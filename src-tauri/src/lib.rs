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


/// Grava um recurso binário (GLB/textura) dentro da pasta resources do projeto.
#[tauri::command]
fn write_project_asset(dir: String, rel: String, base64: String) -> Result<(), String> {
    use base64::Engine as _;
    if !rel.starts_with("resources/") {
        return Err("Recursos do projeto devem ficar dentro de resources/.".into());
    }
    let target = project_path(&dir, &rel)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar a pasta do recurso: {e}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("Base64 inválido para o recurso {rel}: {e}"))?;
    let mut tmp_name = target.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp = PathBuf::from(tmp_name);
    fs::write(&tmp, bytes).map_err(|e| format!("Não foi possível gravar o recurso {rel}: {e}"))?;
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("Não foi possível substituir o recurso {rel}: {e}"))?;
    }
    fs::rename(&tmp, &target).map_err(|e| format!("Não foi possível finalizar o recurso {rel}: {e}"))?;
    Ok(())
}


/// Remove arquivos de resources/ que não são mais referenciados pelas cenas salvas.
#[tauri::command]
fn prune_project_assets(dir: String, keep: Vec<String>) -> Result<(), String> {
    use std::collections::HashSet;

    let project_root = PathBuf::from(&dir);
    if !project_root.is_dir() {
        return Err("Pasta do projeto não encontrada.".into());
    }

    let mut retained = HashSet::new();
    for rel in keep {
        if !rel.starts_with("resources/") {
            return Err(format!("Caminho de recurso inválido: {rel}"));
        }
        // Reutiliza a validação de caminhos para bloquear caminhos absolutos e traversal.
        project_path(&dir, &rel)?;
        retained.insert(rel.replace('\\', "/"));
    }

    let resources = project_root.join("resources");
    if !resources.exists() {
        return Ok(());
    }
    prune_resource_directory(&resources, &project_root, &retained)?;
    Ok(())
}

fn prune_resource_directory(
    current: &Path,
    project_root: &Path,
    retained: &std::collections::HashSet<String>,
) -> Result<bool, String> {
    let entries = fs::read_dir(current)
        .map_err(|e| format!("Não foi possível verificar recursos antigos: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Não foi possível listar recursos: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            if prune_resource_directory(&path, project_root, retained)? {
                fs::remove_dir(&path)
                    .map_err(|e| format!("Não foi possível remover pasta vazia de recursos: {e}"))?;
            }
        } else if path.is_file() {
            let relative = path.strip_prefix(project_root)
                .map_err(|_| "Caminho de recurso fora da pasta do projeto.".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if !retained.contains(&relative) {
                fs::remove_file(&path)
                    .map_err(|e| format!("Não foi possível excluir recurso sem referência ({relative}): {e}"))?;
            }
        }
    }

    let mut remaining = fs::read_dir(current)
        .map_err(|e| format!("Não foi possível verificar pasta de recursos: {e}"))?;
    Ok(remaining.next().is_none())
}

/// Lê um recurso binário e retorna Base64 para o carregador de cena.
#[tauri::command]
fn read_project_asset(dir: String, rel: String) -> Result<String, String> {
    use base64::Engine as _;
    if !rel.starts_with("resources/") {
        return Err("Recursos do projeto devem ficar dentro de resources/.".into());
    }
    let path = project_path(&dir, &rel)?;
    let bytes = fs::read(&path).map_err(|e| format!("Não foi possível ler o recurso {rel}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}


/// Carrega um glTF de dentro de um ZIP e incorpora buffers/texturas externos como data URIs.
/// Assim o GLTFLoader não depende de caminhos temporários após a extração.
#[tauri::command]
fn load_gltf_zip(zip_path: String) -> Result<String, String> {
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

    fn find_gltf(directory: &Path) -> Option<PathBuf> {
        let mut entries: Vec<PathBuf> = fs::read_dir(directory).ok()?.flatten().map(|entry| entry.path()).collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                if let Some(found) = find_gltf(&path) { return Some(found); }
            } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("gltf")).unwrap_or(false) {
                return Some(path);
            }
        }
        None
    }

    let gltf_path = find_gltf(temp.path())
        .ok_or_else(|| "Não encontrei nenhum arquivo .gltf dentro do ZIP. O ZIP precisa conter um glTF JSON; GLB dentro do ZIP ainda não é aceito por esta opção.".to_string())?;
    let json_text = fs::read_to_string(&gltf_path)
        .map_err(|e| format!("Não foi possível ler o arquivo glTF: {e}"))?;
    let mut document: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("O arquivo .gltf contém JSON inválido: {e}"))?;
    let base_dir = gltf_path.parent().unwrap_or(temp.path());

    fn embed_uris(items: &mut serde_json::Value, key: &str, base_dir: &Path, root: &Path) -> Result<(), String> {
        use base64::Engine as _;
        if let Some(array) = items.as_array_mut() {
            for item in array {
                let Some(uri) = item.get("uri").and_then(|v| v.as_str()).map(str::to_owned) else { continue };
                if uri.starts_with("data:") { continue; }
                if uri.contains("://") || uri.starts_with('/') || uri.starts_with('\\') {
                    return Err(format!("O glTF referencia um recurso externo não incluído no ZIP: {uri}"));
                }
                let decoded_uri = uri.replace("%20", " ");
                let clean_uri = decoded_uri.split(['?', '#']).next().unwrap_or(&decoded_uri);
                let resource_path = base_dir.join(clean_uri);
                let normalized = resource_path.components().fold(PathBuf::new(), |mut acc, part| {
                    match part {
                        Component::CurDir => {},
                        Component::ParentDir => { acc.pop(); },
                        other => acc.push(other.as_os_str()),
                    }
                    acc
                });
                if !normalized.starts_with(root) {
                    return Err(format!("Caminho de recurso inseguro no glTF: {uri}"));
                }
                let bytes = fs::read(&normalized).map_err(|_| format!("Não encontrei o recurso '{uri}' referenciado pelo glTF. Confira se o ZIP contém os arquivos .bin e as texturas."))?;
                let ext = normalized.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
                let mime = if key == "images" {
                    match ext.as_str() {
                        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp",
                        "ktx2" => "image/ktx2", "basis" => "application/octet-stream", _ => "application/octet-stream"
                    }
                } else { "application/octet-stream" };
                let data_uri = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
                item["uri"] = serde_json::Value::String(data_uri);
            }
        }
        Ok(())
    }

    if let Some(buffers) = document.get_mut("buffers") { embed_uris(buffers, "buffers", base_dir, temp.path())?; }
    if let Some(images) = document.get_mut("images") { embed_uris(images, "images", base_dir, temp.path())?; }
    serde_json::to_string(&document).map_err(|e| format!("Não foi possível preparar o glTF para pré-visualização: {e}"))
}

/// Resolve o checkpoint mantido ao lado do executável SkinTokens instalado pelo script oficial do Engine.
fn skintokens_checkpoint_for(executable: &Path) -> Option<PathBuf> {
    let root = executable.parent()?.parent()?.parent()?;
    let checkpoint = root.join("weights").join("grpo_1400.ckpt");
    checkpoint.is_file().then_some(checkpoint)
}

fn skintokens_executable(path: &str) -> Result<PathBuf, String> {
    let value = path.trim();
    if value.is_empty() {
        return Err("Informe o caminho do executável local skintokens (skintokens.exe no Windows).".into());
    }
    let executable = PathBuf::from(value);
    if !executable.is_absolute() {
        return Err("O caminho do executável SkinTokens precisa ser absoluto.".into());
    }
    if !executable.is_file() {
        return Err(format!("Não encontrei o executável SkinTokens em: {}", executable.display()));
    }
    Ok(executable)
}

fn skintokens_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    // Keep the cache/lock in the backend installation directory instead of
    // depending on HOME being defined for a Windows desktop application.
    if let Some(root) = executable.parent().and_then(Path::parent).and_then(Path::parent) {
        command.env("SKINTOKENS_HOME", root.as_os_str());
    }
    if let Some(checkpoint) = skintokens_checkpoint_for(executable) {
        command.env("SKINTOKENS_CKPT", checkpoint.as_os_str());
    }
    command
}

fn run_skintokens_glb_sync(
    executable_path: String,
    glb_base64: String,
    operation: String,
    model_class: String,
) -> Result<String, String> {
    use base64::Engine as _;

    let executable = skintokens_executable(&executable_path)?;
    if operation != "rig" && operation != "skin" {
        return Err("Operação de IA inválida. Escolha 'rig' ou 'skin'.".into());
    }
    if operation == "rig" && !["humanoid", "quadruped", "custom"].contains(&model_class.as_str()) {
        return Err("Classe de modelo inválida. Use humanoid, quadruped ou custom.".into());
    }
    let input_bytes = base64::engine::general_purpose::STANDARD
        .decode(glb_base64.as_bytes())
        .map_err(|e| format!("O GLB enviado ao SkinTokens não é Base64 válido: {e}"))?;
    const MAX_GLB_BYTES: usize = 300 * 1024 * 1024;
    if input_bytes.len() < 12 || input_bytes.len() > MAX_GLB_BYTES || &input_bytes[0..4] != b"glTF" {
        return Err("O modelo exportado não é um GLB válido ou ultrapassa o limite de 300 MB.".into());
    }

    let workspace = tempfile::tempdir()
        .map_err(|e| format!("Não foi possível criar a área temporária para a IA: {e}"))?;
    let input = workspace.path().join("input.glb");
    let output = workspace.path().join("rigged.glb");
    let report = workspace.path().join("report.json");
    fs::write(&input, input_bytes)
        .map_err(|e| format!("Não foi possível preparar o GLB para o SkinTokens: {e}"))?;

    let mut command = skintokens_command(&executable);
    command.arg(&operation).arg(&input).arg(&output).arg("--report").arg(&report).arg("--seed").arg("42");
    if operation == "rig" {
        command.arg("--class").arg(&model_class);
    }
    let result = command.output().map_err(|e| {
        format!("Não consegui iniciar o SkinTokens. Confira o executável, as dependências e o checkpoint de 1,1 GB: {e}")
    })?;
    if !result.status.success() {
        let stdout = String::from_utf8_lossy(&result.stdout);
        let stderr = String::from_utf8_lossy(&result.stderr);
        let report_text = fs::read_to_string(&report).unwrap_or_default();
        let details = if !stderr.trim().is_empty() { stderr.trim() }
            else if !report_text.trim().is_empty() { report_text.trim() }
            else { stdout.trim() };
        let details: String = details.chars().take(4_000).collect();
        return Err(format!("SkinTokens terminou com código {}. {}", result.status.code().map_or("desconhecido".into(), |code| code.to_string()), if details.is_empty() { "Consulte a instalação local e verifique se há memória RAM suficiente.".into() } else { details }));
    }
    let output_bytes = fs::read(&output)
        .map_err(|e| format!("SkinTokens terminou sem criar o GLB de saída: {e}"))?;
    if output_bytes.len() < 12 || output_bytes.len() > MAX_GLB_BYTES || &output_bytes[0..4] != b"glTF" {
        return Err("SkinTokens não gerou um GLB válido ou a saída ultrapassou o limite de 300 MB. O modelo original foi preservado.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(output_bytes))
}

/// Executa rigging/pesos no computador do usuário; não usa uma API nem envia o modelo para a nuvem.
#[tauri::command]
async fn run_skintokens_glb(
    executable_path: String,
    glb_base64: String,
    operation: String,
    model_class: String,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_skintokens_glb_sync(executable_path, glb_base64, operation, model_class)
    })
    .await
    .map_err(|e| format!("A tarefa de rigging por IA foi interrompida: {e}"))?;
    result
}

/// Diagnostica o executável e confirma se ele consegue localizar o checkpoint local.
#[tauri::command]
async fn skintokens_doctor(executable_path: String) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let executable = skintokens_executable(&executable_path)?;
        let output = skintokens_command(&executable).arg("doctor").output()
            .map_err(|e| format!("Não foi possível executar 'skintokens doctor': {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let details = if stdout.is_empty() { stderr } else if stderr.is_empty() { stdout } else { format!("{stdout}\n{stderr}") };
        if output.status.success() {
            Ok(if details.is_empty() { "SkinTokens pronto.".into() } else { details })
        } else {
            Err(format!("SkinTokens doctor retornou código {}: {}", output.status.code().map_or("desconhecido".into(), |code| code.to_string()), if details.is_empty() { "Verifique o checkpoint e as dependências.".into() } else { details }))
        }
    })
    .await
    .map_err(|e| format!("A verificação do SkinTokens foi interrompida: {e}"))?;
    result
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
            write_project_asset,
            read_project_asset,
            prune_project_assets,
            load_gltf_zip,
            run_skintokens_glb,
            skintokens_doctor
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
