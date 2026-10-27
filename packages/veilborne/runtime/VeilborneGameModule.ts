import * as THREE from 'three'
import type { EngineGameModule, GameModuleContext } from '../../../engine/runtime/GameModule'
import { registerVeilborneBehaviorPackage } from './behaviorPackageDefinition'
import { VeilborneCombatRuntime } from './VeilborneCombatRuntime'
import { VeilborneDeathRespawnSystem } from './VeilborneDeathRespawnSystem'
import { VeilborneEnemyAISystem } from './VeilborneEnemyAISystem'
import { VeilborneHealthBarSystem } from './VeilborneHealthBarSystem'
import { VeilborneInventorySystem } from './VeilborneInventorySystem'
import { VeilborneItemUseSystem } from './VeilborneItemUseSystem'
import { VeilborneLootSystem } from './VeilborneLootSystem'
import { VeilborneProgressionSystem } from './VeilborneProgressionSystem'
import { VeilborneTargetLockController } from './VeilborneTargetLockController'
import { VeilborneVisualEffects } from './VeilborneVisualEffects'
import { resolveVeilborneGameModuleControls } from './VeilborneControls'
import type { VeilborneGameModuleControls, VeilborneGameModuleOptions } from './VeilborneControls'
export type { VeilborneGameModuleControls, VeilborneGameModuleOptions } from './VeilborneControls'

const PACKAGE_ID = 'veilborne_rpg'

/**
 * Módulo opcional do jogo VEILBORNE.
 *
 * Todos os sistemas específicos do jogo são criados e conectados aqui. O núcleo
 * só conhece o contrato EngineGameModule e não importa nenhuma regra de VEILBORNE.
 */
export class VeilborneGameModule implements EngineGameModule {
  readonly id = 'veilborne'

  private context: GameModuleContext | null = null
  private unregisterPackage: (() => void) | null = null
  private combatRuntime: VeilborneCombatRuntime | null = null
  private enemyAI: VeilborneEnemyAISystem | null = null
  private targetLock: VeilborneTargetLockController | null = null
  private visualEffects: VeilborneVisualEffects | null = null
  private healthBars: VeilborneHealthBarSystem | null = null
  private itemUse: VeilborneItemUseSystem | null = null
  private loot: VeilborneLootSystem | null = null
  private progression: VeilborneProgressionSystem | null = null
  private deathRespawn: VeilborneDeathRespawnSystem | null = null
  private active = false
  private pressedBlockKey: string | null = null
  private defaultSpawnPosition: THREE.Vector3 | null = null
  private respawnRemainingSeconds = 0
  private lootNoticeRemainingSeconds = 0
  private configuredControls: Partial<VeilborneGameModuleControls>

  constructor(options: VeilborneGameModuleOptions = {}) {
    this.configuredControls = { ...options.controls }
  }

  /** Atualiza os atalhos do host sem reiniciar o estado de gameplay. */
  setControls(controls: Partial<VeilborneGameModuleControls> = {}): void {
    this.configuredControls = { ...controls }
  }

  onAttach(context: GameModuleContext): void {
    this.context = context
    this.unregisterPackage = registerVeilborneBehaviorPackage()
    context.logic.ensureBehaviorPackageScripts(PACKAGE_ID)
    const visualEffects = new VeilborneVisualEffects(context.world.scene, () => context.invalidate())
    this.visualEffects = visualEffects
    const combatRuntime = new VeilborneCombatRuntime(context, visualEffects)
    this.combatRuntime = combatRuntime
    this.healthBars = new VeilborneHealthBarSystem(context.world.scene)
    const inventory = new VeilborneInventorySystem(context.logic, (message, duration) => {
      this.showNotice(context, message, duration)
    })

    const notifyPackageChanged = (ownerObjectId: string): void => {
      context.world.events.emit('behaviorPackageChanged', { ownerObjectId })
      context.invalidate()
    }
    const removeObject = (id: string): void => {
      if (context.world.get(id)) context.world.remove(id)
      context.logic.removeObjectVariables(id)
    }
    const installBehaviorPackage = (ownerObjectId: string, packageId: string) => {
      const instance = context.logic.installPackage(ownerObjectId, packageId)
      notifyPackageChanged(ownerObjectId)
      return instance
    }
    const spawnEffect = (position: THREE.Vector3, color: number, scale: number, durationSeconds = 0.32): void => {
      visualEffects.spawnEffect(position, color, scale, durationSeconds)
    }

    const targetLock = new VeilborneTargetLockController({
      scene: context.world.scene,
      avatar: context.avatar.mesh,
      logic: context.logic,
      findTarget: maxRange => combatRuntime.findTarget(maxRange),
      getHostiles: () => combatRuntime.getHostilePackages(),
      getWorldPoint: objectId => combatRuntime.getWorldPoint(objectId),
      isPlayerAlive: () => combatRuntime.getPlayerCombatant().alive,
      spawnEffect,
      invalidate: () => context.invalidate(),
    })
    this.targetLock = targetLock
    context.avatar.setManeuverAdmission(kind => combatRuntime.admitManeuver(kind))

    const loot = new VeilborneLootSystem({
      world: context.world,
      logic: context.logic,
      avatar: context.avatar.mesh,
      inventory,
      isEnabled: () => this.combatRuntime?.isEnabled() ?? false,
      isRuntimeModeActive: () => context.isRuntimeActive(),
      installBehaviorPackage,
      notifyBehaviorPackageChanged: notifyPackageChanged,
      removeObject,
      spawnEffect,
      clearNotice: () => {
        if (context.logic.getVariable('loot_notice') !== undefined) context.logic.setVariable('loot_notice', '')
        this.lootNoticeRemainingSeconds = 0
      },
      invalidate: () => context.invalidate(),
    })
    this.loot = loot

    const progression = new VeilborneProgressionSystem({
      world: context.world,
      logic: context.logic,
      avatar: context.avatar.mesh,
      isEnabled: () => this.combatRuntime?.isEnabled() ?? false,
      isRuntimeModeActive: () => context.isRuntimeActive(),
      readNumber: (name, fallback) => this.combatRuntime?.readNumber(name, fallback) ?? fallback,
      getPlayer: () => this.combatRuntime!.getPlayerCombatant(),
      syncPlayer: player => this.combatRuntime?.syncPlayerCombatant(player),
      installBehaviorPackage,
      notifyBehaviorPackageChanged: notifyPackageChanged,
      triggerBehaviorPackageEvent: (ownerObjectId, packageId, eventId) =>
        context.logic.triggerPackageEvent(ownerObjectId, packageId, eventId),
      removeObject,
      registerSpawnedLoot: id => loot.registerSpawnedLoot(id),
      forgetSpawnedLoot: id => loot.forgetSpawnedLoot(id),
      spawnEffect,
      showNotice: (message, duration) => this.showNotice(context, message, duration),
      invalidate: () => context.invalidate(),
    })
    this.progression = progression

    const deathRespawn = new VeilborneDeathRespawnSystem({
      world: context.world,
      logic: context.logic,
      avatar: context.avatar,
      progression,
      readNumber: (name, fallback) => this.combatRuntime?.readNumber(name, fallback) ?? fallback,
      syncPlayer: player => this.combatRuntime?.syncPlayerCombatant(player),
      setCameraTarget: (x, y, z) => context.setCameraTarget(x, y, z),
      getDefaultSpawnPosition: () => this.defaultSpawnPosition,
      getRespawnRemaining: () => this.respawnRemainingSeconds,
      setRespawnRemaining: seconds => { this.respawnRemainingSeconds = seconds },
      resetCombatInputs: () => this.combatRuntime?.resetCombatInputs(),
      clearTargetLock: () => {
        context.logic.setVariable('alvo_travado', false)
        context.logic.setVariable('alvo_veilborne_id', '')
      },
      spawnEffect,
      invalidate: () => context.invalidate(),
      setLootNoticeDuration: seconds => { this.lootNoticeRemainingSeconds = seconds },
    })
    this.deathRespawn = deathRespawn
    combatRuntime.setPlayerDeathHandler(() => {
      targetLock.clear()
      deathRespawn.handlePlayerDeath()
    })
    combatRuntime.setEnemyKilledHandler(instance => loot.spawnDrop(instance))

    const itemUse = new VeilborneItemUseSystem({
      logic: context.logic,
      inventory,
      isEnabled: () => this.combatRuntime?.isEnabled() ?? false,
      isRuntimeModeActive: () => context.isRuntimeActive(),
      getPlayer: () => this.combatRuntime!.getPlayerCombatant(),
      syncPlayer: player => this.combatRuntime?.syncPlayerCombatant(player),
      readEchoes: () => this.combatRuntime?.readNumber('ecos', 0) ?? 0,
      findTarget: maxRange => this.combatRuntime?.findTarget(maxRange) ?? null,
      getHostiles: () => this.combatRuntime?.getHostilePackages() ?? [],
      getAvatarMesh: () => context.avatar.mesh,
      spawnEffect,
      applyHit: (instance, amount, damageType, postureDamage, status) =>
        combatRuntime.applyDamageToTarget(instance, amount, damageType, postureDamage, status)
          ?? { damage: 0, killed: false },
      showNotice: (message, duration) => this.showNotice(context, message, duration),
      invalidate: () => context.invalidate(),
    })
    this.itemUse = itemUse

    this.enemyAI = new VeilborneEnemyAISystem(context, combatRuntime, visualEffects)
    this.loot?.placeExistingLootOnGround()
  }

  onRuntimeStart(context: GameModuleContext): void {
    this.defaultSpawnPosition = context.avatar.mesh.position.clone()
    this.respawnRemainingSeconds = 0
    this.active = this.combatRuntime?.isEnabled() ?? context.logic.listPackages().some(
      instance => instance.enabled && instance.packageId === PACKAGE_ID,
    )
    this.enemyAI?.syncAutonomousPackages(this.active)
    if (!this.active) return

    this.loot?.placeExistingLootOnGround()
    this.combatRuntime?.ensurePlayerVariables()
    this.restoreEchoCacheIfNeeded(context)
  }

  onKeyDown(event: KeyboardEvent, context: GameModuleContext): boolean {
    if (!context.isRuntimeActive() || !(this.combatRuntime?.isEnabled() ?? false)) return false
    const bindings = context.getControlBindings()
    const extraControls = this.getExtraControls(context)
    if (event.code === extraControls.block) {
      this.pressedBlockKey = event.code
      this.combatRuntime?.setBlocking(true)
      return true
    }
    if (event.code === extraControls.parry) {
      this.combatRuntime?.beginParry()
      return true
    }
    if (event.code === extraControls.targetLock) {
      this.targetLock?.toggle()
      return true
    }
    if (event.code === bindings.interact) {
      if (this.progression?.activateCheckpoint() || this.progression?.pickupEchoCache() || this.loot?.pickup()) return true
    }
    return this.combatRuntime?.handleKeyDown(event) ?? false
  }

  onKeyUp(event: KeyboardEvent): void {
    if (event.code === this.pressedBlockKey) {
      this.pressedBlockKey = null
      this.combatRuntime?.setBlocking(false)
      return
    }
    this.combatRuntime?.handleKeyUp(event)
  }

  onInputBlur(): void {
    this.pressedBlockKey = null
    this.combatRuntime?.handleInputBlur()
    this.combatRuntime?.setBlocking(false)
    this.targetLock?.clear()
  }

  update(dt: number, context: GameModuleContext): void {
    if (!context.isRuntimeActive()) return

    const enabled = this.combatRuntime?.isEnabled() ?? false
    if (enabled && !this.active) {
      this.loot?.placeExistingLootOnGround()
      this.combatRuntime?.ensurePlayerVariables()
      this.restoreEchoCacheIfNeeded(context)
      this.active = true
    } else if (!enabled && this.active) {
      this.active = false
      this.targetLock?.clear()
      this.combatRuntime?.resetCombatInputs()
      this.combatRuntime?.resetRuntimeState()
      context.avatar.setActionLock(0)
      this.enemyAI?.clear()
      this.healthBars?.clear()
      this.visualEffects?.clear()
    }

    this.enemyAI?.syncAutonomousPackages(enabled)
    this.combatRuntime?.update(dt)
    if (!enabled) return

    this.itemUse?.processRequest()
    this.targetLock?.update(this.combatRuntime!.getPlayerCombatant().alive)
    this.enemyAI?.update(dt)
    this.deathRespawn?.update(dt, this.combatRuntime!.getPlayerCombatant())
    this.healthBars?.update(this.combatRuntime?.getHostilePackages() ?? [])
    this.updateLootNotice(dt)
  }

  onRuntimeStop(): void {
    this.pressedBlockKey = null
    const hadGameRuntime = this.active || (this.combatRuntime?.isEnabled() ?? false)
    this.active = false
    if (hadGameRuntime) {
      this.combatRuntime?.resetCombatInputs()
      this.context?.avatar.setActionLock(0)
    }
    this.targetLock?.clear()
    this.combatRuntime?.resetRuntimeState()
    this.enemyAI?.clear()
    this.loot?.resetForEditor()
    this.progression?.clearEchoCacheReference()
    this.defaultSpawnPosition = null
    this.respawnRemainingSeconds = 0
    this.lootNoticeRemainingSeconds = 0
    this.clearVisuals()
  }

  onDispose(): void {
    this.active = false
    this.pressedBlockKey = null
    this.clearVisuals()
    this.unregisterPackage?.()
    this.unregisterPackage = null
    this.targetLock?.clear()
    this.context?.avatar.setManeuverAdmission(null)
    this.targetLock = null
    this.combatRuntime?.resetRuntimeState()
    this.enemyAI?.clear()
    this.enemyAI = null
    this.combatRuntime = null
    this.visualEffects = null
    this.healthBars = null
    this.itemUse = null
    this.loot = null
    this.progression = null
    this.deathRespawn = null
    this.defaultSpawnPosition = null
    this.context = null
  }

  private restoreEchoCacheIfNeeded(context: GameModuleContext): void {
    const progression = this.progression
    if (!progression) return
    progression.syncEchoCacheReference()
    const lostEchoes = this.combatRuntime?.readNumber('ecos_perdidos', 0) ?? 0
    if (lostEchoes <= 0 || progression.echoCacheObjectId) return

    const cachePosition = new THREE.Vector3(
      this.combatRuntime?.readNumber('ponto_de_morte_x', context.avatar.mesh.position.x) ?? context.avatar.mesh.position.x,
      this.combatRuntime?.readNumber('ponto_de_morte_y', context.avatar.mesh.position.y) ?? context.avatar.mesh.position.y,
      this.combatRuntime?.readNumber('ponto_de_morte_z', context.avatar.mesh.position.z) ?? context.avatar.mesh.position.z,
    )
    progression.spawnEchoCache(lostEchoes, cachePosition)
  }

  private getExtraControls(context: GameModuleContext): VeilborneGameModuleControls {
    return resolveVeilborneGameModuleControls(
      context.getControlBindings(),
      this.configuredControls,
    )
  }

  private showNotice(context: GameModuleContext, message: string, durationSeconds: number): void {
    context.logic.setVariable('loot_notice', message)
    this.lootNoticeRemainingSeconds = Math.max(0, durationSeconds)
    context.invalidate()
  }

  private updateLootNotice(dt: number): void {
    if (this.lootNoticeRemainingSeconds <= 0) return
    this.lootNoticeRemainingSeconds = Math.max(0, this.lootNoticeRemainingSeconds - Math.max(0, dt))
    if (this.lootNoticeRemainingSeconds <= 0 && this.combatRuntime?.isEnabled()) {
      const context = this.context
      if (context?.logic.getVariable('loot_notice') !== undefined) {
        context.logic.setVariable('loot_notice', '')
      }
    }
  }

  private clearVisuals(): void {
    this.healthBars?.clear()
    this.visualEffects?.clear()
  }
}
