import assert from 'node:assert/strict'
import { resolveVeilborneGameModuleControls } from '../packages/veilborne/runtime/VeilborneControls.ts'

const wasd = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
  primaryAction: 'KeyF',
  secondaryAction: 'KeyG',
  toggleFirstPerson: 'KeyQ',
  cycleCamera: 'KeyC',
  exitRuntime: 'F10',
}
const defaultControls = resolveVeilborneGameModuleControls(wasd)
assert.deepEqual(defaultControls, {
  block: 'KeyR',
  parry: 'KeyY',
  targetLock: 'KeyO',
})
assert.equal(new Set(Object.values(defaultControls)).size, 3, 'defensive keys must be distinct')
for (const key of Object.values(defaultControls)) {
  assert.ok(!Object.values(wasd).includes(key), key + ' must not collide with an active control')
}

const keyOReserved = {
  ...wasd,
  primaryAction: 'KeyR',
  toggleFirstPerson: 'KeyO',
  interact: 'KeyH',
}
const conflictControls = resolveVeilborneGameModuleControls(keyOReserved)
assert.equal(new Set(Object.values(conflictControls)).size, 3, 'resolved controls must be distinct after conflicts')
for (const key of Object.values(conflictControls)) {
  assert.ok(!Object.values(keyOReserved).includes(key), key + ' must not collide with an occupied key')
}
assert.notEqual(conflictControls.targetLock, 'KeyO', 'target lock must avoid the first-person control')

const configuredControls = resolveVeilborneGameModuleControls(wasd, {
  block: 'KeyT',
  parry: 'KeyV',
  targetLock: 'KeyB',
})
assert.deepEqual(configuredControls, {
  block: 'KeyT',
  parry: 'KeyV',
  targetLock: 'KeyB',
})

const duplicateCustomControls = resolveVeilborneGameModuleControls(wasd, {
  block: 'KeyT',
  parry: 'KeyT',
  targetLock: 'KeyT',
})
assert.equal(new Set(Object.values(duplicateCustomControls)).size, 3, 'conflicting custom keys must be repaired')
for (const key of Object.values(duplicateCustomControls)) {
  assert.ok(!Object.values(wasd).includes(key), key + ' must remain free from active control bindings')
}

const esdfLike = {
  forward: 'KeyE',
  backward: 'KeyD',
  left: 'KeyS',
  right: 'KeyF',
  interact: 'KeyA',
  primaryAction: 'KeyR',
  secondaryAction: 'KeyT',
  useItem: 'KeyG',
  reload: 'KeyY',
  toggleFirstPerson: 'KeyO',
}
const esdfControls = resolveVeilborneGameModuleControls(esdfLike)
assert.equal(new Set(Object.values(esdfControls)).size, 3)
for (const key of Object.values(esdfControls)) {
  assert.ok(!Object.values(esdfLike).includes(key), key + ' must not collide with ESDF-like bindings')
}

console.log('VEILBORNE defensive controls self-test passed.')
