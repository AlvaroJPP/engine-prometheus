import vue from '@vitejs/plugin-vue'
import { createViteConfig, getDevPort } from '../vite.config.base.ts'

const port = getDevPort('../src-tauri/tauri.conf.json')

export default createViteConfig({
  plugins: [vue()],
  server: {
    port,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})