import type { EngineGameModule, GameModuleContext } from '../../../engine/runtime/GameModule'
import type { BehaviorPackageInstance } from '../../../engine/script/packages'
import { registerVeilborneBehaviorPackage } from './behaviorPackageDefinition'
import { VeilborneHealthBarSystem } from './VeilborneHealthBarSystem'
import { VeilborneVisualEffects } from './VeilborneVisualEffects'

const PACKAGE_ID = 'veilborne_rpg'

/**
 * Adaptador inicial do VEILBORNE para o contrato público da engine.
 *
 * Esta primeira etapa conecta o ciclo de vida, o registro do pacote e os
 * sistemas visuais. Combate, habilidades, inventário e progressão ainda
 * precisam ser migrados para este módulo antes de o jogo estar completo.
 */
export class VeilborneGameModule implements EngineGameModule {
  readonly id = 'veilborne'

  private context: GameModuleContext | null = null
  private unregisterPackage: (() => void) | null = null
  private visualEffects: VeilborneVisualEffects | null = null
  private healthBars: VeilborneHealthBarSystem | null = null
  private active = false

  onAttach(context: GameModuleContext): void {
    this.context = context
    this.unregisterPackage = registerVeilborneBehaviorPackage()
    this.visualEffects = new VeilborneVisualEffects(context.world.scene, context.invalidate)
    this.healthBars = new VeilborneHealthBarSystem(context.world.scene)
  }

  onRuntimeStart(context: GameModuleContext): void {
    this.active = context.logic.listPackages().some(
      instance => instance.enabled && instance.packageId === PACKAGE_ID,
    )
    if (!this.active) return

    // Inicializa apenas variáveis ausentes; nunca sobrescreve progresso salvo.
    const defaults: Record<string, boolean | number | string> = {
      vida: 100,
      vida_max: 100,
      eter: 100,
      eter_max: 100,
      vigor: 100,
      vigor_max: 100,
      postura: 0,
      postura_max: 100,
      ecos: 0,
      nivel: 1,
      experiencia: 0,
      pontos_atributo: 0,
      jogador_morreu: false,
      morte_contagem: 0,
      loot_notice: '',
    }
    for (const [name, value] of Object.entries(defaults)) {
      if (context.logic.getVariable(name) === undefined) context.logic.setVariable(name, value)
    }
  }

  update(dt: number, context: GameModuleContext): void {
    if (!this.active || !context.isRuntimeActive()) return
    this.visualEffects?.update(dt)
    this.healthBars?.update(this.getHostiles(context))
  }

  onRuntimeStop(): void {
    this.active = false
    this.clearVisuals()
  }

  onDispose(): void {
    this.active = false
    this.clearVisuals()
    this.unregisterPackage?.()
    this.unregisterPackage = null
    this.visualEffects = null
    this.healthBars = null
    this.context = null
  }

  private getHostiles(context: GameModuleContext): Array<{
    instance: BehaviorPackageInstance
    object: NonNullable<ReturnType<GameModuleContext['world']['get']>>
  }> {
    const hostiles: Array<{
      instance: BehaviorPackageInstance
      object: NonNullable<ReturnType<GameModuleContext['world']['get']>>
    }> = []

    for (const instance of context.logic.listPackages()) {
      if (!instance.enabled || instance.packageId !== PACKAGE_ID) continue
      if (instance.variables.faction !== 'hostile' || instance.variables.morto === true) continue
      const object = context.world.get(instance.ownerObjectId)
      if (object) hostiles.push({ instance, object })
    }
    return hostiles
  }

  private clearVisuals(): void {
    this.healthBars?.clear()
    this.visualEffects?.clear()
  }
}
