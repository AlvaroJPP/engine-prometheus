import assert from 'node:assert/strict'
import {
  BEHAVIOR_PACKAGE_DEFINITIONS,
  registerBehaviorPackageDefinition,
} from '../engine/script/packages.ts'

const definition = {
  id: 'registration-lifecycle-test',
  version: '1.0.0',
  name: 'Registration lifecycle test',
  description: 'Test-only behavior package definition.',
  variables: [],
  triggers: [],
  conditions: [],
  actions: [],
  defaultConfig: {},
}

assert.equal(
  BEHAVIOR_PACKAGE_DEFINITIONS.some(item => item.id === definition.id),
  false,
  'the test definition must not exist before registration',
)

const releaseFirst = registerBehaviorPackageDefinition(definition)
const releaseSecond = registerBehaviorPackageDefinition(definition)

assert.throws(
  () => registerBehaviorPackageDefinition({ ...definition }),
  /Já existe uma definição de pacote/,
  'a different definition must not silently replace a package with the same ID',
)

assert.equal(
  BEHAVIOR_PACKAGE_DEFINITIONS.filter(item => item.id === definition.id).length,
  1,
  'registering the same definition from two hosts must create one shared entry',
)

releaseFirst()
assert.equal(
  BEHAVIOR_PACKAGE_DEFINITIONS.includes(definition),
  true,
  'releasing one host must not remove a definition still used by another host',
)

releaseFirst()
assert.equal(
  BEHAVIOR_PACKAGE_DEFINITIONS.includes(definition),
  true,
  'releasing the same registration twice must be harmless',
)

releaseSecond()
assert.equal(
  BEHAVIOR_PACKAGE_DEFINITIONS.includes(definition),
  false,
  'the external definition must be removed after its final host releases it',
)

console.log('Behavior package registration self-test passed.')
