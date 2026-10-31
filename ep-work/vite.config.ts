import vue from '@vitejs/plugin-vue'
import { createViteConfig, getDevPort } from '../vite.config.base.ts'
import { fileURLToPath } from 'node:url'

const port = getDevPort('../src-tauri/tauri.conf.json')

export default createViteConfig({
  plugins: [vue()],
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