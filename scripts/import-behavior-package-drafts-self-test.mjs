import assert from 'node:assert/strict'
import type { BehaviorPackageDefinition, ModelControlBindings, PackageJsonValue } from '../engine/index.ts'
import {
  cloneImportBehaviorPackageSettings,
  createImportBehaviorPackageDraft,
  mergeImportBehaviorPackageDraft,
} from '../src/lib/assets/ImportBehaviorPackageDrafts.ts'

const controls: ModelControlBindings = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
}

const mountDefinition = {
  id: 'mount',
  variables: [{ name: 'speed', defaultValue: 4 }],
  defaultConfig: {
    controlBindings: { forward: 'ArrowUp', backward: 'ArrowDown', custom: 'KeyQ' },
    interactionKey: 'KeyF',
    seatOffset: [0, 0.5, 0],
    mode: 'horse',
  },
} as unknown as BehaviorPackageDefinition

const initial = createImportBehaviorPackageDraft(mountDefinition, controls)
assert.equal(initial.variables.speed, 4)
assert.deepEqual(initial.config.controlBindings, {
  forward: 'KeyW',
  backward: 'KeyS',
  custom: 'KeyQ',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
})
assert.equal(initial.config.interactionKey, 'KeyE')
assert.deepEqual(initial.config.seatOffset, [0, 0.5, 0])
assert.equal((mountDefinition.defaultConfig as Record<string, PackageJsonValue>).interactionKey, 'KeyF', 'Creating a draft must not mutate package defaults')

const existing = {
  variables: { speed: 8, customValue: true },
  config: {
    controlBindings: { forward: 'KeyI', custom: 'KeyP' } as unknown as PackageJsonValue,
    interactionKey: 'KeyI',
    extraConfig: { enabled: true } as unknown as PackageJsonValue,
  },
}
const merged = mergeImportBehaviorPackageDraft(mountDefinition, controls, existing)
assert.equal(merged.variables.speed, 8)
assert.equal(merged.variables.customValue, true)
assert.deepEqual(merged.config.controlBindings, {
  forward: 'KeyI',
  backward: 'KeyS',
  custom: 'KeyP',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  interact: 'KeyE',
})
assert.equal(merged.config.interactionKey, 'KeyI')
assert.deepEqual(merged.config.extraConfig, { enabled: true })

const otherDefinition = {
  ...mountDefinition,
  id: 'follow',
  defaultConfig: { controlBindings: { forward: 'ArrowUp' }, interactionKey: 'default' },
} as unknown as BehaviorPackageDefinition
const otherDraft = createImportBehaviorPackageDraft(otherDefinition, controls)
assert.deepEqual(otherDraft.config.controlBindings, { forward: 'ArrowUp' }, 'Only the mount package should inherit component control bindings')
assert.equal(otherDraft.config.interactionKey, 'default')

const cloned = cloneImportBehaviorPackageSettings({ mount: merged })
;(cloned.mount!.config.extraConfig as Record<string, PackageJsonValue>).enabled = false
;(cloned.mount!.variables as Record<string, PackageJsonValue>).speed = 99
assert.deepEqual(merged.config.extraConfig, { enabled: true }, 'Cloned nested config must be independent')
assert.equal(merged.variables.speed, 8, 'Cloned variable settings must be independent')

console.log('Import behavior package drafts self-test passed.')
