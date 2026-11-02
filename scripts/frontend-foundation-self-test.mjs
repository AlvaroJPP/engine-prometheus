import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../src/App.vue')
const styles = read('../src/style.css')
const entry = read('../ep-work/src/main.ts')
const html = read('../ep-work/index.html')

assert.ok(app.includes('useEditor(canvas)'), 'A nova interface deve continuar conectada ao motor real')
assert.ok(app.includes('data-testid="engine-canvas"'), 'Viewport 3D deve existir')
assert.ok(app.includes('data-testid="editor-shell"'), 'Shell principal deve existir')
assert.ok(app.includes("addPrimitive('cube')"), 'Criação de cubos deve estar conectada')
assert.ok(app.includes('enterPlayMode()'), 'Execução deve estar conectada')
assert.ok(app.includes('saveProject()'), 'Salvamento deve estar conectado')
assert.ok(styles.includes('grid-template-columns: minmax(190px, 232px) minmax(0, 1fr) minmax(240px, 280px)'))
assert.ok(styles.includes('@media (max-width: 1100px)'))
assert.ok(styles.includes('@media (max-width: 620px)'))
assert.ok(entry.includes('../../src/App.vue'))
assert.ok(entry.includes('../../src/style.css'))
assert.ok(html.includes('<html lang="pt-BR">'))

for (const oldPath of [
  '../src/components/AppWorkspace.vue',
  '../src/styles/app.css',
  '../editor/viewport/EditorViewport.vue',
  '../editor/components/EditorTopBar.vue',
  '../editor/workspaces/UIWorkspace.vue',
  '../src/composables/useAppController.ts',
]) {
  assert.equal(existsSync(new URL(oldPath, import.meta.url)), false, `Interface antiga ainda existe: ${oldPath}`)
}

console.log('frontend-foundation-self-test: PASS')
