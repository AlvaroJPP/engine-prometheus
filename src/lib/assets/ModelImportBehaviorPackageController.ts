import type {
  BehaviorPackageDefinition,
  ModelControlBindings,
  PackageJsonValue,
  PackageScalar,
} from '@engine'
import { BEHAVIOR_PACKAGE_DEFINITIONS, DEFAULT_MODEL_CONTROL_BINDINGS } from '@engine'
import { mergeImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'
import type { ImportBehaviorPackageDraft } from './ImportBehaviorPackageDrafts'
import {
  parseImportPackageConfigScalar,
  readImportPackageVectorAxis,
  resolveImportPackageControlBinding,
  updateImportPackageVector,
} from './ImportBehaviorPackageConfig'
import {
  createImportModelStateDraft,
  parseImportModelStateValue,
  parseImportModelStates,
  serializeImportModelStates,
} from './ImportModelStates'
import type { ImportModelStateDraft } from './ImportModelStates'

type WritableValue<T> = { value: T }
type ReadonlyValue<T> = { readonly value: T }
type ModelPreviewPackageNode = { path: string; name: string; meshCount: number }
type ModelImportBehaviorPackageContext = {
  controlBindings: ReadonlyValue<ModelControlBindings>
  selectedBehaviorPackageIds: WritableValue<string[]>
  selectedBehaviorPackageSettings: WritableValue<Record<string, ImportBehaviorPackageDraft>>
  isReadOnlyPreview: ReadonlyValue<boolean>
  previewPackageModelNodes: ReadonlyValue<ModelPreviewPackageNode[]>
}

export function createModelImportBehaviorPackageController(context: ModelImportBehaviorPackageContext) {
  const {
    controlBindings,
    selectedBehaviorPackageIds,
    selectedBehaviorPackageSettings,
    isReadOnlyPreview,
    previewPackageModelNodes,
  } = context

function ensureImportBehaviorPackageDraft(packageId: string): ImportBehaviorPackageDraft {
  const definition = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === packageId)
  if (!definition) return { variables: {}, config: {} }
  const draft = mergeImportBehaviorPackageDraft(
    definition,
    controlBindings.value,
    selectedBehaviorPackageSettings.value[packageId],
  )
  selectedBehaviorPackageSettings.value = { ...selectedBehaviorPackageSettings.value, [packageId]: draft }
  return draft
}

function toggleImportBehaviorPackage(packageId: string, checked: boolean) {
  if (checked) {
    if (!selectedBehaviorPackageIds.value.includes(packageId)) {
      selectedBehaviorPackageIds.value = [...selectedBehaviorPackageIds.value, packageId]
    }
    ensureImportBehaviorPackageDraft(packageId)
    return
  }
  selectedBehaviorPackageIds.value = selectedBehaviorPackageIds.value.filter(id => id !== packageId)
}

function importPackageVariableValue(packageId: string, name: string, fallback: PackageScalar): PackageScalar {
  return selectedBehaviorPackageSettings.value[packageId]?.variables[name] ?? fallback
}

function updateImportPackageVariable(
  packageId: string,
  variable: BehaviorPackageDefinition['variables'][number],
  event: Event,
) {
  if (isReadOnlyPreview.value || variable.readOnly) return
  const target = event.target as HTMLInputElement
  let value: PackageScalar
  if (variable.type === 'boolean') {
    value = target.checked
  } else if (variable.type === 'number') {
    const raw = target.value.trim().replace(',', '.')
    const parsed = Number(raw)
    if (raw === '' || !Number.isFinite(parsed)) return
    value = Math.max(variable.min ?? Number.NEGATIVE_INFINITY, Math.min(variable.max ?? Number.POSITIVE_INFINITY, parsed))
  } else {
    value = target.value
  }
  const draft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: { ...draft, variables: { ...draft.variables, [variable.name]: value } },
  }
}

function importPackageConfigValue(packageId: string, key: string, fallback: PackageJsonValue): PackageJsonValue {
  return selectedBehaviorPackageSettings.value[packageId]?.config[key] ?? fallback
}

function updateImportPackageConfigValue(packageId: string, key: string, value: PackageJsonValue) {
  if (isReadOnlyPreview.value) return
  const draft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: { ...draft, config: { ...draft.config, [key]: value } },
  }
}

function updateImportPackageConfigScalar(packageId: string, key: string, fallback: PackageJsonValue, event: Event) {
  if (isReadOnlyPreview.value) return
  const value = parseImportPackageConfigScalar((event.target as HTMLInputElement).value, fallback)
  if (value === null) return
  updateImportPackageConfigValue(packageId, key, value)
}

function setImportPackageInteractionKey(packageId: string, keyCode: string) {
  const draft = ensureImportBehaviorPackageDraft(packageId)
  const current = draft.config.controlBindings && typeof draft.config.controlBindings === 'object' && !Array.isArray(draft.config.controlBindings)
    ? draft.config.controlBindings as Record<string, PackageJsonValue>
    : {}
  updateImportPackageConfigValue(packageId, 'interactionKey', keyCode)
  const nextDraft = ensureImportBehaviorPackageDraft(packageId)
  selectedBehaviorPackageSettings.value = {
    ...selectedBehaviorPackageSettings.value,
    [packageId]: {
      ...nextDraft,
      config: {
        ...nextDraft.config,
        controlBindings: { ...current, interact: keyCode },
      },
    },
  }
}

function importPackageVectorValue(packageId: string, key: string, axis: 0 | 1 | 2, fallback: number): number {
  return readImportPackageVectorAxis(importPackageConfigValue(packageId, key, [0, 0.55, 0]), axis, fallback)
}

function setImportPackageVector(packageId: string, key: string, axis: 0 | 1 | 2, event: Event) {
  if (isReadOnlyPreview.value) return
  const vector = updateImportPackageVector(
    importPackageConfigValue(packageId, key, [0, 0.55, 0]),
    axis,
    (event.target as HTMLInputElement).value,
  )
  if (!vector) return
  updateImportPackageConfigValue(packageId, key, vector)
}

function importPackageControlBindingValue(packageId: string, key: keyof ModelControlBindings): string {
  return resolveImportPackageControlBinding(
    importPackageConfigValue(packageId, 'controlBindings', {}),
    key,
    DEFAULT_MODEL_CONTROL_BINDINGS[key],
  )
}

function setImportPackageControlBinding(packageId: string, key: keyof ModelControlBindings, event: Event) {
  if (isReadOnlyPreview.value) return
  const value = (event.target as HTMLInputElement).value.trim()
  if (!value) return
  const current = importPackageConfigValue(packageId, 'controlBindings', {})
  const bindings = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, PackageJsonValue>
    : {}
  updateImportPackageConfigValue(packageId, 'controlBindings', { ...bindings, [key]: value })
  if (key === 'interact') updateImportPackageConfigValue(packageId, 'interactionKey', value)
}

function importPackageModelStates(packageId: string): ImportModelStateDraft[] {
  return parseImportModelStates(importPackageConfigValue(packageId, 'modelStates', []))
}

function writeImportPackageModelStates(packageId: string, states: ImportModelStateDraft[]) {
  updateImportPackageConfigValue(packageId, 'modelStates', serializeImportModelStates(states))
}

function addImportPackageModelState(packageId: string) {
  if (isReadOnlyPreview.value || !previewPackageModelNodes.value.length) return
  const definition = BEHAVIOR_PACKAGE_DEFINITIONS.find(item => item.id === packageId)
  if (!definition) return
  const variable = definition.variables.find(item => item.name === 'mounted') ?? definition.variables[0]
  if (!variable) return
  const node = previewPackageModelNodes.value[0]!
  const state = createImportModelStateDraft(node.path, variable)
  writeImportPackageModelStates(packageId, [...importPackageModelStates(packageId), state])
}

function updateImportPackageModelState(packageId: string, stateId: string, patch: Partial<ImportModelStateDraft>) {
  writeImportPackageModelStates(packageId, importPackageModelStates(packageId).map(state =>
    state.id === stateId ? { ...state, ...patch } : state,
  ))
}

function onImportPackageModelStateValueChange(packageId: string, stateId: string, event: Event) {
  const value = parseImportModelStateValue((event.target as HTMLInputElement).value)
  updateImportPackageModelState(packageId, stateId, { value })
}

function removeImportPackageModelState(packageId: string, stateId: string) {
  writeImportPackageModelStates(packageId, importPackageModelStates(packageId).filter(state => state.id !== stateId))
}


  return {
    ensureImportBehaviorPackageDraft,
    toggleImportBehaviorPackage,
    importPackageVariableValue,
    updateImportPackageVariable,
    importPackageConfigValue,
    updateImportPackageConfigValue,
    updateImportPackageConfigScalar,
    setImportPackageInteractionKey,
    importPackageVectorValue,
    setImportPackageVector,
    importPackageControlBindingValue,
    setImportPackageControlBinding,
    importPackageModelStates,
    writeImportPackageModelStates,
    addImportPackageModelState,
    updateImportPackageModelState,
    onImportPackageModelStateValueChange,
    removeImportPackageModelState,
  }
}
