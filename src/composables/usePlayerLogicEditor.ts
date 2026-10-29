import { ref } from 'vue'
import type { Ref } from 'vue'
import { PLAYER_LOGIC_SCOPE_ID, PLAYER_RUNTIME_EVENTS } from '@engine'
import type { LogicRule, PlayerRuntimeEventId } from '@engine'

type PlayerScalar = boolean | number | string

interface PlayerLogicEngine {
  logicVariables: (objectId?: string | null) => Record<string, PlayerScalar>
  setLogicVariable: (name: string, value: PlayerScalar, objectId?: string | null) => void
  removeLogicVariable: (name: string, objectId?: string | null) => boolean
  listRules: () => LogicRule[]
  upsertRule: (rule: LogicRule) => void
  removeRule: (id: string) => void
}

export interface PlayerLogicEditorDependencies {
  getEngine: () => PlayerLogicEngine | null
  isRuntime: () => boolean
  dirty: Ref<boolean>
  say: (message: string) => void
  refresh: () => void
  createUniqueRuleId: (prefix?: string) => string
}

/** Edição do escopo de lógica do jogador, separada do controller geral do editor. */
export function usePlayerLogicEditor(dependencies: PlayerLogicEditorDependencies) {
  const playerLogicVariables = ref<Record<string, PlayerScalar>>({})

  function refresh(): void {
    const engine = dependencies.getEngine()
    if (engine) playerLogicVariables.value = engine.logicVariables(PLAYER_LOGIC_SCOPE_ID)
  }

  function createPlayerLogicVariable(
    rawName: string,
    type: 'boolean' | 'number' | 'string',
    rawValue: string,
  ): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime()) return
    const name = rawName.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
      dependencies.say('Nome inválido. Use letras, números e _; o nome deve começar com letra ou _.')
      return
    }
    if (Object.prototype.hasOwnProperty.call(playerLogicVariables.value, name)) {
      dependencies.say(`A variável do jogador "${name}" já existe.`)
      return
    }

    let value: PlayerScalar
    if (type === 'boolean') {
      if (rawValue !== 'true' && rawValue !== 'false') {
        dependencies.say('Escolha true ou false para uma variável booleana.')
        return
      }
      value = rawValue === 'true'
    } else if (type === 'number') {
      if (!rawValue.trim() || !Number.isFinite(Number(rawValue))) {
        dependencies.say('Informe um número finito para a variável do jogador.')
        return
      }
      value = Number(rawValue)
    } else {
      value = rawValue
    }

    engine.setLogicVariable(name, value, PLAYER_LOGIC_SCOPE_ID)
    refresh()
    dependencies.dirty.value = true
  }

  function setPlayerLogicVariableValue(name: string, rawValue: string): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime() || !Object.prototype.hasOwnProperty.call(playerLogicVariables.value, name)) return
    const current = playerLogicVariables.value[name]
    let value: PlayerScalar = rawValue
    if (typeof current === 'boolean') {
      if (rawValue !== 'true' && rawValue !== 'false') return
      value = rawValue === 'true'
    } else if (typeof current === 'number') {
      if (!rawValue.trim() || !Number.isFinite(Number(rawValue))) {
        dependencies.say(`Valor inválido para a variável "${name}".`)
        return
      }
      value = Number(rawValue)
    }

    engine.setLogicVariable(name, value, PLAYER_LOGIC_SCOPE_ID)
    refresh()
    dependencies.dirty.value = true
  }

  function deletePlayerLogicVariable(name: string): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime()) return
    if (engine.removeLogicVariable(name, PLAYER_LOGIC_SCOPE_ID)) {
      refresh()
      dependencies.dirty.value = true
    }
  }

  /** Atualiza uma variável já declarada do jogador a partir de um botão do HUD em modo Jogar. */
  function setRuntimePlayerLogicVariable(name: string, value: PlayerScalar): void {
    const engine = dependencies.getEngine()
    if (!engine || !dependencies.isRuntime()) return
    const key = name.trim()
    if (!key || (typeof value === 'number' && !Number.isFinite(value))) return
    const current = engine.logicVariables(PLAYER_LOGIC_SCOPE_ID)[key]
    if (current === undefined) {
      dependencies.say(`A variável do jogador "${key}" não existe. Crie-a no Player Workspace antes de usá-la no HUD.`)
      return
    }
    let nextValue: PlayerScalar = value
    if (typeof current === 'string') {
      nextValue = String(value)
    } else if (typeof current === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        dependencies.say(`A variável "${key}" exige um valor numérico.`)
        return
      }
    } else if (typeof value !== 'boolean') {
      dependencies.say(`A variável "${key}" exige um valor booleano.`)
      return
    }
    engine.setLogicVariable(key, nextValue, PLAYER_LOGIC_SCOPE_ID)
    dependencies.refresh()
  }

  function addPlayerScript(name: string, eventId: PlayerRuntimeEventId, rawCode: string, rawKey = 'KeyE'): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime()) return
    if (!PLAYER_RUNTIME_EVENTS.some(event => event.id === eventId)) return
    const existingPlayerScripts = engine.listRules().filter(rule =>
      rule.trigger.type === 'player_event' && rule.ownerObjectId === PLAYER_LOGIC_SCOPE_ID,
    )
    const nextName = name.trim() || `Script do jogador ${existingPlayerScripts.length + 1}`
    const rule: LogicRule = {
      id: dependencies.createUniqueRuleId('player-script'),
      ownerObjectId: PLAYER_LOGIC_SCOPE_ID,
      name: nextName,
      enabled: true,
      trigger: { type: 'player_event', eventId, ...((eventId === 'key_pressed' || eventId === 'key_released') ? { key: rawKey.trim() || 'KeyE' } : {}) },
      conditions: [],
      actions: [{
        type: 'javascript',
        code: rawCode.trim() || "// Use api.get('score'), api.set('score', 10), api.add('score', 1) e api.toggle('portaAberta').",
      }],
    }
    engine.upsertRule(rule)
    dependencies.refresh()
    dependencies.dirty.value = true
  }

  function updatePlayerScript(rule: LogicRule): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime()) return
    if (rule.trigger.type !== 'player_event' || rule.ownerObjectId !== PLAYER_LOGIC_SCOPE_ID) return
    if (!PLAYER_RUNTIME_EVENTS.some(event => event.id === rule.trigger.eventId)) return
    const nextEventId = rule.trigger.eventId
    const nextKey = rule.trigger.key?.trim() || 'KeyE'
    const safeRule: LogicRule = {
      ...rule,
      ownerObjectId: PLAYER_LOGIC_SCOPE_ID,
      trigger: {
        type: 'player_event',
        eventId: nextEventId,
        ...((nextEventId === 'key_pressed' || nextEventId === 'key_released') ? { key: nextKey } : {}),
      },
      conditions: [...rule.conditions],
      actions: rule.actions.map(action => ({ ...action })),
    }
    engine.upsertRule(safeRule)
    dependencies.refresh()
    dependencies.dirty.value = true
  }

  function deletePlayerScript(id: string): void {
    const engine = dependencies.getEngine()
    if (!engine || dependencies.isRuntime()) return
    const rule = engine.listRules().find(item =>
      item.id === id && item.trigger.type === 'player_event' && item.ownerObjectId === PLAYER_LOGIC_SCOPE_ID,
    )
    if (!rule) return
    engine.removeRule(id)
    dependencies.refresh()
    dependencies.dirty.value = true
  }

  return {
    playerLogicVariables,
    refresh,
    createPlayerLogicVariable,
    setPlayerLogicVariableValue,
    deletePlayerLogicVariable,
    setRuntimePlayerLogicVariable,
    addPlayerScript,
    updatePlayerScript,
    deletePlayerScript,
  }
}
