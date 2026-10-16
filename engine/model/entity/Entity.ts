import type { Object3D } from 'three'
import type { GameObject } from '../object/GameObject'

/**
 * Entidade de cena genérica (personagem, animal, veículo, NPC etc.).
 *
 * A entidade reutiliza a raiz que já pertence ao World: não cria uma segunda
 * malha nem um segundo ID. Assim, seleção, gizmo, colisões, regras e salvamento
 * continuam usando o mesmo elemento visual do editor.
 */
export interface Entity {
  id: string
  name: string
  root: Object3D
  componentId: string | null
}

export interface EntityMetadata {
  componentId?: string | null
  /** Regras/componentes reutilizáveis pertencentes ao asset, sem lógica por espécie. */
  componentLogic?: unknown[]
}

/** Marca qualquer raiz visual como entidade sem acoplar o motor a um tipo específico. */
export function markEntity(root: Object3D, metadata: EntityMetadata = {}): void {
  root.userData.sceneKind = 'entity'
  if (metadata.componentId !== undefined) {
    root.userData.componentId = metadata.componentId || undefined
  }
  if (metadata.componentLogic !== undefined) {
    root.userData.componentLogic = [...metadata.componentLogic]
  } else if (!Array.isArray(root.userData.componentLogic)) {
    root.userData.componentLogic = []
  }
}

/** Teste semântico usado por sistemas de gameplay e pelo editor. */
export function isEntityRoot(root: Object3D | undefined | null): boolean {
  return root?.userData.sceneKind === 'entity'
}

/** Converte um item do World em entidade apenas quando foi marcado como tal. */
export function getEntity(object: GameObject | undefined): Entity | null {
  if (!object || !isEntityRoot(object.mesh)) return null
  return {
    id: object.id,
    name: object.name,
    root: object.mesh,
    componentId: typeof object.mesh.userData.componentId === 'string'
      ? object.mesh.userData.componentId
      : null,
  }
}
