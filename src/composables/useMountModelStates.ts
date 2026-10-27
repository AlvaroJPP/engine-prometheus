import type { Ref } from 'vue'
import type { BehaviorPackageInstance, PackageJsonValue, PackageScalar } from '@engine'

type MountModelNode = {
  path: string
  name: string
  meshCount: number
}

type MountModelStateDraft = {
  id: string
  nodePath: string
  variable: string
  operator: 'equals' | 'not_equals'
  value: PackageScalar
  visibleWhenMatched: boolean
}

type UseMountModelStatesOptions = {
  selectedModelNodes: Ref<MountModelNode[]>
  logicVariables: Ref<Record<string, boolean | number | string>>
  globalLogicVariables: Ref<Record<string, boolean | number | string>>
  status: Ref<string>
  onPackageConfigChange: (
    instance: BehaviorPackageInstance,
    name: string,
    value: PackageJsonValue,
  ) => void
}

/** Encapsula a edição de estados visuais de nós de modelos importados. */
export function useMountModelStates({
  selectedModelNodes,
  logicVariables,
  globalLogicVariables,
  status,
  onPackageConfigChange,
}: UseMountModelStatesOptions) {
  function getMountModelStates(instance: BehaviorPackageInstance): MountModelStateDraft[] {
    const raw = instance.config.modelStates
    if (!Array.isArray(raw)) return []
    const states: MountModelStateDraft[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = item as Record<string, PackageJsonValue>
      const value = record.value
      if (typeof record.id !== 'string' || typeof record.nodePath !== 'string' || !record.nodePath ||
          typeof record.variable !== 'string' || !record.variable ||
          (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string')) continue
      states.push({
        id: record.id,
        nodePath: record.nodePath,
        variable: record.variable,
        operator: record.operator === 'not_equals' ? 'not_equals' : 'equals',
        value,
        visibleWhenMatched: record.visibleWhenMatched !== false,
      })
    }
    return states
  }

  function writeMountModelStates(instance: BehaviorPackageInstance, states: MountModelStateDraft[]) {
    onPackageConfigChange(instance, 'modelStates', states.map(state => ({
      id: state.id,
      nodePath: state.nodePath,
      variable: state.variable,
      operator: state.operator,
      value: state.value,
      visibleWhenMatched: state.visibleWhenMatched,
    })) as unknown as PackageJsonValue)
  }

  function mountStateVariableOptions(instance: BehaviorPackageInstance): Array<{ name: string; value: PackageScalar }> {
    const options = new Map<string, PackageScalar>()
    Object.entries(instance.variables).forEach(([name, value]) => options.set(name, value))
    Object.entries(logicVariables.value).forEach(([name, value]) => { if (!options.has(name)) options.set(name, value) })
    Object.entries(globalLogicVariables.value).forEach(([name, value]) => { if (!options.has(name)) options.set(name, value) })
    return [...options.entries()].map(([name, value]) => ({ name, value }))
  }

  function updateMountModelState(
    instance: BehaviorPackageInstance,
    stateId: string,
    patch: Partial<MountModelStateDraft>,
  ) {
    const states = getMountModelStates(instance).map(state => state.id === stateId ? { ...state, ...patch } : state)
    writeMountModelStates(instance, states)
  }

  function addMountModelState(instance: BehaviorPackageInstance) {
    const firstNode = selectedModelNodes.value[0]
    if (!firstNode) {
      status.value = 'Este objeto não possui partes de modelo 3D configuráveis. Importe um GLB com nós ou malhas.'
      return
    }
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'mount-state-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    const states = getMountModelStates(instance)
    states.push({
      id,
      nodePath: firstNode.path,
      variable: 'mounted',
      operator: 'equals',
      value: true,
      visibleWhenMatched: true,
    })
    writeMountModelStates(instance, states)
  }

  function removeMountModelState(instance: BehaviorPackageInstance, stateId: string) {
    writeMountModelStates(instance, getMountModelStates(instance).filter(state => state.id !== stateId))
  }

  function onMountModelStateValueChange(instance: BehaviorPackageInstance, stateId: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const trimmed = raw.trim()
    const value: PackageScalar = trimmed === 'true' ? true
      : trimmed === 'false' ? false
        : trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw
    updateMountModelState(instance, stateId, { value })
  }

  return {
    addMountModelState,
    getMountModelStates,
    mountStateVariableOptions,
    onMountModelStateValueChange,
    removeMountModelState,
    updateMountModelState,
  }
}
