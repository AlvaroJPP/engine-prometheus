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
const mojibake = new RegExp('(?:\\\\u00c3[\\\\u0080-\\\\u00bf]|\\\\u00c2[\\\\u0080-\\\\u00bf]|\\\\u00e2[\\\\u0080-\\\\u00bf])', 'u')
for (const path of files) assert.doesNotMatch(read(path), mojibake, 'UTF-8 corrompido: ' + path)

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
