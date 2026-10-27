import type { ObjectInfo } from '../model/object/GameObject'
import type { World } from '../world/World'
import { EMPTY_LOGIC } from './types'
import { createBehaviorPackageInstance, getBehaviorPackageDefinition } from './packages'
import type { BehaviorPackageInstance, PackageScalar } from './packages'
import type { LogicEventsFile, LogicRule, RuleAction, RuleTrigger } from './types'
import { CombatPackageRuntime } from './CombatPackageRuntime'
import type { PackageCombatStatus, PackageDamageOptions, PackageResourceOptions } from './CombatPackageRuntime'

/** Runtime determinístico para gatilhos, condições e ações do projeto. */
type ScriptApi = {
  get: (name: string) => boolean | number | string | undefined
  set: (name: string, value: boolean | number | string) => void
  add: (name: string, amount: number) => void
  toggle: (name: string) => void
  global: { get: (name: string) => boolean | number | string | undefined; set: (name: string, value: boolean | number | string) => void; add: (name: string, amount: number) => void; toggle: (name: string) => void }
  move: (objectId: string, x: number, y: number, z: number) => void
  rotate: (objectId: string, degrees: number) => void
  setVisible: (objectId: string, visible: boolean) => void
  setColor: (objectId: string, color: string | number) => void
  combat: {
    damage: (ownerObjectId: string, options: PackageDamageOptions) => ReturnType<CombatPackageRuntime['damage']>
    restore: (ownerObjectId: string, options: PackageResourceOptions) => number
    spend: (ownerObjectId: string, options: PackageResourceOptions) => boolean
    applyStatus: (ownerObjectId: string, status: PackageCombatStatus, packageId?: string) => void
  }
  package: {
    get: (ownerObjectId: string, packageId: string, variableName: string) => PackageScalar | undefined
    set: (ownerObjectId: string, packageId: string, variableName: string, value: PackageScalar) => void
    triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
  }
}

export class RuleEngine {
  private data: LogicEventsFile = structuredClone(EMPTY_LOGIC)
  private readonly world: World
  private readonly combatPackages: CombatPackageRuntime

  constructor(world: World) {
    this.world = world
    this.combatPackages = new CombatPackageRuntime({
      getPackages: () => this.data.packages ?? [],
      emitChanged: ownerObjectId => this.world.events.emit('behaviorPackageChanged', { ownerObjectId }),
      triggerEvent: (ownerObjectId, packageId, eventId) => this.triggerPackageEvent(ownerObjectId, packageId, eventId),
    })
  }

  exportData(): LogicEventsFile {
    return structuredClone(this.data)
  }

  load(data?: LogicEventsFile): void {
    this.data = data ? structuredClone(data) : structuredClone(EMPTY_LOGIC)
    this.data.packages ??= []
    this.data.disabledPackageScripts ??= []
    for (const rule of this.data.events) {
      rule.lastInside = false
      // Migra projetos antigos para uma regra pertencente a um único objeto.
      rule.ownerObjectId ??= rule.trigger.type === 'object_clicked' || rule.trigger.type === 'package_event'
        ? rule.trigger.objectId
        : (rule.actions.find((action) => 'objectId' in action) as Extract<RuleAction, { objectId: string }> | undefined)?.objectId
    }
    this.ensureBehaviorPackageScripts()
  }

  replace(data: LogicEventsFile): void { this.load(data) }
  list(): LogicRule[] { return structuredClone(this.data.events) }
  /** Lista instâncias instaladas; cada pacote guarda seu próprio estado e configuração. */
  listPackages(ownerObjectId?: string): BehaviorPackageInstance[] {
    const packages = this.data.packages ?? []
    const filtered = ownerObjectId
      ? packages.filter(instance => instance.ownerObjectId === ownerObjectId)
      : packages
    return structuredClone(filtered)
  }

  /** Instala uma cópia independente de uma definição no objeto selecionado. */
  installPackage(ownerObjectId: string, packageId: string): BehaviorPackageInstance {
    if (!this.world.get(ownerObjectId)) throw new Error('O objeto escolhido para o pacote não existe mais.')
    if (!getBehaviorPackageDefinition(packageId)) throw new Error(`Pacote de comportamento desconhecido: "${packageId}".`)
    this.data.packages ??= []
    const installed = this.data.packages.find(item =>
      item.ownerObjectId === ownerObjectId && item.packageId === packageId,
    )
    if (installed) {
      this.ensureBehaviorPackageScripts(packageId)
      return structuredClone(installed)
    }

    const instance = createBehaviorPackageInstance(packageId, ownerObjectId)
    this.data.packages.push(instance)
    this.ensureBehaviorPackageScripts(packageId)
    return structuredClone(instance)
  }

  /** Instala os scripts declarados por uma definição como nós editáveis do Visual Script. */
  ensureBehaviorPackageScripts(packageId?: string): void {
    const disabled = new Set(this.data.disabledPackageScripts ?? [])
    for (const instance of this.data.packages ?? []) {
      if (packageId && instance.packageId !== packageId) continue
      const definition = getBehaviorPackageDefinition(instance.packageId)
      for (const template of definition?.scripts ?? []) {
        const id = `${instance.id}::${template.id}`
        if (disabled.has(id) || this.data.events.some(rule => rule.id === id)) continue
        const rule = JSON.parse(JSON.stringify(template)) as LogicRule
        rule.id = id
        rule.ownerObjectId = instance.ownerObjectId
        rule.sourcePackageInstanceId = instance.id
        rule.lastInside = false
        rule.trigger = this.bindPackageTrigger(rule.trigger, instance.ownerObjectId)
        rule.actions = rule.actions.map(action => this.bindPackageAction(action, instance.ownerObjectId))
        this.data.events.push(rule)
      }
    }
  }

  private bindPackageTrigger(trigger: RuleTrigger, ownerObjectId: string): RuleTrigger {
    const bound = JSON.parse(JSON.stringify(trigger)) as RuleTrigger
    if ('objectId' in bound && (!bound.objectId || bound.objectId === '{ID_OBJECT}')) {
      bound.objectId = ownerObjectId
    }
    return bound
  }

  private bindPackageAction(action: RuleAction, ownerObjectId: string): RuleAction {
    const bound = JSON.parse(JSON.stringify(action)) as RuleAction
    if ('objectId' in bound && (!bound.objectId || bound.objectId === '{ID_OBJECT}')) {
      bound.objectId = ownerObjectId
    }
    return bound
  }

  /** Atualiza somente os campos configuráveis, sem substituir identidade/proprietário. */
  updatePackage(
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ): void {
    const instance = (this.data.packages ?? []).find(item => item.id === id)
    if (!instance) return
    const plain = JSON.parse(JSON.stringify(patch)) as typeof patch
    if (typeof plain.enabled === 'boolean') instance.enabled = plain.enabled
    if (plain.variables) instance.variables = { ...instance.variables, ...plain.variables }
    if (plain.config) instance.config = { ...instance.config, ...plain.config }
  }

  setPackageVariable(id: string, name: string, value: PackageScalar): void {
    const instance = (this.data.packages ?? []).find(item => item.id === id)
    if (!instance || !name.trim()) return
    instance.variables[name] = value
  }

  removePackage(id: string): void {
    this.data.packages = (this.data.packages ?? []).filter(instance => instance.id !== id)
    this.data.events = this.data.events.filter(rule => rule.sourcePackageInstanceId !== id)
    this.data.disabledPackageScripts = (this.data.disabledPackageScripts ?? []).filter(scriptId => !scriptId.startsWith(`${id}::`))
  }

  variables(objectId?: string | null): Record<string, boolean | number | string> {
    return objectId ? { ...(this.data.objectVariables?.[objectId] ?? {}) } : { ...this.data.variables }
  }

  getVariable(name: string, objectId?: string | null): boolean | number | string | undefined {
    const scoped = objectId ? this.data.objectVariables?.[objectId] : undefined
    if (scoped && Object.prototype.hasOwnProperty.call(scoped, name)) return scoped[name]
    return this.data.variables[name]
  }

  setVariable(name: string, value: boolean | number | string, objectId?: string | null): void {
    const key = name.trim()
    if (!key) throw new Error('O nome da variável é obrigatório.')
    if (objectId) {
      this.data.objectVariables ??= {}
      this.data.objectVariables[objectId] ??= {}
      this.data.objectVariables[objectId]![key] = value
    } else {
      this.data.variables[key] = value
    }
  }

  removeVariable(name: string, objectId?: string | null): boolean {
    const key = name.trim()
    if (!key) return false
    const scope = objectId ? this.data.objectVariables?.[objectId] : this.data.variables
    if (!scope || !Object.prototype.hasOwnProperty.call(scope, key)) return false
    delete scope[key]
    if (objectId && Object.keys(scope).length === 0 && this.data.objectVariables) {
      delete this.data.objectVariables[objectId]
    }
    return true
  }

  removeObjectVariables(objectId: string): void {
    if (this.data.objectVariables) delete this.data.objectVariables[objectId]
    const removed = new Set((this.data.packages ?? []).filter(instance => instance.ownerObjectId === objectId).map(instance => instance.id))
    this.data.packages = (this.data.packages ?? []).filter(instance => instance.ownerObjectId !== objectId)
    this.data.events = this.data.events.filter(rule => !rule.sourcePackageInstanceId || !removed.has(rule.sourcePackageInstanceId))
    this.data.disabledPackageScripts = (this.data.disabledPackageScripts ?? []).filter(scriptId => ![...removed].some(id => scriptId.startsWith(`${id}::`)))
  }
  upsert(rule: LogicRule): void {
    const i = this.data.events.findIndex((r) => r.id === rule.id)
    // Regras vindas da interface Vue podem ser proxies reativos; structuredClone
    // lança DataCloneError nesses objetos. Converta para dados simples antes de
    // guardar, para que editar evento/condição/ação realmente atualize o runtime
    // e o próximo Ctrl+S serialize a versão editada.
    const plainRule = JSON.parse(JSON.stringify({ ...rule, lastInside: false })) as LogicRule
    if (i < 0) this.data.events.push(plainRule); else this.data.events[i] = plainRule
  }
  remove(id: string): void {
    const rule = this.data.events.find(item => item.id === id)
    if (rule?.sourcePackageInstanceId) {
      this.data.disabledPackageScripts ??= []
      if (!this.data.disabledPackageScripts.includes(id)) this.data.disabledPackageScripts.push(id)
    }
    this.data.events = this.data.events.filter(item => item.id !== id)
  }
  move(id: string, direction: -1 | 1): void {
    const index = this.data.events.findIndex((rule) => rule.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= this.data.events.length) return
    const [rule] = this.data.events.splice(index, 1)
    if (rule) this.data.events.splice(target, 0, rule)
  }

  /** Ordena eventos pela mesma ordem dos objetos exibidos na Hierarquia. */
  private rulesInHierarchyOrder(): LogicRule[] {
    const objectOrder = new Map(this.world.info().map((object, index) => [object.id, index]))
    return this.data.events
      .map((rule, index) => ({ rule, index }))
      .sort((a, b) => {
        const ownerA = a.rule.ownerObjectId ?? (a.rule.trigger.type === 'object_clicked' ? a.rule.trigger.objectId : undefined)
        const ownerB = b.rule.ownerObjectId ?? (b.rule.trigger.type === 'object_clicked' ? b.rule.trigger.objectId : undefined)
        const orderA = ownerA ? objectOrder.get(ownerA) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
        const orderB = ownerB ? objectOrder.get(ownerB) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
        return orderA - orderB || a.index - b.index
      })
      .map(({ rule }) => rule)
  }

  triggerObjectClicked(objectId: string): void {
    // Primeiro determina quais eventos correspondem ao estado atual das variáveis.
    // A execução de um script não pode alterar a condição de um evento seguinte
    // durante o mesmo clique.
    const matchingRules = this.rulesInHierarchyOrder().filter((rule) =>
      rule.enabled &&
      rule.ownerObjectId === objectId &&
      rule.trigger.type === 'object_clicked' &&
      rule.trigger.objectId === objectId &&
      this.conditionsMatch(rule, objectId)
    )

    // Executa somente os eventos elegíveis, na ordem configurada.
    for (const rule of matchingRules) this.run(rule, objectId, true)
  }

  triggerKeyPressed(key: string, objectId?: string): boolean {
    const matchingRules = this.rulesInHierarchyOrder().filter((rule) =>
      rule.enabled &&
      rule.trigger.type === 'key_pressed' &&
      rule.trigger.key === key &&
      (!objectId || rule.ownerObjectId === objectId) &&
      this.conditionsMatch(rule, rule.ownerObjectId ?? objectId)
    )
    let executed = false
    for (const rule of matchingRules) executed = this.run(rule, rule.ownerObjectId ?? objectId, true) || executed
    return executed
  }

  /** Dispara uma regra comum quando um pacote emite um dos seus gatilhos. */
  triggerPackageEvent(objectId: string, packageId: string, eventId: string): boolean {
    this.ensureBehaviorPackageScripts(packageId)
    const instance = (this.data.packages ?? []).find(item =>
      item.ownerObjectId === objectId && item.packageId === packageId,
    )
    if (!instance) return false

    const matchingRules = this.rulesInHierarchyOrder().filter(rule =>
      rule.enabled &&
      rule.ownerObjectId === objectId &&
      rule.trigger.type === 'package_event' &&
      rule.trigger.objectId === objectId &&
      rule.trigger.packageId === packageId &&
      rule.trigger.eventId === eventId &&
      this.conditionsMatch(rule, objectId, instance.variables),
    )
    let executed = false
    for (const rule of matchingRules) executed = this.run(rule, objectId, true) || executed
    return executed
  }

  /** Ações reutilizáveis para scripts e módulos de jogo. */
  applyCombatDamageToPackage(ownerObjectId: string, options: PackageDamageOptions): ReturnType<CombatPackageRuntime['damage']> {
    return this.combatPackages.damage(ownerObjectId, options)
  }

  restoreCombatPackageResource(ownerObjectId: string, options: PackageResourceOptions): number {
    return this.combatPackages.restore(ownerObjectId, options)
  }

  spendCombatPackageResource(ownerObjectId: string, options: PackageResourceOptions): boolean {
    return this.combatPackages.spend(ownerObjectId, options)
  }

  applyCombatPackageStatus(ownerObjectId: string, status: PackageCombatStatus, packageId = 'combatant'): void {
    this.combatPackages.applyStatus(ownerObjectId, status, packageId)
  }

  update(deltaSeconds = 0): void {
    this.combatPackages.update(deltaSeconds)
    const objects = this.world.info()
    // Eventos contínuos/por área também respeitam a ordem dos objetos da Hierarquia.
    for (const rule of this.rulesInHierarchyOrder()) {
      if (!rule.enabled || rule.trigger.type !== 'enter_area') continue
      const t = rule.trigger
      const candidates = rule.ownerObjectId
        ? objects.filter((object) => object.id === rule.ownerObjectId)
        : objects
      const insideObject = candidates.find((o) => distance(o, t.center) <= Math.max(0, t.radius))
      const now = insideObject !== undefined
      if (now && !rule.lastInside) this.run(rule, insideObject.id)
      rule.lastInside = now
    }
  }

  private conditionsMatch(
    rule: LogicRule,
    scopeId?: string,
    packageVariables?: Record<string, PackageScalar>,
  ): boolean {
    return rule.conditions.every((c) => {
      const scoped = scopeId ? this.data.objectVariables?.[scopeId] : undefined
      const hasPackage = !!packageVariables && Object.prototype.hasOwnProperty.call(packageVariables, c.name)
      const hasScoped = !!scoped && Object.prototype.hasOwnProperty.call(scoped, c.name)
      if (!hasPackage && !hasScoped && !Object.prototype.hasOwnProperty.call(this.data.variables, c.name)) return false
      const actual = hasPackage
        ? packageVariables![c.name]!
        : hasScoped ? scoped![c.name]! : this.data.variables[c.name]!
      // Normalize valores antigos/campos de texto antes de comparar.
      const expected = normalizeConditionValue(c.value, actual)
      switch (c.operator) {
        case 'not_equals': return actual !== expected
        case 'greater_than': return typeof actual === 'number' && typeof expected === 'number' && actual > expected
        case 'less_than': return typeof actual === 'number' && typeof expected === 'number' && actual < expected
        case 'equals':
        default: return actual === expected
      }
    })
  }

  private run(rule: LogicRule, eventObjectId?: string, conditionsAlreadyChecked = false): boolean {
    const scopeId = rule.ownerObjectId ?? eventObjectId ?? (rule.trigger.type === 'object_clicked' ? rule.trigger.objectId : undefined)
    if (!conditionsAlreadyChecked && !this.conditionsMatch(rule, scopeId)) return false
    for (const action of rule.actions) this.apply(action, eventObjectId)
    return true
  }

  /** Resolve o marcador para o objeto que disparou o evento; usa a seleção como fallback manual. */
  private resolveObjectIdToken(source: string, javascript = false, eventObjectId?: string): string {
    if (!source.includes('{ID_OBJECT}')) return source
    const objectId = eventObjectId ?? this.world.getSelectedId()
    if (!objectId || !this.world.get(objectId)) {
      throw new Error('Não há um objeto selecionado para resolver {ID_OBJECT}. Selecione um objeto antes de executar o script.')
    }
    if (!javascript) return source.replaceAll('{ID_OBJECT}', objectId)
    // Dentro de aspas, substitui apenas o conteúdo; sem aspas, injeta uma string JS válida.
    return source
      .replace(/(['"])\{ID_OBJECT\}\1/g, (_match, quote: string) => `${quote}${objectId}${quote}`)
      .replaceAll('{ID_OBJECT}', JSON.stringify(objectId))
  }

  /** Executa uma linguagem de comandos limitada; não usa eval nem executa JavaScript arbitrário. */
  private executeScript(source: string, eventObjectId?: string): void {
    source = this.resolveObjectIdToken(source, false, eventObjectId)
    const scopeId = eventObjectId ?? this.world.getSelectedId() ?? undefined
    const getScoped = (name: string) => this.getVariable(name, scopeId)
    const setScoped = (name: string, value: boolean | number | string) => this.setVariable(name, value, scopeId)
    const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    for (const line of lines) {
      let match = line.match(/^set\s+([A-Za-z_][\w]*)\s*=\s*(.+)$/)
      if (match) { setScoped(match[1]!, parseScriptValue(match[2]!)); continue }
      match = line.match(/^add\s+([A-Za-z_][\w]*)\s+(-?\d+(?:\.\d+)?)$/)
      if (match) {
        const current = getScoped(match[1]!)
        if (typeof current !== 'number') throw new Error(`A variável "${match[1]}" precisa ser numérica para usar add.`)
        setScoped(match[1]!, current + Number(match[2])); continue
      }
      match = line.match(/^toggle\s+([A-Za-z_][\w]*)$/)
      if (match) {
        const current = getScoped(match[1]!)
        if (typeof current !== 'boolean') throw new Error(`A variável "${match[1]}" precisa ser booleana para usar toggle.`)
        setScoped(match[1]!, !current); continue
      }
      match = line.match(/^rotate\s+(\S+)\s+(-?\d+(?:\.\d+)?)$/)
      if (match) { this.apply({ type: 'rotate', objectId: match[1]!, degrees: Number(match[2]) }); continue }
      match = line.match(/^visible\s+(\S+)\s+(true|false)$/)
      if (match) { this.apply({ type: 'set_visible', objectId: match[1]!, visible: match[2] === 'true' }); continue }
      match = line.match(/^move\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/)
      if (match) { this.apply({ type: 'move', objectId: match[1]!, x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) }); continue }
      throw new Error(`Comando de script inválido: "${line}". Consulte os exemplos na ajuda do Visual Script.`)
    }
  }

  /** Executa JavaScript autorado pelo criador do projeto após as condições passarem. */
  private executeJavaScript(source: string, eventObjectId?: string): void {
    source = this.resolveObjectIdToken(source, true, eventObjectId)
    const scopeId = eventObjectId ?? this.world.getSelectedId() ?? undefined
    const vars = this.data.variables
    const getScoped = (name: string) => this.getVariable(name, scopeId)
    const api = {
      get: (name: string) => getScoped(name),
      set: (name: string, value: boolean | number | string) => this.setVariable(name, value, scopeId),
      global: {
        get: (name: string) => this.data.variables[name],
        set: (name: string, value: boolean | number | string) => this.setVariable(name, value),
        add: (name: string, amount: number) => { const current = this.data.variables[name]; if (typeof current !== 'number') throw new Error(`A variável global "${name}" precisa ser numérica.`); this.setVariable(name, current + amount) },
        toggle: (name: string) => { const current = this.data.variables[name]; if (typeof current !== 'boolean') throw new Error(`A variável global "${name}" precisa ser booleana.`); this.setVariable(name, !current) },
      },
      add: (name: string, amount: number) => { const current = getScoped(name); if (typeof current !== 'number') throw new Error(`A variável "${name}" precisa ser numérica.`); this.setVariable(name, current + amount, scopeId) },
      toggle: (name: string) => { const current = getScoped(name); if (typeof current !== 'boolean') throw new Error(`A variável "${name}" precisa ser booleana.`); this.setVariable(name, !current, scopeId) },
      move: (objectId: string, x: number, y: number, z: number) => this.apply({ type: 'move', objectId, x, y, z }),
      rotate: (objectId: string, degrees: number) => this.apply({ type: 'rotate', objectId, degrees }),
      setVisible: (objectId: string, visible: boolean) => this.apply({ type: 'set_visible', objectId, visible }),
      setColor: (objectId: string, color: string | number) => {
        const parsed = typeof color === 'number' ? color : Number.parseInt(color.trim().replace(/^#/, ''), 16)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffff) throw new Error('Cor inválida. Use hexadecimal como #0000FF ou um número entre 0 e 16777215.')
        this.world.update(objectId, { color: parsed })
      },
      combat: {
        damage: (ownerObjectId: string, options: PackageDamageOptions) => this.applyCombatDamageToPackage(ownerObjectId, options),
        restore: (ownerObjectId: string, options: PackageResourceOptions) => this.restoreCombatPackageResource(ownerObjectId, options),
        spend: (ownerObjectId: string, options: PackageResourceOptions) => this.spendCombatPackageResource(ownerObjectId, options),
        applyStatus: (ownerObjectId: string, status: PackageCombatStatus, packageId?: string) => this.applyCombatPackageStatus(ownerObjectId, status, packageId),
      },
      package: {
        get: (ownerObjectId: string, packageId: string, variableName: string) => {
          const instance = (this.data.packages ?? []).find(item =>
            item.ownerObjectId === ownerObjectId && item.packageId === packageId,
          )
          return instance?.variables[variableName]
        },
        set: (ownerObjectId: string, packageId: string, variableName: string, value: PackageScalar) => {
          const instance = (this.data.packages ?? []).find(item =>
            item.ownerObjectId === ownerObjectId && item.packageId === packageId,
          )
          if (!instance) throw new Error(`O objeto "${ownerObjectId}" não possui o pacote "${packageId}".`)
          if (!variableName.trim()) throw new Error('O nome da variável de pacote é obrigatório.')
          instance.variables[variableName] = value
          this.world.events.emit('behaviorPackageChanged', { ownerObjectId })
        },
        triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) =>
          this.triggerPackageEvent(ownerObjectId, packageId, eventId),
      },
    }
    // Scripts do projeto rodam com as permissões do app; execute apenas código confiável.
    const run = new Function('api', 'vars', 'world', 'console', '"use strict";\n' + source) as (apiArg: ScriptApi, varsArg: Record<string, boolean | number | string>, worldArg: World, consoleArg: Console) => void
    run(api, vars, this.world, console)
  }

  private apply(action: RuleAction, eventObjectId?: string): void {
    // Cada evento pertence a um único objeto. Reutilizações são cópias independentes
    // que o editor remapeia para o objeto de destino ao importar.
    switch (action.type) {
      case 'move': {
        const id = action.objectId
        this.world.update(id, { x: action.x, y: action.y, z: action.z })
        break
      }
      case 'rotate': {
        const id = action.objectId
        const obj = this.world.get(id)
        if (obj) this.world.update(id, { rotationY: obj.mesh.rotation.y * 180 / Math.PI + action.degrees })
        break
      }
      case 'set_visible': this.world.update(action.objectId, { visible: action.visible }); break
      case 'set_variable': this.setVariable(action.name, action.value, action.scope === 'global' ? null : action.objectId ?? eventObjectId); break
      case 'set_package_variable': {
        const instance = (this.data.packages ?? []).find(item =>
          item.ownerObjectId === action.objectId && item.packageId === action.packageId,
        )
        if (instance && action.name.trim()) instance.variables[action.name] = action.value
        break
      }
      case 'script':
        try { this.executeScript(action.code, eventObjectId) }
        catch (error) { console.error('[Prometheus Script]', error) }
        break
      case 'javascript':
        try { this.executeJavaScript(action.code, eventObjectId) }
        catch (error) { console.error('[Prometheus JavaScript]', error) }
        break
    }
  }
}


function normalizeConditionValue(value: boolean | number | string, actual: boolean | number | string): boolean | number | string {
  if (typeof actual === 'boolean' && typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  if (typeof actual === 'number' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return value
}

function parseScriptValue(raw: string): boolean | number | string {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1)
  throw new Error(`Valor inválido: "${value}". Use true, false, número ou texto entre aspas.`)
}

function distance(o: ObjectInfo, p: [number, number, number]): number {
  return Math.hypot(o.x - p[0], o.y - p[1], o.z - p[2])
}
