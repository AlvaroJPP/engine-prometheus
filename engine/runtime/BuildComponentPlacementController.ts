import * as THREE from 'three'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import type { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { World } from '../world/World'
import type { RuleEngine } from '../script/RuleEngine'
import type { BehaviorPackageInstance, PackageJsonValue, PackageScalar } from '../script/packages'
import { getBehaviorPackageDefinition } from '../script/packages'
import { isPackageJsonValue } from '../script/packageJsonValue'
import { installComponentLogicTemplates } from '../script/ComponentLogicInstaller'

export interface BuildComponentPlacementDependencies {
  world: World
  logic: RuleEngine
  transformControls: TransformControls
  addImportedModel: (name: string, model: THREE.Object3D, height: number) => void
  installBehaviorPackage: (ownerObjectId: string, packageId: string) => BehaviorPackageInstance
  updateBehaviorPackage: (
    id: string,
    patch: Partial<Pick<BehaviorPackageInstance, 'enabled' | 'variables' | 'config'>>,
  ) => void
  emitTool: () => void
}

/** Manages placement of reusable component assets and restoration of their package settings. */
export class BuildComponentPlacementController {
  private pending: { name: string; model: THREE.Object3D; height: number } | null = null
  private readonly dependencies: BuildComponentPlacementDependencies

  constructor(dependencies: BuildComponentPlacementDependencies) {
    this.dependencies = dependencies
  }

  set(name: string, model: THREE.Object3D, height: number): void {
    model.userData.importPart = true
    this.pending = { name, model, height }
  }

  place(x: number, baseY: number, z: number): boolean {
    const pending = this.pending
    if (!pending) return false
    const { world, logic, transformControls } = this.dependencies
    try {
      const existingIds = new Set(world.list().map(object => object.id))
      const model = cloneSkinnedModel(pending.model)
      model.userData = { ...pending.model.userData, importPart: true }
      // Keep the imported GLB as one editable object in the hierarchy.
      this.dependencies.addImportedModel(pending.name, model, pending.height)
      const created = world.list().find(object => !existingIds.has(object.id))
      if (!created) return false
      created.mesh.position.set(x, baseY + pending.height / 2, z)
      created.mesh.updateMatrixWorld(true)
      world.notifyChanged(created.id)
      installComponentLogicTemplates(logic, created.id, pending.model.userData.componentLogic)

      const rawPackageIds = pending.model.userData.importBehaviorPackageIds
      if (Array.isArray(rawPackageIds)) {
        const packageIds = new Set(rawPackageIds.filter((id): id is string =>
          typeof id === 'string' && !!getBehaviorPackageDefinition(id),
        ))
        const rawPackageSettings = pending.model.userData.importBehaviorPackageSettings
        const packageSettings = rawPackageSettings && typeof rawPackageSettings === 'object' && !Array.isArray(rawPackageSettings)
          ? rawPackageSettings as Record<string, { variables?: Record<string, unknown>; config?: Record<string, unknown> }>
          : {}
        for (const packageId of packageIds) {
          const installed = this.dependencies.installBehaviorPackage(created.id, packageId)
          const definition = getBehaviorPackageDefinition(packageId)
          const savedSettings = packageSettings[packageId]
          if (!definition || !savedSettings) continue

          const variables: Record<string, PackageScalar> = {}
          for (const variable of definition.variables) {
            const value = savedSettings.variables?.[variable.name]
            if (variable.type === 'boolean' && typeof value === 'boolean') {
              variables[variable.name] = value
            } else if (variable.type === 'string' && typeof value === 'string') {
              variables[variable.name] = value.slice(0, 512)
            } else if (variable.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
              variables[variable.name] = Math.max(
                variable.min ?? Number.NEGATIVE_INFINITY,
                Math.min(variable.max ?? Number.POSITIVE_INFINITY, value),
              )
            }
          }

          const config: Record<string, PackageJsonValue> = {}
          for (const key of Object.keys(definition.defaultConfig)) {
            const value = savedSettings.config?.[key]
            if (isPackageJsonValue(value)) config[key] = value
          }
          if (Object.keys(variables).length || Object.keys(config).length) {
            this.dependencies.updateBehaviorPackage(installed.id, { variables, config })
          }
        }
      }

      world.select(created.id)
      transformControls.attach(created.mesh)
      this.dependencies.emitTool()
      return true
    } catch (error) {
      console.error('[Engine] Não foi possível construir o componente:', error)
      // A placement click is consumed by the component tool; do not create a fallback primitive.
      return true
    }
  }
}
