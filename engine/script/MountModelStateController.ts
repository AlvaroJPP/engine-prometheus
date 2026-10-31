import * as THREE from 'three'
import type { World } from '../world/World'
import type { CollisionSystem } from '../world/CollisionSystem'
import type { ModelOcclusionSystem } from '../world/ModelOcclusionSystem'
import type { RuleEngine } from './RuleEngine'
import { DIContainer } from '../core/DIContainer'
import { getMountPackageSettings } from './packages'
import type { BehaviorPackageInstance } from './packages'

export interface ImportedModelNodeInfo {
  path: string
  name: string
  meshCount: number
}

/**
 * Mantém as regras de visibilidade dos nós importados fora do Engine principal.
 * Os caminhos v2 e os caminhos legados permanecem aceitos para projetos salvos.
 */
export class MountModelStateController {
  private readonly world: World
  private readonly logic: RuleEngine
  private readonly modelOcclusion: ModelOcclusionSystem
  private readonly collisions: CollisionSystem
  private readonly signatures = new Map<string, string>()

  constructor(
    world: World,
    logic: RuleEngine,
    modelOcclusion: ModelOcclusionSystem,
    collisions: CollisionSystem,
  ) {
    this.world = world
    this.logic = logic
    this.modelOcclusion = modelOcclusion
    this.collisions = collisions
  }

  /**
   * Create MountModelStateController resolving dependencies from DI container
   * This is the preferred factory method when using the DI container
   */
  static createFromContainer(container: DIContainer): MountModelStateController {
    const world = container.resolveRequired<World>('world:world')
    const logic = container.resolveRequired<RuleEngine>('engine:logic')
    const modelOcclusion = container.resolveRequired<ModelOcclusionSystem>('engine:modelOcclusion')
    const collisions = container.resolveRequired<CollisionSystem>('world:collisionSystem')
    return new MountModelStateController(world, logic, modelOcclusion, collisions)
  }

  listImportedModelNodes(objectId: string): ImportedModelNodeInfo[] {
    const root = this.world.get(objectId)?.mesh
    if (!root || root.children.length === 0) return []
    const result: ImportedModelNodeInfo[] = []
    const countMeshes = (node: THREE.Object3D): number => {
      let count = 0
      node.traverse(child => {
        if (child instanceof THREE.Mesh
          && child.userData.editorOverlay !== true
          && child.name !== 'collider-debug-wireframe') count += 1
      })
      return count
    }

    root.traverse(node => {
      if (
        node === root
        || node.userData.editorOverlay === true
        || node.userData.generatedOcclusionCluster === true
        || node.name === 'collider-debug-wireframe'
      ) return
      const meshCount = countMeshes(node)
      if (meshCount === 0) return
      result.push({
        path: this.importedModelNodePath(root, node),
        name: node.name.trim() || node.type,
        meshCount,
      })
    })
    return result
  }

  apply(instance: BehaviorPackageInstance, force = false, enabled = instance.enabled): void {
    const root = this.world.get(instance.ownerObjectId)?.mesh
    if (!root) return
    const rules = enabled ? getMountPackageSettings(instance).modelStates : []
    const evaluated = rules.map(rule => {
      const actual = Object.prototype.hasOwnProperty.call(instance.variables, rule.variable)
        ? instance.variables[rule.variable]
        : this.logic.getVariable(rule.variable, instance.ownerObjectId)
      const matched = actual !== undefined
        && (rule.operator === 'not_equals' ? actual !== rule.value : actual === rule.value)
      return { rule, matched, actual }
    })
    const signature = JSON.stringify(evaluated.map(({ rule, matched, actual }) => ({ rule, matched, actual })))
    if (!force && this.signatures.get(instance.id) === signature) return

    this.modelOcclusion.restoreObjectVisibility(root)
    this.signatures.set(instance.id, signature)
    root.traverse(node => {
      if (
        node === root
        || node.userData.editorOverlay === true
        || node.userData.generatedOcclusionCluster === true
        || node.name === 'collider-debug-wireframe'
      ) return
      const path = this.importedModelNodePath(root, node)
      const state = evaluated.find(item => this.mountModelStatePathMatches(item.rule.nodePath, path))
      const baseVisible = node.userData.mountModelStateBaseVisible
      if (state) {
        if (typeof baseVisible !== 'boolean') node.userData.mountModelStateBaseVisible = node.visible
        node.visible = state.matched === state.rule.visibleWhenMatched
      } else if (typeof baseVisible === 'boolean') {
        node.visible = baseVisible
      }
    })
    root.updateMatrixWorld(true)
    this.collisions.invalidateObject(instance.ownerObjectId)
  }

  forget(instanceId: string): void {
    this.signatures.delete(instanceId)
  }

  clear(): void {
    this.signatures.clear()
  }

  private importedModelNodePath(root: THREE.Object3D, node: THREE.Object3D): string {
    const segments: string[] = []
    let current: THREE.Object3D | null = node
    while (current && current !== root) {
      const label = current.name.trim() || current.type
      const parentNode: THREE.Object3D | null = current.parent
      const siblings: THREE.Object3D[] = parentNode?.children.filter(
        (sibling: THREE.Object3D) => (sibling.name.trim() || sibling.type) === label,
      ) ?? []
      const duplicateIndex = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0
      segments.unshift(duplicateIndex > 0 ? label + '#' + duplicateIndex : label)
      current = parentNode
    }
    return segments.join('/')
  }

  private mountModelStatePathMatches(rulePath: string, runtimePath: string): boolean {
    if (rulePath === runtimePath) return true
    const runtimeParts = runtimePath.split('/').filter(Boolean)
    if (runtimeParts[0] !== 'ImportedVisualPivot') return false

    if (rulePath.startsWith('@v2/')) {
      const ruleParts = rulePath.slice(4).split('/').filter(Boolean)
      if (ruleParts[0] !== 'ImportedVisualPivot') return false
      return ruleParts.slice(1).join('/') === runtimeParts.slice(2).join('/')
    }

    const legacyParts = rulePath.split('/').filter(Boolean)
    if (legacyParts[0] !== 'ImportedVisualPivot') return false
    return legacyParts.slice(2).join('/') === runtimeParts.slice(2).join('/')
  }
}