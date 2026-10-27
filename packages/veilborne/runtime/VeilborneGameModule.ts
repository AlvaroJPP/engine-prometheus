import type { EngineGameModule, GameModuleContext } from '../../../engine/runtime/GameModule'
import { registerVeilborneBehaviorPackage } from './behaviorPackageDefinition'
import { VeilborneCombatRuntime } from './VeilborneCombatRuntime'
import { VeilborneHealthBarSystem } from './VeilborneHealthBarSystem'
import { VeilborneVisualEffects } from './VeilborneVisualEffects'

const PACKAGE_ID = 'veilborne_rpg'

/**
 * Módulo opcional de runtime do VEILBORNE.
 *
 * O módulo coordena os serviços específicos do jogo; o Engine genérico apenas
 * fornece mundo, avatar, colisões, lógica, controles e ciclo de vida.
 */
export class VeilborneGameModule implements EngineGameModule {
  readonly id = 'veilborne'

  private unregisterPackage: (() => void) | null = null
  private combatRuntime: VeilborneCombatRuntime | null = null
  private visualEffects: VeilborneVisualEffects | null = null
  private healthBars: VeilborneHealthBarSystem | null = null
  private active = false

  onAttach(context: GameModuleContext): void {
    this.unregisterPackage = registerVeilborneBehaviorPackage()
    this.visualEffects = new VeilborneVisualEffects(context.world.scene, context.invalidate)
    this.combatRuntime = new VeilborneCombatRuntime(context, this.visualEffects)
    this.healthBars = new VeilborneHealthBarSystem(context.world.scene)
  }

  onRuntimeStart(context: GameModuleContext): void {
    this.active = this.combatRuntime?.isEnabled() ?? context.logic.listPackages().some(
      instance => instance.enabled && instance.packageId === PACKAGE_ID,
    )
    if (this.active) this.combatRuntime?.ensurePlayerVariables()
  }

  onKeyDown(event: KeyboardEvent): boolean {
    return this.combatRuntime?.handleKeyDown(event) ?? false
  }

  onKeyUp(event: KeyboardEvent): void {
    this.combatRuntime?.handleKeyUp(event)
  }

  onInputBlur(): void {
    this.combatRuntime?.handleInputBlur()
  }

  update(dt: number, context: GameModuleContext): void {
    if (!context.isRuntimeActive()) return

    const enabled = this.combatRuntime?.isEnabled() ?? false
    if (enabled && !this.active) this.combatRuntime?.ensurePlayerVariables()
    if (!enabled && this.active) this.healthBars?.clear()
    this.active = enabled

    // A atualização também mantém os efeitos visuais e os tempos de recarga
    // consistentes, enquanto a lógica de combate para quando o pacote está desativado.
    this.combatRuntime?.update(dt)
    if (enabled) {
      this.healthBars?.update(this.combatRuntime?.getHostilePackages() ?? [])
    }
  }

  onRuntimeStop(): void {
    this.active = false
    this.combatRuntime?.resetRuntimeState()
    this.clearVisuals()
  }

  onDispose(): void {
    this.active = false
    this.clearVisuals()
    this.unregisterPackage?.()
    this.unregisterPackage = null
    this.combatRuntime?.resetRuntimeState()
    this.combatRuntime = null
    this.visualEffects = null
    this.healthBars = null
  }

  private clearVisuals(): void {
    this.healthBars?.clear()
    this.visualEffects?.clear()
  }
}
