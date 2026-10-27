import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  applyVeilborneDamage,
  applyVeilborneStatus,
  calculateVeilborneSpellDamage,
  calculateVeilborneWeaponDamage,
  createVeilborneCombatant,
  isVeilborneParrySuccessful,
  restoreVeilborneResource,
  spendVeilborneResource,
  tickVeilborneStatuses,
  VEILBORNE_RUNTIME_SPELLS,
  VEILBORNE_RUNTIME_WEAPONS,
} from '../packages/veilborne/runtime/VeilborneCombat.ts'
import {
  BEHAVIOR_PACKAGE_DEFINITIONS,
  getBehaviorPackageDefinition,
} from '../engine/script/packages.ts'
import { registerBehaviorPackageDefinition } from '../engine/script/packages.ts'

const player = createVeilborneCombatant('test-player')
const quickWeapon = VEILBORNE_RUNTIME_WEAPONS.starter_arcane_sword
assert.ok(quickWeapon, 'the starter weapon must be available')
const quickDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes)
const heavyDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes, { heavy: true })
const criticalDamage = calculateVeilborneWeaponDamage(quickWeapon, player.attributes, { critical: true })
assert.ok(quickDamage > 0)
assert.ok(heavyDamage > quickDamage, 'a heavy attack must deal more damage than a quick attack')
assert.ok(criticalDamage > quickDamage, 'a critical attack must deal more damage than a regular attack')

const spell = VEILBORNE_RUNTIME_SPELLS.arcane_bolt
assert.ok(spell, 'the starter spell must be available')
assert.ok(calculateVeilborneSpellDamage(spell, player.attributes) >= spell.damage)

assert.equal(spendVeilborneResource(player, 'stamina', 25), true)
assert.equal(player.resources.stamina, 75)
assert.equal(spendVeilborneResource(player, 'stamina', 100), false)
assert.equal(player.resources.stamina, 75)
assert.equal(restoreVeilborneResource(player, 'stamina', 100), 25)
assert.equal(player.resources.stamina, player.resources.maxStamina)

const target = createVeilborneCombatant('test-target')
target.resistances.physical = 50
const hit = applyVeilborneDamage(target, { amount: 20, type: 'physical', postureDamage: 12 })
assert.equal(hit.vitalityDamage, 10, '50% resistance must halve physical damage')
assert.equal(target.resources.posture, 12)
assert.equal(hit.killed, false)

applyVeilborneStatus(target, {
  id: 'burn',
  potency: 2,
  remainingSeconds: 3,
  stacks: 1,
})
applyVeilborneStatus(target, {
  id: 'burn',
  potency: 3,
  remainingSeconds: 2,
  stacks: 1,
})
assert.equal(target.statuses[0]?.stacks, 2, 'reapplying a status must stack it')
assert.equal(target.statuses[0]?.potency, 3, 'the strongest potency must be retained')
tickVeilborneStatuses(target, 0.5)
assert.equal(target.statuses[0]?.remainingSeconds, 2.5)
assert.equal(target.resources.posture, 8, 'posture must recover at the configured rate')
assert.equal(isVeilborneParrySuccessful(10.15, 10, 0.2), true)
assert.equal(isVeilborneParrySuccessful(10.21, 10, 0.2), false)

assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), undefined)
const testPackageDefinition = {
  id: 'veilborne_rpg',
  version: '0.1.0',
  name: 'Test VEILBORNE package',
  description: 'Test definition proving that a game package can opt in and unregister.',
  variables: [],
  triggers: [],
  conditions: [],
  actions: [],
  defaultConfig: {},
}
const unregister = registerBehaviorPackageDefinition(testPackageDefinition)
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), testPackageDefinition)
assert.ok(BEHAVIOR_PACKAGE_DEFINITIONS.includes(testPackageDefinition))
const unregisterDuplicate = registerBehaviorPackageDefinition(testPackageDefinition)
unregisterDuplicate()
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), testPackageDefinition)
unregister()
assert.equal(getBehaviorPackageDefinition('veilborne_rpg'), undefined)

// Architectural regression guard: game-specific behavior and UI must stay
// outside the reusable engine/editor files.
const genericCoreFiles = [
  '../engine/Engine.ts',
  '../engine/index.ts',
  '../engine/script/packages.ts',
  '../engine/input/ControlMaps.ts',
  '../engine/world/HumanoidAvatar.ts',
  '../src/components/RuntimeHUD.vue',
  '../src/components/RuntimeHUD.css',
  '../src/components/EditorViewport.vue',
  '../src/components/StarterAssetCatalogDialog.vue',
  '../src/components/ControlMapsDialog.vue',
]
for (const relativePath of genericCoreFiles) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  assert.doesNotMatch(
    source,
    /veilborne/i,
    relativePath + ' must not import or reference game-specific VEILBORNE logic',
  )
}

console.log('VEILBORNE combat, opt-in registration and core-isolation self-test passed.')
