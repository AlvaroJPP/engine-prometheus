import type { LogicRule } from './types'
import type { RuleEngine } from './RuleEngine'

/** Clones reusable component rules and binds placeholder object IDs to an instance. */
export function installComponentLogicTemplates(
  logic: RuleEngine,
  objectId: string,
  templates: unknown,
): void {
  if (!Array.isArray(templates)) return
  for (const raw of templates) {
    if (!raw || typeof raw !== 'object') continue
    const template = JSON.parse(JSON.stringify(raw)) as LogicRule
    const remap = (value: string): string => value === '{ID_OBJECT}' ? objectId : value
    template.id = `${template.id || 'component-event'}-${objectId}`
    template.ownerObjectId = objectId
    if (template.trigger.type === 'object_clicked') {
      template.trigger.objectId = remap(template.trigger.objectId)
    }
    for (const action of template.actions) {
      if ('objectId' in action && typeof action.objectId === 'string') {
        action.objectId = remap(action.objectId)
      }
    }
    logic.upsert(template)
  }
}
