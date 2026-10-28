import { DEFAULT_MODEL_CONTROL_BINDINGS } from './script/packages'
import { getMountPackageSettings } from './script/packages'

export interface EngineInputContext {
  [key: string]: any
}

export function createEngineInputMethods() {
  return {
    mouseButtonBindingCode(this: EngineInputContext, button: number): string | null {
      const codes: Record<number, string> = {
        0: 'MouseLeft',
        1: 'MouseMiddle',
        2: 'MouseRight',
        3: 'MouseBack',
        4: 'MouseForward',
      }
      return codes[button] ?? null
    },
    dispatchMouseBinding(this: EngineInputContext, code: string, type: 'keydown' | 'keyup'): void {
      // Usa a mesma rota do teclado para controles, animações e Visual Script.
      window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))
    },
    isInteractiveRuntimeTarget(this: EngineInputContext, target: EventTarget | null): boolean {
      return target instanceof Element && !!target.closest(
        'button, input, select, textarea, a, [role="dialog"], [data-no-game-attack], .hud-settings-panel, .hud-custom-image',
      )
    },
    onRuntimePointerDown(this: EngineInputContext, event: PointerEvent): void {
      if (
        event.pointerType !== 'mouse' ||
        !this.cameraStateBeforeRun ||
        !this.runtimeModeActive
      ) return
    
      const code = this.mouseButtonBindingCode(event.button)
      if (!code || this.isInteractiveRuntimeTarget(event.target)) return
    
      const isMappedControl = Object.values(this.playerControlBindings).some(binding => binding === code)
      const dispatchedCode = isMappedControl ? code : null
    
      if (!dispatchedCode) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (this.pressedMouseBindings.has(code)) return
      this.pressedMouseBindings.set(code, dispatchedCode)
      this.dispatchMouseBinding(dispatchedCode, 'keydown')
    },
    onRuntimePointerUp(this: EngineInputContext, event: PointerEvent): void {
      if (!this.cameraStateBeforeRun || !this.runtimeModeActive) return
      const mouseCode = this.mouseButtonBindingCode(event.button)
      if (!mouseCode) return
      const dispatchedCode = this.pressedMouseBindings.get(mouseCode)
      if (!dispatchedCode) return
    
      event.preventDefault()
      event.stopImmediatePropagation()
      this.pressedMouseBindings.delete(mouseCode)
      this.dispatchMouseBinding(dispatchedCode, 'keyup')
    },
    onGameModuleKeyUp(this: EngineInputContext, event: KeyboardEvent): void {
      this.gameModules.dispatchKeyUp(event)
    },
    onGameModuleBlur(this: EngineInputContext): void {
      for (const code of this.pressedMouseBindings.values()) this.dispatchMouseBinding(code, 'keyup')
      this.pressedMouseBindings.clear()
      this.gameModules.dispatchInputBlur()
    },
    onRuleKeyDown(this: EngineInputContext, event: KeyboardEvent): void {
      if (!this.cameraStateBeforeRun || event.repeat || event.metaKey) return
    
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      const modifierKey = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(event.code)
      if ((event.ctrlKey || event.altKey) && !modifierKey) return
    
      // Atalhos de ação ficam disponíveis como eventos personalizados do projeto.
      // Evita, por exemplo, que Tab mova o foco da interface enquanto o jogo roda.
      const actionKeys = [
        this.playerControlBindings.primaryAction,
        this.playerControlBindings.secondaryAction,
        this.playerControlBindings.inventory,
        this.playerControlBindings.useItem,
        this.playerControlBindings.reload,
        this.playerControlBindings.ability1,
        this.playerControlBindings.ability2,
        this.playerControlBindings.ability3,
        this.playerControlBindings.ability4,
        this.playerControlBindings.emote,
      ]
      if (actionKeys.includes(event.code)) event.preventDefault()
    
      // Montaria é um pacote de comportamento comum, configurado por objeto.
      // A tecla é lida da instância instalada; nenhum nome de espécie é necessário.
      if (this.avatar.isMounted()) {
        const packageInstance = this.activeMountPackageId
          ? this.logic.listPackages().find(instance => instance.id === this.activeMountPackageId)
          : undefined
        const interactionKey = packageInstance ? getMountPackageSettings(packageInstance).interactionKey : 'KeyE'
        if (event.code === this.playerControlBindings.interact || (interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === interactionKey)) {
          const mountedObjectId = this.avatar.dismount()
          if (packageInstance) {
            this.logic.setPackageVariable(packageInstance.id, 'mounted', false)
            this.logic.setPackageVariable(packageInstance.id, 'movementState', 'idle')
            this.notifyBehaviorPackageChanged(packageInstance.ownerObjectId)
            if (mountedObjectId) this.triggerBehaviorPackageEvent(mountedObjectId, packageInstance.packageId, 'dismounted')
            this.logic.triggerKeyPressed(event.code)
          }
          this.activeMountPackageId = null
          this.lastMountMovementState = null
          event.preventDefault()
          return
        }
      } else {
        const playerPosition = this.avatar.mesh.position
        const candidates = this.logic.listPackages()
          .filter(instance => instance.enabled && instance.packageId === 'mount')
          .map(instance => {
            const object = this.world.get(instance.ownerObjectId)
            const settings = getMountPackageSettings(instance)
            const distance = object
              ? Math.hypot(object.mesh.position.x - playerPosition.x, object.mesh.position.z - playerPosition.z)
              : Number.POSITIVE_INFINITY
            return { instance, object, settings, distance }
          })
          .filter(candidate =>
            candidate.object !== undefined && this.world.isObjectVisible(candidate.object) &&
            (event.code === this.playerControlBindings.interact || (candidate.settings.interactionKey !== DEFAULT_MODEL_CONTROL_BINDINGS.interact && event.code === candidate.settings.interactionKey)) &&
            candidate.distance <= candidate.settings.interactionRadius,
          )
          .sort((a, b) => a.distance - b.distance)
    
        for (const candidate of candidates) {
          if (!candidate.object) continue
          // A tentativa de interação é um gatilho próprio do pacote; as regras
          // podem avaliar variáveis/condições antes da ação Montar.
          this.triggerBehaviorPackageEvent(candidate.instance.ownerObjectId, candidate.instance.packageId, 'interact')
          // A regra Interagir pode mudar variáveis do pacote. Consulte a instância
          // atual, não a cópia retornada por listPackages antes do disparo.
          const currentInstance = this.logic.listPackages().find(instance => instance.id === candidate.instance.id)
          if (!currentInstance?.enabled || !this.world.isObjectVisible(candidate.object)) continue
          const currentSettings = getMountPackageSettings(currentInstance)
          if (!this.avatar.mount(candidate.object.mesh, currentSettings)) continue
          this.activeMountPackageId = currentInstance.id
          this.lastMountMovementState = this.avatar.getMountedMovementState()
          this.logic.setPackageVariable(currentInstance.id, 'mounted', true)
          this.logic.setPackageVariable(currentInstance.id, 'movementState', this.lastMountMovementState ?? 'idle')
          this.notifyBehaviorPackageChanged(currentInstance.ownerObjectId)
          this.triggerBehaviorPackageEvent(currentInstance.ownerObjectId, currentInstance.packageId, 'mounted')
          // O mesmo gatilho de tecla também pode iniciar regras comuns ligadas
          // ao objeto; o pacote não substitui o sistema de eventos existente.
          this.logic.triggerKeyPressed(event.code)
          event.preventDefault()
          return
        }
      }
    
      // Módulos de jogo processam suas ações; o Visual Script genérico recebe a tecla também.
      const moduleHandled = this.gameModules.dispatchKeyDown(event)
      const executed = this.logic.triggerKeyPressed(event.code)
      if (executed || moduleHandled) event.preventDefault()
    }
  }
}
