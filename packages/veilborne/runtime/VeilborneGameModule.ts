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
    this.combatRuntime = new VeilborneCombatRuntime(context)
    this.visualEffects = new VeilborneVisualEffects(context.world.scene, context.invalidate)
    this.healthBars = new VeilborneHealthBarSystem(context.world.scene)
  }

  onRuntimeStart(context: GameModuleContext): void {
    this.active = context.logic.listPackages().some(
      instance => instance.enabled && instance.packageId === PACKAGE_ID,
    )
    if (!this.active) return

    this.combatRuntime?.ensurePlayerVariables()
  }

  update(dt: number, context: GameModuleContext): void {
    if (!this.active || !context.isRuntimeActive()) return
    this.visualEffects?.update(dt)
    this.combatRuntime?.tickHostileStatuses(dt)
    this.healthBars?.update(this.combatRuntime?.getHostilePackages() ?? [])
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
