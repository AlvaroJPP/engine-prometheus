import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { createEditorBackgroundTexture } from '../engine/world/EditorBackgroundTexture.ts'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const layout = read('../src/styles/parts/14-html-reference-fidelity.css')
const appStyles = read('../src/styles/app.css')
const workspace = read('../src/components/AppWorkspace.vue')
const worldSource = read('../engine/world/World.ts')

assert.ok(layout.includes('--editor-rail-width:84px'))
assert.ok(layout.includes('--editor-hierarchy-width:268px'))
assert.ok(layout.includes('--editor-inspector-width:320px'))
assert.ok(layout.includes('height:60px!important'))
assert.ok(layout.includes('height:42px!important'))
assert.ok(appStyles.includes('14-html-reference-fidelity.css'))

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
const invalidUtf8Markers = [
  String.fromCharCode(0x00c3),
  String.fromCharCode(0x00c2, 0x00a0),
  String.fromCharCode(0x00e2, 0x0080),
]
for (const path of files) {
  const source = read(path)
  for (const marker of invalidUtf8Markers) {
    assert.equal(source.includes(marker), false, 'UTF-8 corrompido: ' + path)
  }
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
