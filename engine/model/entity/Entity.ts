import type { Object3D } from 'three'
import type { GameObject } from '../object/GameObject'

/**
 * Entidade de cena: uma raiz editável com identidade própria e componentes
 * de comportamento. A raiz continua pertencendo ao World, então seleção,
 * transformações, colisões e serialização usam o mesmo objeto visual.
 */
export interface Entity {
  id: string
  name: string
  root: Object3D
  componentId: string | null
}

/** Converte um item do World em entidade apenas quando ele foi marcado como tal. */
export function getEntity(object: GameObject | undefined): Entity | null {
  if (!object || object.mesh.userData.sceneKind !== 'entity') return null
  return {
    id: object.id,
    name: object.name,
    root: object.mesh,
    componentId: typeof object.mesh.userData.componentId === 'string'
      ? object.mesh.userData.componentId
      : null,
  }
}
