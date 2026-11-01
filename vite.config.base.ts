import { defineConfig, UserConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// CSP meta tag for defense-in-depth (renderer process)
const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">`

const CSP_DEV_META_TAG = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:5173 wss:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">`

function cspMetaPlugin(dev: boolean): { name: string; transformIndexHtml: (html: string) => string } {
  return {
    name: 'csp-meta',
    transformIndexHtml(html: string) {
      const tag = dev ? CSP_DEV_META_TAG : CSP_META_TAG
      return html.replace('<head>', `<head>\n  ${tag}`)
    },
  }
}

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
  const isDev = process.env.NODE_ENV !== 'production'
  return defineConfig({
    plugins: [cspMetaPlugin(isDev), ...(overrides.plugins || [])],
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
    build: {
      // Enable CSS code splitting for better caching
      cssCodeSplit: true,
      // Increase chunk size warning for large dependencies (three, rapier)
      chunkSizeWarningLimit: 1000,
      minify: 'esbuild',
      // Enable source maps for debugging
      sourcemap: true,
      // Target modern browsers for smaller bundles
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Three.js core and addons - heavy 3D library, rarely changes
            if (id.includes('three') || id.includes('three-mesh-bvh')) {
              return 'three-three-addons'
            }
            // Rapier physics engine - heavy WASM module
            if (id.includes('@dimforge/rapier3d')) {
              return 'rapier-physics'
            }
            // Vue runtime - framework core
            if (id.includes('vue') || id.includes('@vueuse/core') || id.includes('pinia')) {
              return 'vue-runtime'
            }
            // Engine core - main engine subsystems
            if (id.includes('/engine/core/') ||
                id.includes('/engine/runtime/') ||
                id.includes('/engine/world/World.ts') ||
                id.includes('/engine/world/events/') ||
                id.includes('/engine/world/map/') ||
                id.includes('/engine/view/') ||
                id.includes('/engine/input/') ||
                id.includes('/engine/script/')) {
              return 'engine-core'
            }
            // Editor features - heavy UI components loaded on demand
            if (id.includes('/src/composables/useAppController') ||
                id.includes('/src/composables/useVisualScriptController') ||
                id.includes('/src/composables/useComponentLibraryController') ||
                id.includes('/src/composables/useWorldFullscreen') ||
                id.includes('/src/composables/useFullscreenDiagnostics') ||
                id.includes('/editor/hud/HudImageStorage') ||
                id.includes('/src/lib/assets/AssetImporter') ||
                id.includes('/src/lib/assets/ComponentLibrary') ||
                id.includes('/src/lib/assets/GltfModelParser') ||
                id.includes('/src/lib/assets/ZipModelImport')) {
              return 'editor-features'
            }
            // Animation system - loaded on demand
            if (id.includes('/engine/animation/') || id.includes('/engine/lib/animation/')) {
              return 'animation-system'
            }
          },
          // Optimize chunk naming for caching
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.')
            const ext = info[info.length - 1]
            if (/\.(png|jpe?g|gif|svg|webp|avif)$/.test(assetInfo.name)) {
              return `assets/images/[name]-[hash].${ext}`
            }
            if (/\.(woff2?|eot|ttf|otf)$/.test(assetInfo.name)) {
              return `assets/fonts/[name]-[hash].${ext}`
            }
            if (/\.css$/.test(assetInfo.name)) {
              return `assets/css/[name]-[hash].${ext}`
            }
            return `assets/[name]-[hash].${ext}`
          },
        },
      },
    },
    ...overrides,
  })
}