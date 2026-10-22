import assert from 'node:assert/strict'
import * as THREE from 'three'
import { restoreRenderableMeshes } from '../src/lib/animation/ModelRenderableMeshes.ts'

const root = new THREE.Group()
const hiddenGroup = new THREE.Group()
hiddenGroup.visible = false
root.add(hiddenGroup)

const staticMaterial = new THREE.MeshBasicMaterial()
const secondaryStaticMaterial = new THREE.MeshBasicMaterial()
staticMaterial.visible = false
secondaryStaticMaterial.visible = false
const staticMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [staticMaterial, secondaryStaticMaterial])
staticMesh.visible = false
hiddenGroup.add(staticMesh)

const bone = new THREE.Bone()
bone.name = 'Hips'
bone.position.set(0, 1, 0)
root.add(bone)
const skinGeometry = new THREE.BufferGeometry()
skinGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -0.5, 0, 0,
  0.5, 0, 0,
  0, 1, 0,
], 3))
const skinMaterial = new THREE.MeshBasicMaterial()
skinMaterial.visible = false
const skinnedMesh = new THREE.SkinnedMesh(skinGeometry, skinMaterial)
skinnedMesh.visible = false
skinnedMesh.frustumCulled = true
root.add(skinnedMesh)
root.updateMatrixWorld(true)
const skeleton = new THREE.Skeleton([bone])
skinnedMesh.bind(skeleton)

restoreRenderableMeshes(root)

assert.equal(hiddenGroup.visible, true, 'Hidden ancestor groups should be restored')
assert.equal(staticMesh.visible, true, 'Static meshes should be visible again')
assert.equal(staticMaterial.visible, true, 'All materials assigned to a mesh should be made visible')
assert.equal(secondaryStaticMaterial.visible, true, 'Secondary materials should also be restored')
assert.equal(staticMesh.frustumCulled, true, 'Static mesh frustum behavior should remain unchanged')
assert.equal(skinnedMesh.visible, true, 'Skinned meshes should be visible again')
assert.equal(skinMaterial.visible, true, 'Skinned mesh materials should be visible again')
assert.equal(skinnedMesh.frustumCulled, false, 'Skinned meshes should bypass stale rest-pose bounds')
assert.ok(skeleton.boneMatrices.every(Number.isFinite), 'Skeleton matrices should be refreshed')

console.log('Model renderable mesh restoration self-test passed.')
