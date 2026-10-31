import { defineConfig, UserConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Reads dev port from tauri.conf.json so Vite, Tauri, and Playwright stay in sync
export function getDevPort(tauriConfigPath: string): number {
  try {
    const conf = JSON.parse(readFileSync(new URL(tauriConfigPath, import.meta.url), 'utf-8'))
    return Number(new URL(conf?.build?.devUrl ?? 'http://localhost:5173').port) || 5173
  } catch {
    return 5173
  }
}

export function createViteConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return defineConfig({
    plugins: [],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@engine': fileURLToPath(new URL('./engine', import.meta.url)),
      },
    },
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    ...overrides,
  })
}