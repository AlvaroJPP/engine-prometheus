import type { ObjectInfo } from '../model/object/GameObject'
import type { World } from '../world/World'
import { EMPTY_LOGIC } from './types'
import type { LogicEventsFile, LogicRule, RuleAction } from './types'

/** Runtime determinístico para gatilhos, condições e ações do projeto. */
export class RuleEngine {
  private data: LogicEventsFile = structuredClone(EMPTY_LOGIC)
  constructor(private readonly world: World) {}

  exportData(): LogicEventsFile {
    return structuredClone(this.data)
  }

  load(data?: LogicEventsFile): void {
    this.data = data ? structuredClone(data) : structuredClone(EMPTY_LOGIC)
    for (const rule of this.data.events) rule.lastInside = false
  }

  replace(data: LogicEventsFile): void { this.load(data) }
  list(): LogicRule[] { return structuredClone(this.data.events) }
  variables(): Record<string, boolean | number | string> { return { ...this.data.variables } }
  setVariable(name: string, value: boolean | number | string): void {
    const key = name.trim()
    if (!key) throw new Error('O nome da variável é obrigatório.')
    this.data.variables[key] = value
  }
  upsert(rule: LogicRule): void {
    const i = this.data.events.findIndex((r) => r.id === rule.id)
    const copy = structuredClone({ ...rule, lastInside: false })
    if (i < 0) this.data.events.push(copy); else this.data.events[i] = copy
  }
  remove(id: string): void { this.data.events = this.data.events.filter((r) => r.id !== id) }

  triggerObjectClicked(objectId: string): void {
    for (const rule of this.data.events) {
      if (rule.enabled && rule.trigger.type === 'object_clicked' && rule.trigger.objectId === objectId) this.run(rule)
    }
  }

  update(): void {
    const objects = this.world.info()
    for (const rule of this.data.events) {
      if (!rule.enabled || rule.trigger.type !== 'enter_area') continue
      const t = rule.trigger
      const now = objects.some((o) => distance(o, t.center) <= Math.max(0, t.radius))
      if (now && !rule.lastInside) this.run(rule)
      rule.lastInside = now
    }
  }

  private run(rule: LogicRule): void {
    if (!rule.conditions.every((c) => {
      const actual = this.data.variables[c.name]
      switch (c.operator) {
        case 'not_equals': return actual !== c.value
        case 'greater_than': return typeof actual === 'number' && typeof c.value === 'number' && actual > c.value
        case 'less_than': return typeof actual === 'number' && typeof c.value === 'number' && actual < c.value
        case 'equals':
        default: return actual === c.value
      }
    })) return
    for (const action of rule.actions) this.apply(action)
  }

  private apply(action: RuleAction): void {
    switch (action.type) {
      case 'move': this.world.update(action.objectId, { x: action.x, y: action.y, z: action.z }); break
      case 'rotate': {
        const obj = this.world.get(action.objectId)
        if (obj) this.world.update(action.objectId, { rotationY: obj.mesh.rotation.y * 180 / Math.PI + action.degrees })
        break
      }
      case 'set_visible': this.world.update(action.objectId, { visible: action.visible }); break
      case 'set_variable': this.setVariable(action.name, action.value); break
    }
  }
}

function distance(o: ObjectInfo, p: [number, number, number]): number {
  return Math.hypot(o.x - p[0], o.y - p[1], o.z - p[2])
}
