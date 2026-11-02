import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../src/App.vue')
const styles = read('../src/style.css')
const entry = read('../ep-work/src/main.ts')
const html = read('../ep-work/index.html')
const topbar = read('../src/components/EditorTopBar.vue')
const rail = read('../src/components/EditorSideRail.vue')
const hierarchy = read('../src/components/SceneHierarchyPanel.vue')
const inspector = read('../src/components/EditorInspector.vue')
const controller = read('../editor/composables/useEditor.ts')

assert.ok(app.includes('useEditor(canvas)'), 'A interface deve continuar conectada ao motor real')
assert.ok(app.includes('data-testid="engine-canvas"'), 'Viewport 3D deve existir')
assert.ok(app.includes('data-testid="editor-shell"'), 'Shell principal deve existir')
assert.ok(app.includes('addImportedModel'), 'A importação de modelos deve continuar conectada')
assert.ok(app.includes('addSpawnPlatform'), 'A plataforma de spawn deve continuar conectada')
assert.ok(app.includes('setPlayerSettings'), 'Configurações do jogador devem estar conectadas')
assert.ok(app.includes('setTimeOfDay'), 'Ambiente e ciclo dia/noite devem estar conectados')
assert.ok(app.includes('setPerformanceMode'), 'Configurações de renderização devem estar conectadas')
assert.ok(topbar.includes('PROMETHEUS') && topbar.includes('update:searchQuery'))
assert.ok(rail.includes('Controles') && rail.includes('Configurações'))
assert.ok(hierarchy.includes('Agrupar') && hierarchy.includes('Componentes (0)'))
assert.ok(inspector.includes('Céu e iluminação') && inspector.includes('Velocidade de caminhada'))
assert.ok(controller.includes('    undo,') && controller.includes('    redo,'))
assert.ok(controller.includes('    copySelectedObject,') && controller.includes('    pasteObject,'))
assert.ok(styles.includes('grid-template-columns:76px 286px minmax(420px,1fr) 358px'))
assert.ok(styles.includes('.viewport-tool-dock'))
assert.ok(app.includes('data-testid="tool-grass"'))
assert.ok(app.includes('data-testid="tool-performance"'))
assert.ok(app.includes('data-testid="tool-visual-script"'))
assert.ok(styles.includes('overflow-y:auto'))
assert.ok(styles.includes('height:180px'))
assert.ok(styles.includes('overscroll-behavior:contain'))
assert.ok(styles.includes('scrollbar-width:none'))
assert.ok(styles.includes('::-webkit-scrollbar { display:none; width:0; height:0; }'))
assert.ok(styles.includes('.inspector-tabs'))
assert.ok(styles.includes('@media(max-width:700px)'))
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
