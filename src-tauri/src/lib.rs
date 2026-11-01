use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use tauri_plugin_fs as _;

/// Environment variables that may point to application-specific user folders.
const ALLOWED_ROOT_ENV_VARS: &[&str] = &[
    "APPCONFIG",
    "APPDATA",
    "LOCALAPPDATA",
    "DOWNLOAD",
    "DESKTOP",
    "DOCUMENT",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_DOWNLOAD_DIR",
    "XDG_DESKTOP_DIR",
    "XDG_DOCUMENTS_DIR",
];

/// Build the allowed root list from environment variables and conventional
/// user folders. Windows does not define DOWNLOAD/DESKTOP/DOCUMENT by default,
/// so deriving these from USERPROFILE avoids rejecting normal folder-picker paths.
fn allowed_project_roots() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for variable in ALLOWED_ROOT_ENV_VARS {
        if let Some(value) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(value));
        }
    }

    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);

    if let Some(home) = home {
        for folder in ["Downloads", "Desktop", "Documents"] {
            candidates.push(home.join(folder));
        }

        #[cfg(target_os = "windows")]
        {
            candidates.push(home.join("AppData").join("Roaming"));
            candidates.push(home.join("AppData").join("Local"));
        }

        #[cfg(target_os = "macos")]
        {
            candidates.push(home.join("Library").join("Application Support"));
        }

        #[cfg(target_os = "linux")]
        {
            candidates.push(home.join(".config"));
            candidates.push(home.join(".local").join("share"));
        }
    }

    // OneDrive may relocate the standard Windows Desktop/Documents folders.
    for variable in ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"] {
        if let Some(value) = std::env::var_os(variable) {
            let root = PathBuf::from(value);
            for folder in ["Downloads", "Desktop", "Documents"] {
                candidates.push(root.join(folder));
            }
        }
    }

    let mut roots = Vec::new();
    for candidate in candidates {
        if let Ok(canonical) = fs::canonicalize(candidate) {
            if canonical.is_dir() && !roots.contains(&canonical) {
                roots.push(canonical);
            }
        }
    }
    roots
}

fn is_within_allowed_project_root(project: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| project.starts_with(root))
}

/// Resolve and validate the selected project directory against known user folders.
fn validate_project_directory(dir: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(dir);
    if !base.is_dir() {
        return Err("Pasta do projeto não encontrada.".into());
    }

    let canonical_base = fs::canonicalize(&base)
        .map_err(|e| format!("Não foi possível resolver a pasta do projeto: {e}"))?;
    if !is_within_allowed_project_root(&canonical_base, &allowed_project_roots()) {
        return Err("Pasta do projeto não está em um diretório permitido.".into());
    }

    Ok(canonical_base)
}

/// Resolve an in-project path while permitting the final file or intermediate
/// directories to be created later. Every existing component is canonicalized
/// before continuing, so an existing symlink cannot escape the project root.
fn resolve_relative_path(canonical_base: &Path, rel: &str) -> Result<PathBuf, String> {
    let relative = Path::new(rel);
    if rel.trim().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("Caminho inválido: {rel}"));
    }

    let components: Vec<_> = relative.components().collect();
    let mut candidate = canonical_base.to_path_buf();

    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(format!("Caminho inválido: {rel}"));
        };
        candidate.push(name);

        match fs::symlink_metadata(&candidate) {
            Ok(_) => {
                let canonical = fs::canonicalize(&candidate)
                    .map_err(|e| format!("Não foi possível resolver o caminho {rel}: {e}"))?;
                if !canonical.starts_with(canonical_base) {
                    return Err(format!("Caminho fora da pasta do projeto: {rel}"));
                }
                candidate = canonical;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // The remainder does not exist yet. It is safe to append because
                // all relative components were validated above.
                for remaining in components.iter().skip(index + 1) {
                    let Component::Normal(name) = remaining else {
                        return Err(format!("Caminho inválido: {rel}"));
                    };
                    candidate.push(name);
                }
                break;
            }
            Err(error) => {
                return Err(format!("Não foi possível acessar o caminho {rel}: {error}"));
            }
        }
    }

    if !candidate.starts_with(canonical_base) {
        return Err(format!("Caminho fora da pasta do projeto: {rel}"));
    }

    Ok(candidate)
}

/// Resolve a project-relative path, including targets that do not exist yet.
fn resolve_safe_path(dir: &str, rel: &str) -> Result<PathBuf, String> {
    let canonical_base = validate_project_directory(dir)?;
    resolve_relative_path(&canonical_base, rel)
}

/// Validates that a path exists and is a regular file, not a symlink or special file.
fn validate_regular_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Não foi possível acessar o arquivo: {e}"))?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("O caminho não é um arquivo regular.".into());
    }

    Ok(())
}

/// Joins the project folder with a relative path after validating all existing components.
fn project_path(dir: &str, rel: &str) -> Result<PathBuf, String> {
    resolve_safe_path(dir, rel)
}

/// Generate a unique sibling path for a temporary file or backup.
fn unique_sibling_path(target: &Path, suffix: &str) -> Result<PathBuf, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let parent = target.parent().ok_or_else(|| "O destino não possui uma pasta pai.".to_string())?;
    let file_name = target.file_name().ok_or_else(|| "O destino não possui um nome de arquivo.".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut name = file_name.to_os_string();
    name.push(format!(".{suffix}.{}.{}", std::process::id(), nonce));
    Ok(parent.join(name))
}

/// Atomically replace a project file while preserving the previous version if the rename fails.
fn write_project_bytes(target: &Path, contents: &[u8], rel: &str) -> Result<(), String> {
    let temp = unique_sibling_path(target, "tmp")?;
    let mut temp_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("Não foi possível criar arquivo temporário para {rel}: {e}"))?;

    if let Err(error) = temp_file.write_all(contents).and_then(|_| temp_file.sync_all()) {
        drop(temp_file);
        let _ = fs::remove_file(&temp);
        return Err(format!("Não foi possível gravar {rel}: {error}"));
    }
    drop(temp_file);

    let had_target = match fs::symlink_metadata(target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                let _ = fs::remove_file(&temp);
                return Err("O destino existente não é um arquivo regular.".into());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(format!("Não foi possível verificar o destino {rel}: {error}"));
        }
    };

    let backup = if had_target {
        let backup = unique_sibling_path(target, "bak")?;
        if let Err(error) = fs::rename(target, &backup) {
            let _ = fs::remove_file(&temp);
            return Err(format!("Não foi possível preparar a substituição de {rel}: {error}"));
        }
        Some(backup)
    } else {
        None
    };

    if let Err(error) = fs::rename(&temp, target) {
        let _ = fs::remove_file(&temp);
        if let Some(backup_path) = backup {
            if let Err(restore_error) = fs::rename(&backup_path, target) {
                return Err(format!(
                    "Falha ao salvar {rel}: {error}. Também não foi possível restaurar o arquivo anterior: {restore_error}. O backup está em {}",
                    backup_path.display()
                ));
            }
        }
        return Err(format!("Não foi possível finalizar {rel}: {error}"));
    }

    if let Some(backup_path) = backup {
        let _ = fs::remove_file(backup_path);
    }

    Ok(())
}

#[tauri::command]
fn project_exists(dir: String) -> Result<bool, String> {
    let project_root = validate_project_directory(&dir)?;
    Ok(project_root.join("project.json").is_file())
}

#[tauri::command]
fn project_file_exists(dir: String, rel: String) -> Result<bool, String> {
    let path = project_path(&dir, &rel)?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) => Ok(metadata.is_file() && !metadata.file_type().is_symlink()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Não foi possível acessar metadados: {error}")),
    }
}

#[tauri::command]
fn read_project_file(dir: String, rel: String) -> Result<String, String> {
    let path = project_path(&dir, &rel)?;
    validate_regular_file(&path)?;
    fs::read_to_string(&path).map_err(|e| format!("Não foi possível ler {rel}: {e}"))
}

#[tauri::command]
fn write_project_file(dir: String, rel: String, contents: String) -> Result<(), String> {
    let initial_target = project_path(&dir, &rel)?;
    if let Some(parent) = initial_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar a pasta: {e}"))?;
    }

    // Re-resolve after creating directories to catch symlinks or path changes.
    let target = project_path(&dir, &rel)?;
    write_project_bytes(&target, contents.as_bytes(), &rel)
}

/// Grava um recurso binário (GLB/textura) dentro da pasta resources do projeto.
#[tauri::command]
fn write_project_asset(dir: String, rel: String, base64: String) -> Result<(), String> {
    use base64::Engine as _;
    if !rel.starts_with("resources/") {
        return Err("Recursos do projeto devem ficar dentro de resources/.".into());
    }

    let initial_target = project_path(&dir, &rel)?;
    if let Some(parent) = initial_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Não foi possível criar a pasta do recurso: {e}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("Base64 inválido para o recurso {rel}: {e}"))?;

    let target = project_path(&dir, &rel)?;
    write_project_bytes(&target, &bytes, &rel)
}

/// Remove arquivos de resources/ que não são mais referenciados pelas cenas salvas.
#[tauri::command]
fn prune_project_assets(dir: String, keep: Vec<String>) -> Result<(), String> {
    use std::collections::HashSet;

    let project_root = validate_project_directory(&dir)?;
    let mut retained = HashSet::new();
    for rel in keep {
        if !rel.starts_with("resources/") {
            return Err(format!("Caminho de recurso inválido: {rel}"));
        }
        project_path(&dir, &rel)?;
        retained.insert(rel.replace('\\', "/"));
    }

    let resources = project_path(&dir, "resources")?;
    match fs::symlink_metadata(&resources) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Não foi possível acessar recursos do projeto: {error}")),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("A pasta resources precisa ser um diretório comum do projeto.".into());
        }
        Ok(_) => {}
    }

    prune_resource_directory(&resources, &project_root, &retained)?;
    Ok(())
}

fn prune_resource_directory(
    current: &Path,
    project_root: &Path,
    retained: &std::collections::HashSet<String>,
) -> Result<bool, String> {
    let canonical_current = fs::canonicalize(current)
        .map_err(|e| format!("Não foi possível resolver a pasta de recursos: {e}"))?;
    if !canonical_current.starts_with(project_root) {
        return Err("Caminho de recurso fora da pasta do projeto.".into());
    }

    let entries = fs::read_dir(&canonical_current)
        .map_err(|e| format!("Não foi possível verificar recursos antigos: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Não foi possível listar recursos: {e}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Não foi possível acessar metadados de recursos: {e}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("Recusa a seguir symlink dentro de resources: {}", path.display()));
        }

        if metadata.is_dir() {
            let canonical = fs::canonicalize(&path)
                .map_err(|e| format!("Não foi possível resolver pasta de recurso: {e}"))?;
            if !canonical.starts_with(project_root) {
                return Err("Pasta de recurso fora da pasta do projeto.".into());
            }
            if prune_resource_directory(&canonical, project_root, retained)? {
                fs::remove_dir(&canonical)
                    .map_err(|e| format!("Não foi possível remover pasta vazia de recursos: {e}"))?;
            }
        } else if metadata.is_file() {
            let relative = path.strip_prefix(project_root)
                .map_err(|_| "Caminho de recurso fora da pasta do projeto.".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if !retained.contains(&relative) {
                let latest = fs::symlink_metadata(&path)
                    .map_err(|e| format!("Não foi possível verificar {relative}: {e}"))?;
                if latest.file_type().is_symlink() || !latest.is_file() {
                    return Err(format!("Recusa a excluir um recurso não regular: {relative}"));
                }
                let canonical = fs::canonicalize(&path)
                    .map_err(|e| format!("Não foi possível resolver {relative}: {e}"))?;
                if !canonical.starts_with(project_root) {
                    return Err(format!("Caminho fora da pasta do projeto ao excluir: {relative}"));
                }
                fs::remove_file(&path)
                    .map_err(|e| format!("Não foi possível excluir recurso sem referência ({relative}): {e}"))?;
            }
        } else {
            return Err(format!("Tipo de arquivo não suportado dentro de resources: {}", path.display()));
        }
    }

    let mut remaining = fs::read_dir(&canonical_current)
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
    validate_regular_file(&path)?;
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
        let relative = entry.enclosed_name().ok_or_else(|| {
            let name = entry.name().map_err(|e| format!("Erro ao ler nome do ZIP: {e}")).unwrap_or_default();
            format!("O ZIP contém um caminho inseguro: {name}")
        })?.to_path_buf();
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

#[derive(serde::Serialize)]
struct ZipModelFile {
    path: String,
    base64: String,
}

#[derive(serde::Serialize)]
struct ZipModelBundle {
    primary_path: String,
    files: Vec<ZipModelFile>,
}

/// Abre um pacote ZIP com um modelo 3D e preserva os caminhos dos arquivos auxiliares.
/// Os caminhos são usados no frontend para resolver materiais e texturas sem extrair
/// arquivos em locais acessíveis fora do sandbox.
#[tauri::command]
fn load_model_zip(zip_path: String) -> Result<ZipModelBundle, String> {
    use base64::Engine as _;

    let zip_file = PathBuf::from(&zip_path);
    if !zip_file.is_file()
        || zip_file.extension().and_then(|e| e.to_str())
            .map(|e| !e.eq_ignore_ascii_case("zip")).unwrap_or(true)
    {
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
        let relative = entry.enclosed_name()
            .ok_or_else(|| {
                let name = entry.name().map_err(|e| format!("Erro ao ler nome do ZIP: {e}")).unwrap_or_default();
                format!("O ZIP contém um caminho inseguro: {name}")
            })?
            .to_path_buf();
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

    fn extension(path: &Path) -> String {
        path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase()
    }
    fn is_model(path: &Path) -> bool {
        matches!(extension(path).as_str(), "glb" | "gltf" | "fbx" | "obj" | "stl" | "ply" | "dae" | "3ds")
    }
    fn is_package_resource(path: &Path) -> bool {
        is_model(path) || matches!(
            extension(path).as_str(),
            "bin" | "mtl" | "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" |
            "tga" | "dds" | "ktx" | "ktx2" | "basis" | "avif" | "tif" | "tiff" |
            "hdr" | "exr"
        )
    }
    fn model_priority(path: &Path) -> u8 {
        match extension(path).as_str() {
            "glb" => 0,
            "gltf" => 1,
            "fbx" => 2,
            "obj" => 3,
            "dae" => 4,
            "3ds" => 5,
            "stl" => 6,
            "ply" => 7,
            _ => u8::MAX,
        }
    }
    fn collect_files(root: &Path, directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
        let entries = fs::read_dir(directory).map_err(|e| format!("Não foi possível listar arquivos do ZIP: {e}"))?;
        for entry in entries {
            let path = entry.map_err(|e| format!("Não foi possível ler um arquivo extraído: {e}"))?.path();
            if path.is_dir() {
                collect_files(root, &path, output)?;
            } else if path.is_file() && is_package_resource(&path) {
                if !path.starts_with(root) {
                    return Err("Um recurso do ZIP tentou sair da pasta temporária.".into());
                }
                output.push(path);
            }
        }
        Ok(())
    }

    let mut paths = Vec::new();
    collect_files(temp.path(), temp.path(), &mut paths)?;
    let mut models: Vec<PathBuf> = paths.iter().filter(|path| is_model(path)).cloned().collect();
    models.sort_by(|a, b| model_priority(a).cmp(&model_priority(b)).then_with(|| a.cmp(b)));
    let primary = models.first().cloned().ok_or_else(|| {
        "Não encontrei um modelo 3D no ZIP. Formatos aceitos: GLB, glTF, FBX, OBJ, STL, PLY, DAE e 3DS.".to_string()
    })?;
    paths.sort();

    const MAX_PACKAGE_BYTES: u64 = 400 * 1024 * 1024;
    let mut package_bytes: u64 = 0;
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = fs::read(&path).map_err(|e| format!("Não foi possível ler {}: {e}", path.display()))?;
        package_bytes = package_bytes.saturating_add(bytes.len() as u64);
        if package_bytes > MAX_PACKAGE_BYTES {
            return Err("Os arquivos do modelo e suas texturas excedem o limite de 400 MB por pacote. Divida o ZIP ou reduza o tamanho das texturas.".into());
        }
        let relative = path.strip_prefix(temp.path())
            .map_err(|_| "Caminho de arquivo inválido dentro do ZIP.".to_string())?;
        files.push(ZipModelFile {
            path: relative.to_string_lossy().replace('\\', "/"),
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
    let primary_path = primary.strip_prefix(temp.path())
        .map_err(|_| "Caminho do modelo principal inválido dentro do ZIP.".to_string())?
        .to_string_lossy().replace('\\', "/");

    Ok(ZipModelBundle { primary_path, files })
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
    command.env("SKINTOKENS_DEVICE", "cpu");
    // This installer builds the CPU-only runtime: no CUDA device or paid inference API is needed.
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
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            project_exists,
            project_file_exists,
            read_project_file,
            write_project_file,
            write_project_asset,
            read_project_asset,
            prune_project_assets,
            load_gltf_zip,
            load_model_zip,
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

#[cfg(test)]
mod allowed_project_root_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn accepts_children_of_allowed_roots() {
        let temp = tempdir().unwrap();
        let documents = temp.path().join("Documents");
        let project = documents.join("MyProject");
        fs::create_dir_all(&project).unwrap();

        let canonical_root = fs::canonicalize(&documents).unwrap();
        let canonical_project = fs::canonicalize(&project).unwrap();
        assert!(is_within_allowed_project_root(&canonical_project, &[canonical_root]));
    }

    #[test]
    fn rejects_sibling_paths_with_a_matching_string_prefix() {
        let temp = tempdir().unwrap();
        let allowed = temp.path().join("Documents");
        let sibling = temp.path().join("Documents-backup");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&sibling).unwrap();

        let canonical_root = fs::canonicalize(&allowed).unwrap();
        let canonical_sibling = fs::canonicalize(&sibling).unwrap();
        assert!(!is_within_allowed_project_root(&canonical_sibling, &[canonical_root]));
    }
}

#[cfg(test)]
mod project_path_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn allows_missing_file_and_nested_directories() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let canonical = fs::canonicalize(&project).unwrap();

        let target = resolve_relative_path(&canonical, "scenes/main.json").unwrap();
        assert_eq!(target, canonical.join("scenes").join("main.json"));
        assert!(!target.exists());
    }

    #[test]
    fn rejects_absolute_and_traversal_paths() {
        let temp = tempdir().unwrap();
        let project = fs::canonicalize(temp.path()).unwrap();

        assert!(resolve_relative_path(&project, "../outside.json").is_err());
        assert!(resolve_relative_path(&project, "").is_err());
        assert!(resolve_relative_path(&project, "/etc/passwd").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_project() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, project.join("external")).unwrap();

        let canonical = fs::canonicalize(&project).unwrap();
        assert!(resolve_relative_path(&canonical, "external/secret.txt").is_err());
    }
}
