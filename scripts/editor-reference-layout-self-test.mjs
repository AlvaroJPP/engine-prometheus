import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { createEditorBackgroundTexture } from '../engine/world/EditorBackgroundTexture.ts'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const layout = read('../src/styles/parts/14-html-reference-fidelity.css')
const appStyles = read('../src/styles/app.css')
const workspace = read('../src/components/AppWorkspace.vue')
const worldSource = read('../engine/world/World.ts')
const tauriConfig = JSON.parse(read('../src-tauri/tauri.conf.json'))

assert.ok(layout.includes('--editor-rail-width:84px'))
assert.ok(layout.includes('--editor-hierarchy-width:268px'))
assert.ok(layout.includes('--editor-inspector-width:320px'))
assert.ok(layout.includes('height:60px!important'))
assert.ok(layout.includes('top:-44px!important'))
assert.ok(layout.includes('max-width:1320px'))
assert.ok(layout.includes('.app>.topbar .topbar-save'))
assert.ok(layout.includes('.app .viewport-tools-overlay .viewport-tool span'))
assert.ok(layout.includes('Native desktop density: keep the viewport useful'))
assert.ok(layout.includes('--editor-hierarchy-width:232px'))
assert.ok(layout.includes('--editor-inspector-width:280px'))
assert.ok(layout.includes('height:42px!important'))
assert.ok(appStyles.includes('14-html-reference-fidelity.css'))
assert.equal(tauriConfig.app.windows[0].width, 1280)
assert.equal(tauriConfig.app.windows[0].height, 720)
assert.equal(tauriConfig.app.windows[0].minWidth, 1024)
assert.equal(tauriConfig.app.windows[0].minHeight, 640)
assert.equal(tauriConfig.app.windows[0].center, true)

const structure = ['<EditorTopBar', '<EditorSideRail', '<SceneHierarchy', '<EditorViewport', '<InspectorPanel']
for (const component of structure) assert.ok(workspace.includes(component), 'Componente ausente: ' + component)
for (let index = 1; index < structure.length; index += 1) {
  assert.ok(workspace.indexOf(structure[index - 1]) < workspace.indexOf(structure[index]), 'Ordem incorreta: ' + structure[index])
}

assert.ok(worldSource.includes("import { createEditorBackgroundTexture } from './EditorBackgroundTexture'"))
assert.ok(worldSource.includes('private readonly editorBackgroundTexture = createEditorBackgroundTexture()'))
assert.ok(worldSource.includes('this.skyTextureDataUrl && this.skyBackgroundTexture ? this.skyBackgroundTexture : this.editorBackgroundTexture'))
assert.ok(worldSource.includes('this.scene.background = this.horizonColor'))

const files = [
  '../editor/components/EditorTopBar.vue',
  '../editor/components/EditorToolbar.vue',
  '../editor/components/SceneHierarchy.vue',
  '../editor/viewport/EditorViewport.vue',
  '../editor/workspaces/PlayerWorkspace.vue',
  '../editor/workspaces/UIWorkspace.vue',
  '../src/components/AppWorkspace.vue',
  '../src/components/EditorSideRail.vue',
  '../src/components/InspectorPanel.vue',
]
const hasMojibake = (source) => {
  for (let index = 0; index < source.length - 1; index += 1) {
    const first = source.charCodeAt(index)
    const second = source.charCodeAt(index + 1)
    if ((first === 0x00c2 || first === 0x00c3 || first === 0x00e2) && second >= 0x0080 && second <= 0x00bf) {
      return true
    }
  }
  return false
}
for (const path of files) {
  assert.equal(hasMojibake(read(path)), false, 'UTF-8 corrompido: ' + path)
}

const texture = createEditorBackgroundTexture()
assert.ok(texture instanceof THREE.DataTexture)
assert.equal(texture.name, 'EditorReferenceBackground')
assert.equal(texture.image.width, 2)
assert.equal(texture.image.height, 1024)
assert.equal(texture.colorSpace, THREE.SRGBColorSpace)

const pixels = texture.image.data
const colorAt = (position) => {
  const y = Math.round((1 - position) * (texture.image.height - 1))
  const offset = y * texture.image.width * 4
  return Array.from(pixels.slice(offset, offset + 4))
}
const matchesColor = (actual, expected) =>
  actual.every((value, index) => Math.abs(value - expected[index]) <= 1)
assert.ok(matchesColor(colorAt(0), [0x17, 0x1b, 0x2b, 255]), 'Cor superior do gradiente incorreta')
assert.ok(matchesColor(colorAt(1), [0x10, 0x10, 0x13, 255]), 'Cor inferior do gradiente incorreta')

texture.dispose()
console.log('editor-reference-layout-self-test: PASS')
