# Security Posture Analysis — engine-prometheus-1 Tauri App

**Date:** 2026-11-01  
**Scope:** Tauri desktop application (main process + renderer)  
**Analyst:** Automated security review

---

## Executive Summary

| Category | Risk Level | Key Finding |
|----------|------------|-------------|
| **CSP** | 🔴 **Critical** | No CSP configured in `tauri.conf.json` or Vite; renderer fully exposed to XSS |
| **Path Traversal** | 🟢 **Low** | Robust path validation in Rust commands (`project_path`); blocks `..`, absolute paths, non-normal components |
| **TOCTOU** | 🟡 **Medium** | File operations use temp-file + rename pattern (atomic), but `prune_project_assets` reads directory then deletes without re-validation |
| **Dependencies** | 🟢 **Low** | `npm audit` — 0 vulnerabilities; minimal dependency surface |

---

## 1. Content Security Policy (CSP)

### Current State
- **`tauri.conf.json`** → `"security": { "csp": null }` (line 22–24)
- **`vite.config.base.ts`** → No CSP meta tag injection
- **Result:** Renderer process runs with **no CSP restrictions** — any XSS in Vue/Three.js/WASM code = full RCE in renderer

### Required Directives for This Stack

| Feature | Required CSP Directives |
|---------|-------------------------|
| **Vue 3 (dev/prod)** | `script-src 'self' 'unsafe-eval'` (dev needs `'unsafe-eval'` for HMR; prod can drop) |
| **Three.js / three-mesh-bvh** | `script-src 'self' 'wasm-unsafe-eval'` (WASM compile); `worker-src blob:` (if using WebWorkers) |
| **Rapier WASM (@dimforge/rapier3d-compat)** | `script-src 'self' 'wasm-unsafe-eval'`; `worker-src blob:` |
| **Vite HMR (dev only)** | `connect-src 'self' ws://localhost:5173` |
| **Inline styles (Vue SFC `<style>`)** | `style-src 'self' 'unsafe-inline'` |
| **Fonts / images** | `font-src 'self' data:`; `img-src 'self' data: blob:` |

### Recommended CSP (Production)
```json
"security": {
  "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}
```

### Recommended CSP (Development)
Add `'unsafe-eval'` to `script-src` and `connect-src ws://localhost:5173` for HMR.

---

## 2. Path Traversal / Symlink Protection

### Tauri Capabilities (`src-tauri/capabilities/default.json`)
```json
"permissions": [
  "core:default",
  "dialog:default",
  "core:window:allow-set-fullscreen",
  "core:window:allow-is-fullscreen"
]
```
- **No `fs:default` or `fs:allow-*`** → filesystem access only via **explicit invoke commands** (good)
- **`dialog:default`** → user picks folders via native dialog (no arbitrary path injection)

### Rust Path Validation (`src-tauri/src/lib.rs` → `project_path()`)
```rust
fn project_path(dir: &str, rel: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(dir);
    if !base.is_dir() { return Err("..."); }
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path.is_absolute()
        || rel_path.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("Caminho inválido: {rel}"));
    }
    Ok(base.join(rel_path))
}
```
**Strengths:**
- Rejects empty, absolute, and any component that isn't `Normal` (blocks `..`, symlinks, root, prefix)
- Enforces `resources/` prefix for asset commands (`write_project_asset`, `read_project_asset`)
- `load_gltf_zip` / `load_model_zip`: validates ZIP entries via `entry.enclosed_name()` (blocks zip-slip)

**Gaps:**
- No explicit symlink resolution check (`fs::read_link` / `canonicalize`) — if `dir` itself is a symlink, `base.is_dir()` follows it
- `prune_project_assets` uses `strip_prefix(project_root)` but doesn't re-validate after `read_dir` (minor TOCTOU, see below)

### User-Controlled Paths
| Entry Point | Control | Validation |
|-------------|---------|------------|
| `chooseFolder()` (dialog) | User picks dir | Native dialog → trusted |
| `load_gltf_zip(zip_path)` | User picks file | Extension check + `enclosed_name()` |
| `load_model_zip(zip_path)` | User picks file | Same as above |
| `run_skintokens_glb(executable_path)` | User inputs path | `is_absolute()`, `is_file()` — **no allowlist** |

---

## 3. TOCTOU (Time-of-Check-Time-of-Use)

### File Write Pattern (Atomic — Good)
```rust
// write_project_file / write_project_asset
1. Write to `<target>.tmp`
2. If target exists: rename target → `<target>.bak`
3. Rename tmp → target
4. Remove backup
```
- **Atomic on POSIX**; on Windows `fs::rename` replaces only if target doesn't exist (hence backup dance)
- **No TOCTOU** between check and write

### File Read Pattern
```rust
// read_project_file / read_project_asset
let path = project_path(&dir, &rel)?;
fs::read_to_string(&path) // or fs::read
```
- Single syscall → no TOCTOU window

### `prune_project_assets` — **Potential TOCTOU**
```rust
let entries = fs::read_dir(current)?;  // CHECK
for entry in entries {
    let path = entry.path();
    // ... compute relative ...
    if !retained.contains(&relative) {
        fs::remove_file(&path)?;       // USE (no re-validation)
    }
}
```
**Risk:** Between `read_dir` and `remove_file`, an attacker with write access to `resources/` could:
1. Replace a file with a symlink to a sensitive location
2. Win the race → arbitrary file delete

**Mitigation:** Re-validate each path with `project_path()` before deletion, or open with `O_NOFOLLOW` (not directly available in std). Since `resources/` is app-owned and user doesn't directly write there, **exploitability is low** but present.

### ZIP Extraction — **TOCTOU in `load_gltf_zip` / `load_model_zip`**
```rust
let relative = entry.enclosed_name()?;  // CHECK
let destination = temp.path().join(relative);
// ... later ...
fs::create_dir_all(parent)?;            // USE
```
- Extraction happens in **fresh temp directory** (`tempfile::tempdir()`) → attacker cannot pre-place symlinks
- **Safe** — no TOCTOU

---

## 4. Dependency Security

### `npm audit` Result
```
found 0 vulnerabilities
```

### Dependency Surface (Production)
| Package | Version | Risk Notes |
|---------|---------|------------|
| `three` | 0.187.0 | Large attack surface (parsers, loaders); keep updated |
| `@dimforge/rapier3d-compat` | 0.12.0 | WASM binary; supply-chain risk — pin exact version |
| `three-mesh-bvh` | 0.7.0 | Smaller, less exposure |
| `@types/*` | dev only | No runtime risk |

### Tauri / Rust Dependencies (from `Cargo.lock` — not shown but implied)
- `tauri` / `tauri-plugin-dialog` / `tauri-plugin-log` — keep updated via `cargo audit`
- `zip`, `tempfile`, `base64`, `serde` — standard, low risk

---

## 5. Additional Findings

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| **No `frame-ancestors` / `base-uri` / `form-action`** | Medium | CSP missing | Clickjacking, base tag hijack, form injection possible if CSP added without these |
| **`run_skintokens_glb` executes arbitrary user-provided binary** | Medium | `lib.rs:512-525` | User supplies `executable_path`; runs with `Command::new()`. No signature verification, no allowlist. |
| **`load_model_zip` returns 400 MB of base64 in single IPC call** | Low | `lib.rs:300-415` | Large IPC payload; could OOM renderer. Consider streaming/chunked transfer. |
| **No rate limiting on IPC commands** | Low | All `#[tauri::command]` | Malicious/compromised renderer could spam `write_project_file`, `prune_project_assets` |
| **`skintokens_doctor` leaks stderr/stdout** | Info | `lib.rs:528-546` | Could leak paths; sanitize in production |

---

## 6. Remediation Plan

### Phase 1 — Critical (Do First)
1. **Add CSP to `tauri.conf.json`** with production directives (see table above)
2. **Add CSP meta tag via Vite plugin** for defense-in-depth:
   ```ts
   // vite.config.base.ts
   import { defineConfig } from 'vite'
   export default defineConfig({
     plugins: [
       {
         name: 'csp-meta',
         transformIndexHtml(html) {
           return html.replace('<head>', `<head>
   <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'">`)
         }
       }
     ]
   })
   ```
3. **Run `cargo audit`** in `src-tauri/` to check Rust dependencies

### Phase 2 — High
4. **Add symlink protection** in `project_path()`:
   ```rust
   let canonical_base = base.canonicalize()?;
   let canonical_target = target.canonicalize()?;
   if !canonical_target.starts_with(&canonical_base) {
       return Err("Path escapes project directory".into());
   }
   ```
5. **Fix TOCTOU in `prune_project_assets`**: re-validate each path before `remove_file`
6. **Restrict `run_skintokens_glb`**: maintain allowlist of known-good executable hashes/paths, or require user to configure once in settings

### Phase 3 — Medium
7. **Add IPC rate limiting** (per-command token bucket in Rust)
8. **Chunk large ZIP responses** (stream base64 chunks via multiple invoke calls or Tauri `Event` system)
9. **Sanitize `skintokens_doctor` output** (strip paths, limit length)

### Phase 4 — Hardening
10. **Enable `tauri-plugin-prevent-default`** or similar to disable context menu / devtools in production
11. **Add `dangerous-disable-asset-verification: false`** (default) — ensure not overridden
12. **Consider `tauri-plugin-updater`** with signature verification for auto-updates

---

## 7. Verification Checklist

| Check | Command | Expected |
|-------|---------|----------|
| CSP present | `grep -A5 '"csp"' src-tauri/tauri.conf.json` | Non-null string |
| CSP meta in build | `grep -r "Content-Security-Policy" dist/` | Meta tag present |
| Path validation | `cargo test --test path_traversal` | (add tests) |
| Rust deps clean | `cd src-tauri && cargo audit` | 0 vulnerabilities |
| Node deps clean | `npm audit` | 0 vulnerabilities |
| No `fs:allow-*` in capabilities | `cat src-tauri/capabilities/default.json` | Only `dialog:default` |

---

## Appendix: Files Examined
- `src-tauri/tauri.conf.json` — CSP config
- `vite.config.base.ts` / `vite.config.ts` — Vite config, no CSP plugin
- `src-tauri/capabilities/default.json` — Tauri permissions
- `src/project/projectService.ts` — Frontend file I/O orchestration
- `src-tauri/src/lib.rs` — All Tauri commands (file I/O, ZIP, AI)
- `package.json` — Dependencies for `npm audit`