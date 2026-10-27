import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { VeilborneVisualEffects } from '../packages/veilborne/runtime/VeilborneVisualEffects.ts'
import { VeilborneEnemyAISystem } from '../packages/veilborne/runtime/VeilborneEnemyAISystem.ts'
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
const damageSpells = Object.values(VEILBORNE_RUNTIME_SPELLS).filter(item => item.damage > 0)
assert.ok(
  damageSpells.every(item => item.targeting === 'projectile' && (item.projectileSpeed ?? 0) > 0),
  'every damaging spell must have a visible projectile path and travel speed',
)
const projectileScene = new THREE.Scene()
const projectileEffects = new VeilborneVisualEffects(projectileScene, () => {})
projectileEffects.spawnProjectile(new THREE.Vector3(0, 1, 0), new THREE.Vector3(10, 1, 0), 0x8c7cff, 1)
const projectileTrail = projectileScene.children.find(item => item instanceof THREE.Line)
assert.ok(projectileTrail, 'projectiles must create a visible trajectory line')
projectileEffects.update(0.25)
const trailPositions = projectileTrail.geometry.getAttribute('position')
assert.ok(trailPositions.getX(1) > 0, 'the trajectory line must advance with the projectile')
projectileEffects.clear()

const hudSource = await readFile(new URL('../packages/veilborne/ui/VeilborneHUD.vue', import.meta.url), 'utf8')
assert.match(hudSource, /watch\(\(\) => props\.gameVariables\.arquetipo,[\s\S]*?\{ immediate: true \}\)/)
const appWorkspaceSource = await readFile(new URL('../src/components/AppWorkspace.vue', import.meta.url), 'utf8')
assert.match(appWorkspaceSource, /<VeilborneGameHost/)
assert.match(appWorkspaceSource, /hasVeilbornePackage/)
const lootSource = await readFile(new URL('../packages/veilborne/runtime/VeilborneLootSystem.ts', import.meta.url), 'utf8')
assert.match(lootSource, /placeExistingLootOnGround\(\)/)
assert.match(lootSource, /private findGroundHeight\(/)
const enemyAiSource = await readFile(new URL('../packages/veilborne/runtime/VeilborneEnemyAISystem.ts', import.meta.url), 'utf8')
assert.match(enemyAiSource, /syncAutonomousPackages\(runtimeEnabled: boolean\)/)
assert.match(enemyAiSource, /const mode = 'idle'/)
assert.match(enemyAiSource, /autonomousAgent\.variables\.veilborne_managed !== true/)
assert.match(enemyAiSource, /const candidates = \[/)
assert.match(enemyAiSource, /updatePendingProjectiles\(dt: number\)/)
assert.match(enemyAiSource, /this\.effects\.spawnProjectile\(/)

// Regression test: a VEILBORNE-managed autonomous_agent must not suppress the
// dedicated combat AI's movement or melee attacks.
const aiScene = new THREE.Scene()
const enemyMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1.8, 1),
  new THREE.MeshBasicMaterial(),
)
enemyMesh.position.set(-5, 0.9, 0)
const enemyObject = { id: 'test-ai-enemy', name: 'Test enemy', type: 'cube', mesh: enemyMesh }
const avatarMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 1.8, 0.6),
  new THREE.MeshBasicMaterial(),
)
avatarMesh.position.set(-14, 0.9, 0)
const copyPackage = value => structuredClone(value)
const enemyPackage = {
  id: 'test-ai-enemy-package',
  ownerObjectId: enemyObject.id,
  packageId: 'veilborne_rpg',
  enabled: true,
  variables: {
    entity_role: 'combatant',
    faction: 'hostile',
    ai_enabled: true,
    ai_custom_stats: true,
    ai_profile: 'melee',
    ai_state: 'idle',
    vida: 95,
    vida_max: 95,
    move_speed: 2.7,
    perception_range: 17,
    attack_range: 1.9,
    attack_damage: 11,
    attack_damage_type: 'physical',
    attack_cooldown: 0.35,
    attack_posture_damage: 8,
    morto: false,
  },
  config: {},
}
const managedAgent = {
  id: 'test-ai-managed-agent',
  ownerObjectId: enemyObject.id,
  packageId: 'autonomous_agent',
  enabled: true,
  variables: { veilborne_managed: true, mode: 'idle', state: 'idle' },
  config: {},
}
const aiPackages = [enemyPackage, managedAgent]
let playerDamageReceived = 0
const mockLogic = {
  listPackages(ownerObjectId) {
    return aiPackages
      .filter(instance => !ownerObjectId || instance.ownerObjectId === ownerObjectId)
      .map(copyPackage)
  },
  setPackageVariable(id, name, value) {
    const instance = aiPackages.find(item => item.id === id)
    if (instance) instance.variables[name] = value
  },
  getVariable() { return false },
  triggerPackageEvent() { return false },
}
const mockWorld = {
  scene: aiScene,
  terrain: { heightAt: () => 0 },
  events: { emit() {} },
  get(id) { return id === enemyObject.id ? enemyObject : undefined },
  list() { return [enemyObject] },
  isObjectVisible() { return true },
  update(id, patch) {
    if (id !== enemyObject.id) return
    if (typeof patch.x === 'number') enemyMesh.position.x = patch.x
    if (typeof patch.y === 'number') enemyMesh.position.y = patch.y
    if (typeof patch.z === 'number') enemyMesh.position.z = patch.z
    if (typeof patch.rotationY === 'number') enemyMesh.rotation.y = THREE.MathUtils.degToRad(patch.rotationY)
    enemyMesh.updateMatrixWorld(true)
  },
}
const mockCombat = {
  getPlayerCombatant() { return { alive: true, attributes: player.attributes } },
  getHostilePackages() { return [{ instance: copyPackage(enemyPackage), object: enemyObject }] },
  getTargetCombatant() {
    return { statuses: [], resources: { vitality: 95, maxVitality: 95 } }
  },
  receiveIncomingDamage(amount) {
    playerDamageReceived += amount
    return { damage: amount, absorbedByWard: 0, blocked: false, parried: false, killed: false }
  },
  applyDamageToTarget() { return { damage: 0, killed: false } },
  getWorldPoint() { return enemyMesh.position.clone() },
}
const mockCollisions = {
  canMoveObjectTo() { return true },
}
const mockContext = {
  world: mockWorld,
  logic: mockLogic,
  avatar: { mesh: avatarMesh },
  collisions: mockCollisions,
}
const aiEffects = new VeilborneVisualEffects(aiScene, () => {})
const enemyAi = new VeilborneEnemyAISystem(mockContext, mockCombat, aiEffects)
for (let frame = 0; frame < 240; frame += 1) enemyAi.update(1 / 60)
assert.ok(enemyMesh.position.x < -5.5, 'managed VEILBORNE enemies must move toward the player')
assert.ok(playerDamageReceived > 0, 'a pursuing enemy must eventually enter attack range and deal damage')
aiEffects.clear()

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
  '../engine/runtime/GameModule.ts',
  '../engine/runtime/GameModuleRegistry.ts',
  '../engine/script/packages.ts',
  '../engine/input/ControlMaps.ts',
  '../engine/world/HumanoidAvatar.ts',
  '../src/App.vue',
  '../src/main.ts',
  '../src/components/RuntimeHUD.vue',
  '../src/components/RuntimeHUD.css',
  '../src/components/EditorViewport.vue',
  '../src/components/StarterAssetCatalogDialog.vue',
  '../src/components/ControlMapsDialog.vue',
  '../src/composables/useEditor.ts',
  '../src/composables/useAppController.ts',
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
