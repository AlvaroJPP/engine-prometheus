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

// Disponibiliza o modelo do Sketchfab em desenvolvimento e no build desktop.
function dummyModelAsset() {
  const archiveUrl = new URL('./dummy (1).zip', import.meta.url)
  return {
    name: 'dummy-model-asset',
    configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: { setHeader: (name: string, value: string) => void; end: (data: Buffer) => void }) => void) => void } }) {
      server.middlewares.use('/models/dummy.zip', (_req, res) => {
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(archiveUrl))
      })
    },
    buildStart(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
      this.emitFile({ type: 'asset', fileName: 'models/dummy.zip', source: readFileSync(archiveUrl) })
    },
  }
}

export default defineConfig({
  plugins: [vue(), dummyModelAsset()],
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
