import type {
  BehaviorPackageDefinition,
  BehaviorPackageInstance,
  PackageJsonValue,
  PackageScalar,
} from '@engine'

type UpdateBehaviorPackage = (
  id: string,
  patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
) => void

type UseBehaviorPackageEditorOptions = {
  updateBehaviorPackage: UpdateBehaviorPackage
}

/** Centraliza a conversão e validação dos valores editáveis dos pacotes de comportamento. */
export function useBehaviorPackageEditor({
  updateBehaviorPackage,
}: UseBehaviorPackageEditorOptions) {
  function onPackageVariableChange(
    instance: BehaviorPackageInstance,
    variable: BehaviorPackageDefinition['variables'][number],
    event: Event,
  ) {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    let value: PackageScalar
    if (variable.type === 'boolean') {
      value = (target as HTMLInputElement).checked
    } else if (variable.type === 'number') {
      const raw = target.value.trim().replace(',', '.')
      const parsed = Number(raw)
      if (raw === '' || !Number.isFinite(parsed)) return
      value = Math.max(
        variable.min ?? Number.NEGATIVE_INFINITY,
        Math.min(variable.max ?? Number.POSITIVE_INFINITY, parsed),
      )
    } else {
      value = target.value
    }
    updateBehaviorPackage(instance.id, { variables: { [variable.name]: value } })
  }

  function onPackageConfigChange(
    instance: BehaviorPackageInstance,
    name: string,
    value: PackageJsonValue,
  ) {
    updateBehaviorPackage(instance.id, { config: { [name]: value } })
  }

  function onPackageSeatOffsetChange(
    instance: BehaviorPackageInstance,
    axis: 0 | 1 | 2,
    event: Event,
  ) {
    const target = event.target as HTMLInputElement
    const parsed = Number(target.value.trim().replace(',', '.'))
    if (!Number.isFinite(parsed)) return
    const raw = instance.config.seatOffset
    const offset: [number, number, number] = Array.isArray(raw) && raw.length === 3
      ? [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0]
      : [0, 0.55, 0]
    offset[axis] = Math.max(-10, Math.min(10, parsed))
    onPackageConfigChange(instance, 'seatOffset', offset)
  }

  return {
    onPackageConfigChange,
    onPackageSeatOffsetChange,
    onPackageVariableChange,
  }
}
