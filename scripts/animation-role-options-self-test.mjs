import assert from 'node:assert/strict'
import {
  ANIMATION_ROLE_BASE_OPTIONS,
  ANIMATION_ROLE_CONTROL_BINDING_KEYS,
} from '../src/lib/animation/AnimationRoleOptions.ts'

const roles = ANIMATION_ROLE_BASE_OPTIONS.map(option => option.value)
assert.equal(roles.length, 41, 'The import dialog should keep its 41 supported animation roles')
assert.equal(new Set(roles).size, roles.length, 'Animation role IDs must be unique')
assert.ok(ANIMATION_ROLE_BASE_OPTIONS.every(option => option.label.trim().length > 0), 'Every animation role must have a visible label')

for (const [role, bindingKey] of Object.entries(ANIMATION_ROLE_CONTROL_BINDING_KEYS)) {
  assert.ok(roles.includes(role), `Control binding refers to an unknown animation role: ${role}`)
  assert.ok(typeof bindingKey === 'string' && bindingKey.length > 0, `Missing control binding for ${role}`)
}

assert.equal(ANIMATION_ROLE_CONTROL_BINDING_KEYS.walk, 'forward')
assert.equal(ANIMATION_ROLE_CONTROL_BINDING_KEYS.walk_slow, 'walkToggle')
assert.equal(ANIMATION_ROLE_CONTROL_BINDING_KEYS.run_stop, 'run')
assert.equal(ANIMATION_ROLE_CONTROL_BINDING_KEYS.mount, 'interact')
assert.equal(ANIMATION_ROLE_CONTROL_BINDING_KEYS.dismount, 'interact')
assert.equal(
  ANIMATION_ROLE_BASE_OPTIONS.find(option => option.value === 'dismount')?.label,
  'Desmontar / descer',
)

console.log('Animation role options self-test passed.')
