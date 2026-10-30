import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Lê a porta do devUrl em src-tauri/tauri.conf.json para o Vite e o Tauri sempre combinarem.
function devPort(): number {
  try {
    const conf = JSON.parse(
      readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8'),
    )
    return Number(new URL(conf?.build?.devUrl ?? 'http://localhost:5173').port) || 5173
  } catch {
    return 5173
  }
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@engine': fileURLToPath(new URL('./engine', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: devPort(),
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
