import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  isWithinModelPreviewTree,
  restoreModelPreviewVisibility,
  setModelPreviewSoloVisibility,
  toggleModelPreviewBatchSelection,
} from '../src/lib/assets/ModelPreviewSelection.ts'

const root = new THREE.Group()
root.name = 'Root'
const branchA = new THREE.Group()
branchA.name = 'BranchA'
const subgroup = new THREE.Group()
subgroup.name = 'Subgroup'
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
mesh.name = 'SelectedMesh'
const branchB = new THREE.Group()
branchB.name = 'BranchB'
const siblingMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
siblingMesh.name = 'SiblingMesh'

root.add(branchA, branchB)
branchA.add(subgroup)
subgroup.add(mesh)
branchB.add(siblingMesh)

assert.equal(isWithinModelPreviewTree(root, root), true, 'An object is within its own tree')
assert.equal(isWithinModelPreviewTree(mesh, root), true, 'Deep descendants should be recognized')
assert.equal(isWithinModelPreviewTree(mesh, branchA), true, 'Nested descendants should be recognized')
assert.equal(isWithinModelPreviewTree(branchA, mesh), false, 'A parent is not within a child tree')
assert.equal(isWithinModelPreviewTree(siblingMesh, branchA), false, 'Sibling branches must not overlap')

setModelPreviewSoloVisibility(root, subgroup)
assert.equal(root.visible, true, 'Root must stay visible')
assert.equal(branchA.visible, true, 'Ancestor group must stay visible')
assert.equal(subgroup.visible, true, 'Selected group must stay visible')
assert.equal(mesh.visible, true, 'Selected descendants must stay visible')
assert.equal(branchB.visible, false, 'Unrelated branches must be hidden')
assert.equal(siblingMesh.visible, false, 'Unrelated sibling meshes must be hidden')

restoreModelPreviewVisibility(root)
for (const node of [root, branchA, subgroup, mesh, branchB, siblingMesh]) {
  assert.equal(node.visible, true, `${node.name} should be restored`)
}

setModelPreviewSoloVisibility(root, mesh)
assert.equal(root.visible, true)
assert.equal(branchA.visible, true)
assert.equal(subgroup.visible, true)
assert.equal(mesh.visible, true)
assert.equal(branchB.visible, false)


const previewParts = [
  { id: 'branchA', name: 'BranchA', object: branchA, depth: 0, meshCount: 1 },
  { id: 'subgroup', name: 'Subgroup', object: subgroup, depth: 1, meshCount: 1 },
  { id: 'mesh', name: 'SelectedMesh', object: mesh, depth: 2, meshCount: 1 },
  { id: 'branchB', name: 'BranchB', object: branchB, depth: 0, meshCount: 1 },
  { id: 'siblingMesh', name: 'SiblingMesh', object: siblingMesh, depth: 1, meshCount: 1 },
]
assert.deepEqual(
  toggleModelPreviewBatchSelection([], previewParts, previewParts[0], true),
  ['branchA'],
  'Selecting a part adds it to the batch selection',
)
assert.deepEqual(
  toggleModelPreviewBatchSelection(['branchA'], previewParts, previewParts[1], true),
  ['subgroup'],
  'Selecting a child replaces its selected ancestor',
)
assert.deepEqual(
  toggleModelPreviewBatchSelection(['subgroup'], previewParts, previewParts[0], true),
  ['branchA'],
  'Selecting a parent replaces its selected descendants',
)
assert.deepEqual(
  toggleModelPreviewBatchSelection(['branchA'], previewParts, previewParts[3], true),
  ['branchA', 'branchB'],
  'Independent sibling branches can be selected together',
)
assert.deepEqual(
  toggleModelPreviewBatchSelection(['branchA', 'stale-id'], previewParts, previewParts[3], true),
  ['branchA', 'branchB'],
  'Selecting a part also drops stale hierarchy IDs',
)
assert.deepEqual(
  toggleModelPreviewBatchSelection(['branchA', 'branchB'], previewParts, previewParts[0], false),
  ['branchB'],
  'Unchecking a part removes only that part',
)

console.log('Model preview selection self-test passed.')
