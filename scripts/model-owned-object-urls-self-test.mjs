import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  collectModelOwnedObjectUrls,
  revokeOwnedObjectUrls,
} from '../src/lib/assets/ModelOwnedObjectUrls.ts'

const root = new THREE.Group()
root.userData.importOwnedObjectUrl = 'blob:root-resource'
root.userData.importOwnedObjectUrls = ['blob:shared', 'blob:root-package', 'blob:shared', '', null]

const child = new THREE.Group()
child.userData.importOwnedObjectUrl = 'blob:child-resource'
child.userData.importOwnedObjectUrls = ['blob:shared', 'blob:child-package', 42, '   ']
root.add(child)

const grandchild = new THREE.Object3D()
grandchild.userData.importOwnedObjectUrls = ['blob:grandchild-package']
child.add(grandchild)

const collected = collectModelOwnedObjectUrls(root)
assert.deepEqual(collected, [
  'blob:root-resource',
  'blob:shared',
  'blob:root-package',
  'blob:child-resource',
  'blob:child-package',
  'blob:grandchild-package',
], 'URLs should be collected in tree traversal order, excluding duplicates and invalid entries')

const revoked = []
revokeOwnedObjectUrls([
  ...collected,
  'blob:root-resource',
  undefined,
  null,
  '',
  '   ',
  123,
], url => revoked.push(url))
assert.deepEqual(revoked, collected, 'Each valid URL should be revoked once')

const emptyRevocations = []
revokeOwnedObjectUrls([], url => emptyRevocations.push(url))
assert.deepEqual(emptyRevocations, [])

console.log('Model-owned Object URLs self-test passed.')
