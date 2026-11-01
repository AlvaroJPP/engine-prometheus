import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { createEditorBackgroundTexture, World } from '../engine/world/World.ts'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const layout = read('../src/styles/parts/14-html-reference-fidelity.css')
const appStyles = read('../src/styles/app.css')
const workspace = read('../src/components/AppWorkspace.vue')
assert.match(layout, /--editor-rail-width:\\s*84px/)
assert.match(layout, /--editor-hierarchy-width:\\s*268px/)
assert.match(layout, /--editor-inspector-width:\\s*320px/)
assert.match(layout, /height:\\s*60px!important/)
assert.match(layout, /height:\\s*42px!important/)
assert.match(appStyles, /14-html-reference-fidelity\\.css/)
assert.match(workspace, /<EditorTopBar[\\s\\S]*?<EditorSideRail[\\s\\S]*?<SceneHierarchy[\\s\\S]*?<EditorViewport[\\s\\S]*?<InspectorPanel/)

const files = ['../editor/components/EditorTopBar.vue', '../editor/components/EditorToolbar.vue', '../editor/components/SceneHierarchy.vue', '../editor/viewport/EditorViewport.vue', '../editor/workspaces/PlayerWorkspace.vue', '../editor/workspaces/UIWorkspace.vue', '../src/components/AppWorkspace.vue', '../src/components/EditorSideRail.vue', '../src/components/InspectorPanel.vue']
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
assert.equal(texture.image.width, 2)
assert.equal(texture.image.height, 1024)
assert.equal(texture.colorSpace, THREE.SRGBColorSpace)
const world = new World()
const editorBackground = world.scene.background
assert.ok(editorBackground instanceof THREE.DataTexture)
world.setEditorAppearance(false)
assert.ok(world.scene.background instanceof THREE.Color)
world.setEditorAppearance(true)
assert.equal(world.scene.background, editorBackground)
texture.dispose()
console.log('editor-reference-layout-self-test: PASS')
