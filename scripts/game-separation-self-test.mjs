import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.css'])
const forbiddenGameReference = /veilborne/i

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath))
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

const coreRoots = ['engine', 'src']
const violations = []

for (const directory of coreRoots) {
  for (const file of await listSourceFiles(path.join(root, directory))) {
    const source = await readFile(file, 'utf8')
    if (forbiddenGameReference.test(source)) {
      violations.push(path.relative(root, file).replaceAll(path.sep, '/'))
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `O núcleo/editor não pode depender de um jogo específico. Referências VEILBORNE encontradas: ${violations.join(', ')}`,
)

const engineSource = await readFile(path.join(root, 'engine/Engine.ts'), 'utf8')
const moduleContract = await readFile(path.join(root, 'engine/runtime/GameModule.ts'), 'utf8')
const gameModule = await readFile(path.join(root, 'packages/veilborne/runtime/VeilborneGameModule.ts'), 'utf8')
const gameHost = await readFile(path.join(root, 'packages/veilborne/ui/VeilborneGameHost.vue'), 'utf8')

assert.match(engineSource, /gameModules\?: readonly EngineGameModule\[\]/, 'A engine deve aceitar módulos de jogo por contrato genérico.')
assert.match(engineSource, /new GameModuleRegistry\(\)/, 'A engine deve gerenciar extensões por registro genérico.')
assert.match(engineSource, /this\.gameModules\.attach\(moduleContext\)/, 'O contexto genérico deve ser associado ao registro.')
assert.match(moduleContract, /export interface EngineGameModule/, 'O contrato de extensão deve ser público e genérico.')
assert.doesNotMatch(moduleContract, /veilborne/i, 'O contrato genérico não pode citar jogos específicos.')
assert.match(gameModule, /implements EngineGameModule/, 'VEILBORNE deve implementar o contrato genérico.')
assert.match(gameModule, /from ['"]\.\.\/\.\.\/\.\.\/engine\/runtime\/GameModule['"]/, 'O pacote deve depender do contrato público do núcleo.')
assert.match(gameHost, /engine\.registerGameModule\(gameModule\)/, 'O host opcional deve registrar o jogo explicitamente.')
assert.match(gameHost, /if \(!engine \|\| !enabled\) return/, 'O pacote não pode ser ativado sem opt-in do host.')
const avatarSource = await readFile(path.join(root, 'engine/world/HumanoidAvatar.ts'), 'utf8')
assert.match(avatarSource, /registerManeuverAdmission\(/, 'O avatar deve permitir que módulos registrem regras de manobra independentes.')
assert.match(avatarSource, /maneuverAdmissions\.values\(\)/, 'As regras de manobra devem ser compostas, sem sobrescrever outros módulos.')
assert.match(gameModule, /registerManeuverAdmission\([\s\S]*?this\.active \? combatRuntime\.admitManeuver\(kind\) : true/, 'Regras de combate não podem restringir a movimentação quando VEILBORNE está inativo.')
assert.match(gameModule, /onRuntimeStop\(\): void \{[\s\S]*?this\.active = false/, 'O módulo deve desativar as regras específicas ao sair do runtime.')
assert.match(gameModule, /onDispose\(\): void \{[\s\S]*?unregisterManeuverAdmission\?\.\(\)/, 'O módulo deve remover apenas a própria regra de movimentação ao ser descartado.')

console.log('Game separation self-test passed: o núcleo/editor não referencia VEILBORNE e o pacote usa o contrato genérico.')
