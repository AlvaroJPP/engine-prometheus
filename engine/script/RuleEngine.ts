import * as THREE from 'three'
import type { ObjectInfo, GameObject } from '../model/object/GameObject'
import type { World } from '../world/World'
import { EMPTY_LOGIC } from './types.ts'
import { createBehaviorPackageInstance, getBehaviorPackageDefinition } from './packages.ts'
import type { BehaviorPackageInstance, PackageScalar } from './packages.ts'
import type { LogicEventsFile, LogicRule, RuleAction, RuleTrigger } from './types.ts'
import { CombatPackageRuntime } from './CombatPackageRuntime.ts'
import type { PackageCombatStatus, PackageDamageOptions, PackageResourceOptions } from './CombatPackageRuntime.ts'
import { InventoryRuntime } from './InventoryRuntime.ts'
import { newId } from '../lib/id.ts'
import { getAnimationControllerFromObject } from '../world/AnimationController.ts'
import type { ObjectType } from '../project/format.ts'
import type { InventoryStack } from './InventoryRuntime.ts'

/** Runtime determinístico para gatilhos, condições e ações do projeto. */
type ScriptApi = {
  get: (name: string) => boolean | number | string | undefined
  set: (name: string, value: boolean | number | string) => void
  add: (name: string, amount: number) => void
  toggle: (name: string) => void
  global: { get: (name: string) => boolean | number | string | undefined; set: (name: string, value: boolean | number | string) => void; add: (name: string, amount: number) => void; toggle: (name: string) => void }
  event: { get: (name: string) => PackageScalar | undefined }
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
    list: (packageId?: string, ownerObjectId?: string) => BehaviorPackageInstance[]
    triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) => boolean
    install: (ownerObjectId: string, packageId: string) => string
    configure: (ownerObjectId: string, packageId: string, variables: Record<string, PackageScalar>) => void
  }
  inventory: {
    read: (variableName?: string) => InventoryStack[]
    grant: (itemId: string, quantity?: number, variableName?: string) => boolean
    consume: (itemId: string, quantity?: number, variableName?: string) => boolean
    quantity: (itemId: string, variableName?: string) => number
  }
  notice: (message: string, durationSeconds: number, variableName?: string) => void
  animation: { playOnce: (objectId: string, role: string, restart?: boolean, holdAtEnd?: boolean) => boolean }
  world: {
    position: (objectId: string) => { x: number; y: number; z: number; visible: boolean } | null
    setVisibleTemporary: (objectId: string, visible: boolean) => boolean
    nearby: (center: { x: number; y: number; z: number }, radius: number) => Array<{ id: string; name: string; x: number; y: number; z: number; distance: number; visible: boolean }>
    bounds: (objectId: string) => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null
    groundHeightAt: (x: number, z: number, maxStepUp?: number) => number
    surfaceHeightAt: (x: number, z: number, maxSurfaceY?: number, excludedObjectIds?: string[]) => number
    spawnPrimitive: (options: { name?: string; shape?: 'box' | 'sphere' | 'cylinder' | 'cone' | 'octahedron'; x: number; y: number; z: number; size?: number; color?: number; emissive?: number; emissiveIntensity?: number; metalness?: number; roughness?: number; objectType?: ObjectType }) => string
    remove: (objectId: string) => void
  }
}

export class RuleEngine {
  private data: LogicEventsFile = structuredClone(EMPTY_LOGIC)
  private readonly world: World
  private readonly combatPackages: CombatPackageRuntime
  private readonly noticeTimers = new Map<string, number>()
  private currentGlobalEventPayload: Record<string, PackageScalar> = {}
  private readonly temporaryVisibility = new Map<string, boolean>()

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
    this.noticeTimers.clear()
    this.temporaryVisibility.clear()
    for (const rule of this.data.events) {
      rule.lastInside = false
      if (rule.trigger.type === 'global_event') {
        delete rule.ownerObjectId
        continue
      }
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

  /** Instala scripts por objeto e scripts globais definidos por pacotes. */
  ensureBehaviorPackageScripts(packageId?: string): void {
    const disabled = new Set(this.data.disabledPackageScripts ?? [])
    const changedOwners = new Set<string>()
    const installedPackageIds = new Set((this.data.packages ?? []).map(instance => instance.packageId))

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
        changedOwners.add(instance.ownerObjectId)
      }
    }

    for (const definitionId of installedPackageIds) {
      if (packageId && packageId !== definitionId) continue
      const definition = getBehaviorPackageDefinition(definitionId)
      for (const template of definition?.globalScripts ?? []) {
        if (template.trigger.type !== 'global_event') continue
        const id = `global::${definitionId}::${template.id}`
        if (disabled.has(id) || this.data.events.some(rule => rule.id === id)) continue
        const rule = JSON.parse(JSON.stringify(template)) as LogicRule
        rule.id = id
        delete rule.ownerObjectId
        rule.sourcePackageDefinitionId = definitionId
        rule.lastInside = false
        this.data.events.push(rule)
        for (const instance of this.data.packages ?? []) {
          if (instance.packageId === definitionId) changedOwners.add(instance.ownerObjectId)
        }
      }
    }

    for (const ownerObjectId of changedOwners) {
      this.world.events.emit('behaviorPackageChanged', { ownerObjectId })
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
    if (plain.variables) {
      for (const [name, value] of Object.entries(plain.variables)) {
        if (name.trim() && isValidPackageScalar(value)) instance.variables[name] = value
      }
    }
    if (plain.config) instance.config = { ...instance.config, ...plain.config }
  }

  setPackageVariable(id: string, name: string, value: PackageScalar): void {
    const instance = (this.data.packages ?? []).find(item => item.id === id)
    if (!instance || !name.trim() || !isValidPackageScalar(value)) return
    instance.variables[name] = value
  }

  removePackage(id: string): void {
    const removed = (this.data.packages ?? []).find(instance => instance.id === id)
    this.data.packages = (this.data.packages ?? []).filter(instance => instance.id !== id)
    this.data.events = this.data.events.filter(rule => rule.sourcePackageInstanceId !== id)
    this.data.disabledPackageScripts = (this.data.disabledPackageScripts ?? []).filter(scriptId => !scriptId.startsWith(`${id}::`))
    if (removed) this.removeGlobalScriptsIfUnused(removed.packageId)
  }

  private removeGlobalScriptsIfUnused(packageId: string): void {
    if ((this.data.packages ?? []).some(instance => instance.packageId === packageId)) return
    this.data.events = this.data.events.filter(rule => rule.sourcePackageDefinitionId !== packageId)
    this.data.disabledPackageScripts = (this.data.disabledPackageScripts ?? []).filter(
      id => !id.startsWith(`global::${packageId}::`),
    )
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
    if (!isValidPackageScalar(value)) return
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
    this.temporaryVisibility.delete(objectId)
    if (this.data.objectVariables) delete this.data.objectVariables[objectId]
    const removed = new Set((this.data.packages ?? []).filter(instance => instance.ownerObjectId === objectId).map(instance => instance.id))
    const removedPackages = (this.data.packages ?? []).filter(instance => removed.has(instance.id))
    this.data.packages = (this.data.packages ?? []).filter(instance => instance.ownerObjectId !== objectId)
    this.data.events = this.data.events.filter(rule => !rule.sourcePackageInstanceId || !removed.has(rule.sourcePackageInstanceId))
    this.data.disabledPackageScripts = (this.data.disabledPackageScripts ?? []).filter(scriptId => ![...removed].some(id => scriptId.startsWith(`${id}::`)))
    for (const packageId of new Set(removedPackages.map(instance => instance.packageId))) {
      this.removeGlobalScriptsIfUnused(packageId)
    }
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
    if (rule?.sourcePackageInstanceId || rule?.sourcePackageDefinitionId) {
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

  private updateNoticeTimers(deltaSeconds: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
    if (delta <= 0) return
    for (const [variableName, remaining] of this.noticeTimers) {
      const next = remaining - delta
      if (next > 0) {
        this.noticeTimers.set(variableName, next)
        continue
      }
      this.noticeTimers.delete(variableName)
      if (typeof this.getVariable(variableName) === 'string') this.setVariable(variableName, '')
    }
  }

  private createInventoryRuntime(variableName: string): InventoryRuntime {
    const name = variableName.trim()
    if (!name) throw new Error('O nome da variável de inventário é obrigatório.')
    return new InventoryRuntime({
      readSerialized: () => this.getVariable(name),
      writeSerialized: serialized => this.setVariable(name, serialized),
    })
  }

  /** Dispara regras globais definidas por pacotes, transportando dados de evento transitórios. */
  /** Restores temporary visibility changes made by scripts when Run ends. */
  restoreRuntimeWorldChanges(): void {
    for (const [objectId, visible] of this.temporaryVisibility) {
      if (this.world.get(objectId)) this.world.update(objectId, { visible })
    }
    this.temporaryVisibility.clear()
  }

  triggerGlobalEvent(eventId: string, payload: Record<string, PackageScalar> = {}): boolean {
    const key = eventId.trim()
    if (!key) return false
    this.ensureBehaviorPackageScripts()
    const previousPayload = this.currentGlobalEventPayload
    this.currentGlobalEventPayload = { ...payload }
    try {
      const matchingRules = this.rulesInHierarchyOrder().filter(rule =>
        rule.enabled
        && rule.trigger.type === 'global_event'
        && rule.trigger.eventId === key
        && this.conditionsMatch(rule, undefined),
      )
      let executed = false
      for (const rule of matchingRules) executed = this.run(rule, undefined, true) || executed
      return executed
    } finally {
      this.currentGlobalEventPayload = previousPayload
    }
  }

  /** Dispara um evento no pacote interativo mais próximo que corresponde aos filtros. */
  triggerNearestPackageEvent(
    position: { x: number; y: number; z: number },
    options: {
      eventId: string
      packageId?: string
      radius?: number
      verticalTolerance?: number
      variableEquals?: Record<string, PackageScalar>
    },
  ): boolean {
    const radius = Math.max(0, Number.isFinite(options.radius) ? options.radius! : 2.5)
    const verticalTolerance = Math.max(0, Number.isFinite(options.verticalTolerance) ? options.verticalTolerance! : 3)
    const candidates = (this.data.packages ?? [])
      .filter(instance => instance.enabled && (!options.packageId || instance.packageId === options.packageId))
      .filter(instance => Object.entries(options.variableEquals ?? {}).every(([name, value]) => instance.variables[name] === value))
      .map(instance => {
        const object = this.world.get(instance.ownerObjectId)
        if (!object || !this.world.isObjectVisible(object)) return null
        const distance = Math.hypot(object.mesh.position.x - position.x, object.mesh.position.z - position.z)
        const verticalDistance = Math.abs(object.mesh.position.y - position.y)
        return { instance, distance, verticalDistance }
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        !!candidate && candidate.distance <= radius && candidate.verticalDistance <= verticalTolerance,
      )
      .sort((a, b) => a.distance - b.distance)

    for (const candidate of candidates) {
      if (this.triggerPackageEvent(candidate.instance.ownerObjectId, candidate.instance.packageId, options.eventId)) {
        return true
      }
    }
    return false
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
    this.updateNoticeTimers(deltaSeconds)
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
    // Keep the legacy `vars.name = value` API, but reject non-scalar and non-finite writes.
    const vars = new Proxy(this.data.variables, {
      set: (target, property, value) => {
        if (typeof property !== 'string' || !isValidPackageScalar(value)) return true
        target[property] = value
        return true
      },
      defineProperty: (target, property, descriptor) => {
        if (
          typeof property !== 'string'
          || 'get' in descriptor
          || 'set' in descriptor
          || ('value' in descriptor && !isValidPackageScalar(descriptor.value))
        ) return false
        return Reflect.defineProperty(target, property, descriptor)
      },
    })
    const getScoped = (name: string) => this.getVariable(name, scopeId)
    const api = {
      get: (name: string) => getScoped(name),
      set: (name: string, value: boolean | number | string) => this.setVariable(name, value, scopeId),
      event: {
        get: (name: string) => this.currentGlobalEventPayload[name],
      },
      global: {
        get: (name: string) => this.data.variables[name],
        set: (name: string, value: boolean | number | string) => this.setVariable(name, value),
        add: (name: string, amount: number) => {
          const current = this.data.variables[name]
          if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error(`A variável global "${name}" precisa ser numérica finita.`)
          if (!Number.isFinite(amount) || !Number.isFinite(current + amount)) return
          this.setVariable(name, current + amount)
        },
        toggle: (name: string) => { const current = this.data.variables[name]; if (typeof current !== 'boolean') throw new Error(`A variável global "${name}" precisa ser booleana.`); this.setVariable(name, !current) },
      },
      add: (name: string, amount: number) => {
        const current = getScoped(name)
        if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error(`A variável "${name}" precisa ser numérica finita.`)
        if (!Number.isFinite(amount) || !Number.isFinite(current + amount)) return
        this.setVariable(name, current + amount, scopeId)
      },
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
          if (!isValidPackageScalar(value)) return
          instance.variables[variableName] = value
          this.world.events.emit('behaviorPackageChanged', { ownerObjectId })
        },
        list: (packageId?: string, ownerObjectId?: string) =>
          this.listPackages(ownerObjectId).filter(instance => !packageId || instance.packageId === packageId),
        install: (ownerObjectId: string, packageId: string) =>
          this.installPackage(ownerObjectId, packageId).id,
        configure: (ownerObjectId: string, packageId: string, variables: Record<string, PackageScalar>) => {
          const instance = (this.data.packages ?? []).find(item =>
            item.ownerObjectId === ownerObjectId && item.packageId === packageId,
          )
          if (!instance) throw new Error(`O objeto "${ownerObjectId}" não possui o pacote "${packageId}".`)
          for (const [name, value] of Object.entries(variables)) {
            if (!name.trim()) continue
            if (!isValidPackageScalar(value)) continue
            instance.variables[name] = value
          }
          this.world.events.emit('behaviorPackageChanged', { ownerObjectId })
        },
        triggerEvent: (ownerObjectId: string, packageId: string, eventId: string) =>
          this.triggerPackageEvent(ownerObjectId, packageId, eventId),
      },
      inventory: {
        read: (variableName = 'inventory_json') => this.createInventoryRuntime(variableName).read(),
        grant: (itemId: string, quantity = 1, variableName = 'inventory_json') =>
          this.createInventoryRuntime(variableName).grant(itemId, quantity),
        consume: (itemId: string, quantity = 1, variableName = 'inventory_json') =>
          this.createInventoryRuntime(variableName).consume(itemId, quantity),
        quantity: (itemId: string, variableName = 'inventory_json') =>
          this.createInventoryRuntime(variableName).quantity(itemId),
      },
      notice: (message: string, durationSeconds: number, variableName = 'notice') => {
        const key = variableName.trim()
        if (!key) throw new Error('O nome da variável de aviso é obrigatório.')
        this.setVariable(key, message)
        const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0
        if (duration > 0) this.noticeTimers.set(key, duration)
        else this.noticeTimers.delete(key)
      },
      animation: {
        playOnce: (objectId: string, role: string, restart = true, holdAtEnd = role === 'death') => {
          const object = this.world.get(objectId)
          if (!object) return false
          const controller = getAnimationControllerFromObject(object.mesh)
          return controller?.playOneShot(role, restart, holdAtEnd) ?? false
        },
      },
      world: {
        position: (objectId: string) => {
          const object = this.world.get(objectId)
          return object ? {
            x: object.mesh.position.x,
            y: object.mesh.position.y,
            z: object.mesh.position.z,
            visible: this.world.isObjectVisible(object),
          } : null
        },
        setVisibleTemporary: (objectId: string, visible: boolean) => {
          const object = this.world.get(objectId)
          if (!object) return false
          if (!this.temporaryVisibility.has(objectId)) {
            this.temporaryVisibility.set(objectId, this.world.isObjectVisible(object))
          }
          this.world.update(objectId, { visible })
          return true
        },
        nearby: (center: { x: number; y: number; z: number }, radius: number) => {
          if (
            ![center.x, center.y, center.z, radius].every(Number.isFinite)
            || radius < 0
          ) return []

          const maximum = radius
          return this.world.list().flatMap(object => {
            const position = object.mesh.position
            if (![position.x, position.y, position.z].every(Number.isFinite)) return []
            const distance = Math.hypot(
              position.x - center.x,
              position.y - center.y,
              position.z - center.z,
            )
            if (!Number.isFinite(distance) || distance > maximum) return []
            return [{
              id: object.id,
              name: object.name,
              x: object.mesh.position.x,
              y: object.mesh.position.y,
              z: object.mesh.position.z,
              distance,
              visible: this.world.isObjectVisible(object),
            }]
          })
        },
        bounds: (objectId: string) => {
          const object = this.world.get(objectId)
          if (!object) return null
          object.mesh.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(object.mesh)
          if (bounds.isEmpty()) return null
          return {
            min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
            max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
          }
        },
        groundHeightAt: (x: number, z: number, maxStepUp?: number) =>
          this.world.getGroundHeightAt(x, z, maxStepUp),
        surfaceHeightAt: (x: number, z: number, maxSurfaceY = Number.POSITIVE_INFINITY, excludedObjectIds: string[] = []) =>
          this.world.getSurfaceHeightAt(x, z, maxSurfaceY, new Set(excludedObjectIds)),
        spawnPrimitive: (options: {
          name?: string; shape?: 'box' | 'sphere' | 'cylinder' | 'cone' | 'octahedron'
          x: number; y: number; z: number; size?: number; color?: number; emissive?: number
          emissiveIntensity?: number; metalness?: number; roughness?: number; objectType?: ObjectType
        }) => {
          const shape = options.shape ?? 'box'
          const size = typeof options.size === 'number' && Number.isFinite(options.size)
            ? Math.max(0.05, Math.min(100, options.size))
            : 0.25
          const geometry = shape === 'sphere'
            ? new THREE.SphereGeometry(1, 12, 8)
            : shape === 'cylinder'
              ? new THREE.CylinderGeometry(0.72, 0.72, 1, 8)
              : shape === 'cone'
                ? new THREE.ConeGeometry(0.65, 1, 8)
                : shape === 'octahedron'
                  ? new THREE.OctahedronGeometry(1, 0)
                  : new THREE.BoxGeometry(1, 1, 1)
          const color = Number.isInteger(options.color) && options.color! >= 0 && options.color! <= 0xffffff
            ? options.color!
            : 0xd3d8e8
          const emissive = Number.isInteger(options.emissive) && options.emissive! >= 0 && options.emissive! <= 0xffffff
            ? options.emissive!
            : 0x000000
          const material = new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: Number.isFinite(options.emissiveIntensity) ? Math.max(0, Math.min(5, options.emissiveIntensity!)) : 0,
            metalness: Number.isFinite(options.metalness) ? Math.max(0, Math.min(1, options.metalness!)) : 0,
            roughness: Number.isFinite(options.roughness) ? Math.max(0, Math.min(1, options.roughness!)) : 0.6,
          })
          const mesh = new THREE.Mesh(geometry, material)
          mesh.position.set(
            Number.isFinite(options.x) ? options.x : 0,
            Number.isFinite(options.y) ? options.y : 0,
            Number.isFinite(options.z) ? options.z : 0,
          )
          mesh.scale.setScalar(size)
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.id = newId('script')
          mesh.userData.scriptSpawned = true
          const objectId = String(mesh.userData.id)
          const object: GameObject = {
            id: objectId,
            name: options.name?.trim() || `Script Object ${objectId}`,
            type: options.objectType ?? 'cube',
            mesh,
          }
          this.world.add(object)
          return objectId
        },
        remove: (objectId: string) => {
          if (this.world.get(objectId)) this.world.remove(objectId)
          this.removeObjectVariables(objectId)
        },
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
        if (instance && action.name.trim() && isValidPackageScalar(action.value)) {
          instance.variables[action.name] = action.value
        }
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


function isValidPackageScalar(value: unknown): value is PackageScalar {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
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
