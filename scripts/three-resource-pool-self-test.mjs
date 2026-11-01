import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ThreeResourcePool } from '../engine/core/ThreeResourcePool.ts'

const pool = new ThreeResourcePool()
const geometry = new THREE.BoxGeometry(1, 1, 1)
const texture = new THREE.Texture()
const material = new THREE.MeshStandardMaterial({ map: texture })
const mesh = new THREE.Mesh(geometry, material)

let geometryDisposals = 0
let materialDisposals = 0
let textureDisposals = 0
geometry.addEventListener('dispose', () => { geometryDisposals += 1 })
material.addEventListener('dispose', () => { materialDisposals += 1 })
texture.addEventListener('dispose', () => { textureDisposals += 1 })

const sceneObjectId = pool.trackObject3D(mesh, 'scene')
const duplicateSceneObjectId = pool.trackObject3D(mesh, 'scene')
assert.equal(duplicateSceneObjectId, sceneObjectId, 'tracking the same object twice for one owner is idempotent')

pool.trackGeometry(geometry, 'physics')
pool.trackMaterial(material, 'assets')
pool.trackTexture(texture, 'textures')

pool.disposeSubsystemResources('scene')
assert.equal(geometryDisposals, 0, 'disposing an Object3D does not dispose separately tracked geometry')
assert.equal(materialDisposals, 0, 'disposing an Object3D does not dispose separately tracked material')
assert.equal(textureDisposals, 0, 'disposing an Object3D does not dispose separately tracked textures')
assert.equal(pool.getStats().totalTracked, 3, 'separately tracked resources remain registered after object cleanup')

pool.disposeSubsystemResources('physics')
assert.equal(geometryDisposals, 1, 'separately tracked geometry is disposed exactly once')
pool.disposeSubsystemResources('assets')
assert.equal(materialDisposals, 1, 'separately tracked material is disposed exactly once')
assert.equal(textureDisposals, 0, 'a material does not dispose a texture owned by a separate tracking entry')
pool.disposeSubsystemResources('textures')
assert.equal(textureDisposals, 1, 'separately tracked texture is disposed exactly once')
assert.equal(pool.getStats().totalTracked, 0, 'all owner registrations are released')

const sharedGeometry = new THREE.SphereGeometry(1, 8, 8)
let sharedDisposals = 0
sharedGeometry.addEventListener('dispose', () => { sharedDisposals += 1 })
pool.trackGeometry(sharedGeometry, 'world')
pool.trackGeometry(sharedGeometry, 'navigation')
pool.disposeSubsystemResources('world')
assert.equal(sharedDisposals, 0, 'a shared resource remains alive while another owner retains it')
pool.disposeSubsystemResources('navigation')
assert.equal(sharedDisposals, 1, 'a shared resource is disposed when its final owner releases it')

const borrowedGeometry = new THREE.PlaneGeometry(1, 1)
let borrowedDisposals = 0
borrowedGeometry.addEventListener('dispose', () => { borrowedDisposals += 1 })
const borrowedId = pool.trackGeometry(borrowedGeometry, 'manual')
assert.equal(pool.untrack(borrowedId), true)
assert.equal(pool.untrack(borrowedId), false)
assert.equal(borrowedDisposals, 0, 'untrack relinquishes ownership without disposing the resource')

pool.dispose()
console.log('Three.js resource-pool ownership self-test passed.')
