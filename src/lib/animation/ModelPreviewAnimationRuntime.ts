import * as THREE from 'three'

/** Contrato mínimo usado pelo controlador de animação da prévia do importador. */
export interface PreviewAnimationControllerLike {
  readonly actions: Map<string, THREE.AnimationAction>
  hasRole(role: string): boolean
  setState(role: string, force?: boolean): boolean
  stop(): void
  update(deltaSeconds: number): boolean
  dispose(): void
}

export type PreviewAnimationControllerFactory<TController extends PreviewAnimationControllerLike> = new (
  mixer: THREE.AnimationMixer,
  actions: Map<string, THREE.AnimationAction>,
) => TController

/** Gera um papel isolado para cada clipe da prévia do importador. */
export function previewAnimationRoleForClip(clip: THREE.AnimationClip): string {
  return `preview:${clip.uuid}`
}

/**
 * Mantém mixer/controlador por instância de modelo e registra clipes novos sem
 * reiniciar o mixer quando o rigging ou o retargeting adiciona animações.
 */
export class ModelPreviewAnimationRuntime<TController extends PreviewAnimationControllerLike> {
  private mixer: THREE.AnimationMixer | null = null
  private root: THREE.Object3D | null = null
  controller: TController | null = null
  private readonly createController: PreviewAnimationControllerFactory<TController>

  constructor(createController: PreviewAnimationControllerFactory<TController>) {
    this.createController = createController
  }

  ensure(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): TController {
    if (!this.mixer || !this.controller || this.root !== root) {
      this.controller?.dispose()
      this.mixer?.stopAllAction()
      this.mixer = new THREE.AnimationMixer(root)
      const actions = new Map<string, THREE.AnimationAction>()
      for (const clip of clips) {
        actions.set(previewAnimationRoleForClip(clip), this.mixer.clipAction(clip))
      }
      this.controller = new this.createController(this.mixer, actions)
      this.root = root
    } else {
      // Rigging/retargeting pode adicionar clipes durante a sessão; registre-os
      // no mixer já existente sem recriar a pose do modelo.
      for (const clip of clips) {
        const role = previewAnimationRoleForClip(clip)
        if (!this.controller.hasRole(role)) {
          this.controller.actions.set(role, this.mixer.clipAction(clip))
        }
      }
    }

    return this.controller
  }

  clear(): void {
    this.controller?.dispose()
    this.controller = null
    this.root = null
    this.mixer = null
  }
}
