import vue from '@vitejs/plugin-vue'
import { createViteConfig, getDevPort } from '../vite.config.base.ts'
import { fileURLToPath } from 'node:url'

const port = getDevPort('../src-tauri/tauri.conf.json')

// CSP meta tag for defense-in-depth (production)
const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">`

const cspMetaPlugin = {
  name: 'csp-meta',
  transformIndexHtml(html: string) {
    return html.replace('<head>', `<head>\n  ${CSP_META_TAG}`)
  },
}

export default createViteConfig({
  plugins: [vue(), cspMetaPlugin],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@engine': fileURLToPath(new URL('../engine', import.meta.url)),
    },
  },
  server: {
    port,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})