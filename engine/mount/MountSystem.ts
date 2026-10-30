import * as THREE from 'three'
import { RapierCharacterController, DEFAULT_CHARACTER_CONFIG } from '../physics/RapierCharacterController.ts'
import type { MountPoint, MountConfig, MountState, MountMovementState, MountBehaviorConfig, MountResult, DismountResult, MountControlBindings, MountSystemContext, MountInput } from './MountPoint.ts'
import { createMountPoint } from './MountPoint.ts'
import { MountAnimationMapper, createAnimationMappingFromConfig } from './MountAnimationMapper.ts'
import { getColliderBounds } from '../world/HumanoidAvatarShared.ts'

/**
 * Estado interno do sistema de montaria
 */
interface InternalMountState {
  isMounted: boolean
  mountedObjectId: string | null
  mountedObjectRoot: THREE.Mesh | null
  mountPointId: string | null
  mountPoint: MountPoint | null
  mountConfig: MountConfig | null
  behaviorConfig: MountBehaviorConfig
  movementState: MountMovementState
  airborne: boolean
  verticalVelocity: number
  supportProbeElapsed: number
  hasSupport: boolean
  lastSupportPosition: THREE.Vector3
  previousPosition: THREE.Vector3
  previousRotation: THREE.Euler
  characterController: RapierCharacterController | null
  animationMapper: MountAnimationMapper
  playerVisibleBeforeMount: boolean
  mountVisualPivot: THREE.Object3D | null
  mountVisualBaseQuaternion: THREE.Quaternion | null
  inputBuffer: MountInput
}

/**
 * Sistema principal de montaria - gerencia anexação, movimento, física e animações
 */
export class MountSystem {
  private context: MountSystemContext
  private state: InternalMountState
  private readonly DEFAULT_BEHAVIOR_CONFIG: MountBehaviorConfig = {
    walkSpeed: 4.2,
    runMultiplier: 1.7,
    sprintMultiplier: 2.5,
    jumpImpulse: 10.0,
    gravity: 18.0,
    maxSlopeAngle: Math.PI / 4,
    maxStepHeight: 0.5,
    turnSpeed: 5.5,
    cameraSmoothing: 0.2,
    canJump: true,
    canSprint: true,
    canAttack: false,
    useCharacterController: false,
  }

  constructor(context: MountSystemContext) {
    this.context = context
    this.state = this.createInitialState()
  }

  private createInitialState(): InternalMountState {
    return {
      isMounted: false,
      mountedObjectId: null,
      mountedObjectRoot: null,
      mountPointId: null,
      mountPoint: null,
      mountConfig: null,
      behaviorConfig: { ...this.DEFAULT_BEHAVIOR_CONFIG },
      movementState: 'idle',
      airborne: false,
      verticalVelocity: 0,
      supportProbeElapsed: 0,
      hasSupport: false,
      lastSupportPosition: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      previousRotation: new THREE.Euler(),
      characterController: null,
      animationMapper: new MountAnimationMapper(),
      playerVisibleBeforeMount: true,
      mountVisualPivot: null,
      mountVisualBaseQuaternion: null,
      inputBuffer: {
        forward: 0,
        backward: 0,
        left: 0,
        right: 0,
        run: false,
        sprint: false,
        jump: false,
        action1: false,
        action2: false,
        action3: false,
        action4: false,
        interact: false,
      },
    }
  }

  /**
   * Inicializa o sistema
   */
  async initialize(): Promise<void> {
    // Pré-carrega configuração padrão de animação
    this.state.animationMapper = new MountAnimationMapper(createAnimationMappingFromConfig({
      mountPoints: [],
      defaultSeatOffset: new THREE.Vector3(0, 0.55, 0),
      mountable: true,
      interactionRadius: 2.5,
      interactionKey: 'KeyE',
      controlBindings: this.getDefaultControlBindings(),
    }))
  }

  /**
   * Tenta montar em um objeto
   */
  async mount(targetObject: THREE.Mesh, preferredMountPointId?: string): Promise<MountResult> {
    if (this.state.isMounted) {
      return { success: false, mountPointId: null, error: 'ALREADY_MOUNTED' }
    }

    const mountConfig = this.getMountConfig(targetObject)
    if (!mountConfig || !mountConfig.mountable) {
      return { success: false, mountPointId: null, error: 'NOT_MOUNTABLE' }
    }

    // Verifica distância
    const distance = this.context.playerCollisionMesh.position.distanceTo(targetObject.position)
    if (distance > mountConfig.interactionRadius) {
      return { success: false, mountPointId: null, error: 'OUT_OF_RANGE' }
    }

    // Seleciona ponto de montagem
    const mountPoint = this.selectMountPoint(targetObject, mountConfig, preferredMountPointId)
    if (!mountPoint) {
      return { success: false, mountPointId: null, error: 'NO_VALID_MOUNT_POINTS' }
    }

    // Verifica se assento está ocupado (via variável de estado)
    if (mountPoint.stateVariable) {
      const occupied = this.context.getScriptVariable(mountPoint.stateVariable, targetObject.userData.id)
      if (occupied === true) {
        return { success: false, mountPointId: null, error: 'MOUNT_POINT_OCCUPIED' }
      }
    }

    if (!mountPoint.playerUsable) {
      return { success: false, mountPointId: null, error: 'MOUNT_POINT_NOT_PLAYER_USABLE' }
    }

    if (mountPoint.requiresInteraction && !this.state.inputBuffer.interact) {
      return { success: false, mountPointId: null, error: 'INTERACTION_REQUIRED' }
    }

    // Executa montagem
    const success = await this.performMount(targetObject, mountPoint, mountConfig)
    if (!success) {
      return { success: false, mountPointId: null, error: 'PHYSICS_FAILED' }
    }

    // Dispara evento OnMount
    this.context.emitScriptEvent('OnMount', {
      mountObjectId: targetObject.userData.id,
      mountPointId: mountPoint.id,
      playerId: this.context.playerCollisionMesh.userData.id,
    })

    // Atualiza variável de estado do assento
    if (mountPoint.stateVariable) {
      this.context.setScriptVariable(mountPoint.stateVariable, true, targetObject.userData.id)
    }

    // Atualiza variável 'mounted' do pacote
    this.context.setScriptVariable('mounted', true, targetObject.userData.id)
    this.context.setScriptVariable('movementState', 'idle', targetObject.userData.id)

    return { success: true, mountPointId: mountPoint.id }
  }

  /**
   * Executa a lógica de montagem
   */
  private async performMount(
    targetObject: THREE.Mesh,
    mountPoint: MountPoint,
    mountConfig: MountConfig
  ): Promise<boolean> {
    const { playerVisualRoot, playerCollisionMesh, physicsWorld: _physicsWorld } = this.context

    // Salva estado anterior
    this.state.playerVisibleBeforeMount = playerVisualRoot.visible
    this.state.previousPosition.copy(playerCollisionMesh.position)
    this.state.previousRotation.copy(playerCollisionMesh.rotation)

    // Configura estado
    this.state.isMounted = true
    this.state.mountedObjectId = targetObject.userData.id ?? null
    this.state.mountedObjectRoot = targetObject
    this.state.mountPointId = mountPoint.id
    this.state.mountPoint = mountPoint
    this.state.mountConfig = mountConfig
    this.state.behaviorConfig = { ...this.DEFAULT_BEHAVIOR_CONFIG, ...this.extractBehaviorConfig(mountConfig) }
    this.state.movementState = 'idle'
    this.state.airborne = false
    this.state.verticalVelocity = 0
    this.state.supportProbeElapsed = 1 // Força primeira sonda
    this.state.hasSupport = false
    this.state.lastSupportPosition.copy(targetObject.position)

    // Encontra pivot visual da montaria (ImportedVisualPivot ou raiz)
    this.state.mountVisualPivot = targetObject.getObjectByName('ImportedVisualPivot') ?? null
    this.state.mountVisualBaseQuaternion = this.state.mountVisualPivot?.quaternion.clone() ?? null

    // Desabilita colisão do jogador
    playerCollisionMesh.userData.mountCollisionManaged = true
    playerCollisionMesh.visible = false

    // Posiciona jogador no assento
    this.placePlayerAtMountPoint(mountPoint)

    // Inicializa mapeamento de animações
    const animationMapping = createAnimationMappingFromConfig(mountConfig)
    this.state.animationMapper = new MountAnimationMapper(animationMapping)
    this.state.animationMapper.initialize(targetObject, playerVisualRoot)

    // Toca animações de transição
    this.state.animationMapper.playMountTransition(false) // Montaria
    this.state.animationMapper.playMountTransition(true)  // Jogador

    // Esconde jogador após transição (será mostrado no assento)
    playerVisualRoot.visible = false

    // Se usa character controller, inicializa
    if (this.state.behaviorConfig.useCharacterController) {
      await this.initializeCharacterController(targetObject)
    }

    // Marca colisão da montaria como gerenciada
    targetObject.userData.mountCollisionManaged = true

    return true
  }

  /**
   * Inicializa character controller para a montaria
   */
  private async initializeCharacterController(mountRoot: THREE.Mesh): Promise<void> {
    const config = {
      ...DEFAULT_CHARACTER_CONFIG,
      radius: Math.max(0.5, this.getMountBounds(mountRoot).getSize(new THREE.Vector3()).x * 0.5),
      height: this.getMountBounds(mountRoot).getSize(new THREE.Vector3()).y,
      maxSlopeAngle: this.state.behaviorConfig.maxSlopeAngle,
      maxStepHeight: this.state.behaviorConfig.maxStepHeight,
      jumpImpulse: this.state.behaviorConfig.jumpImpulse,
      walkSpeed: this.state.behaviorConfig.walkSpeed,
      sprintSpeed: this.state.behaviorConfig.walkSpeed * this.state.behaviorConfig.sprintMultiplier,
    }

    this.state.characterController = new RapierCharacterController(this.context.physicsWorld, config)
    await this.state.characterController.initialize()

    // Teleporta controller para posição da montaria
    this.state.characterController.teleport(mountRoot.position.clone())
  }

  /**
   * Desmonta o jogador
   */
  async dismount(): Promise<DismountResult> {
    if (!this.state.isMounted || !this.state.mountedObjectRoot) {
      return { success: false, dismountPosition: null, error: 'NOT_MOUNTED' }
    }

    const mountRoot = this.state.mountedObjectRoot
    const mountPoint = this.state.mountPoint
    const mountObjectId = this.state.mountedObjectId

    // Toca animações de desmontagem
    this.state.animationMapper.playDismountTransition(false) // Montaria
    this.state.animationMapper.playDismountTransition(true)  // Jogador

    // Aguarda um frame para animações iniciarem
    // (em implementação real, usaria callback ou promise)

    // Encontra posição segura para desmontagem
    const dismountPosition = this.findDismountPosition(mountRoot, mountPoint)
    if (!dismountPosition) {
      return { success: false, dismountPosition: null, error: 'NO_VALID_DISMOUNT_POSITION' }
    }

    // Restaura colisão do jogador
    this.context.playerCollisionMesh.userData.mountCollisionManaged = false
    this.context.playerCollisionMesh.visible = true
    this.context.playerCollisionMesh.position.copy(dismountPosition)
    this.context.playerCollisionMesh.updateMatrixWorld(true)

    // Restaura visibilidade do jogador
    this.context.playerVisualRoot.visible = true
    this.context.playerVisualRoot.position.copy(dismountPosition)
    this.context.playerVisualRoot.updateMatrixWorld(true)

    // Restaura pivot visual da montaria
    if (this.state.mountVisualPivot && this.state.mountVisualBaseQuaternion) {
      this.state.mountVisualPivot.quaternion.copy(this.state.mountVisualBaseQuaternion)
      this.state.mountVisualPivot.updateMatrixWorld(true)
    }

    // Limpa colisão gerenciada
    mountRoot.userData.mountCollisionManaged = false

    // Descarta character controller se existe
    if (this.state.characterController) {
      this.state.characterController.dispose()
      this.state.characterController = null
    }

    // Limpa mapeamento de animações
    this.state.animationMapper.dispose()

    // Estado anterior
    const wasPositionChanged = this.state.previousPosition.distanceToSquared(mountRoot.position) > 1e-6
    const wasRotationChanged = !this.state.previousRotation.equals(mountRoot.rotation)

    // Reseta estado
    this.resetMountState()

    // Dispara evento OnDismount
    this.context.emitScriptEvent('OnDismount', {
      mountObjectId: mountObjectId,
      mountPointId: mountPoint?.id ?? null,
      playerId: this.context.playerCollisionMesh.userData.id,
      positionChanged: wasPositionChanged,
      rotationChanged: wasRotationChanged,
    })

    // Atualiza variáveis de estado
    if (mountPoint?.stateVariable && mountObjectId) {
      this.context.setScriptVariable(mountPoint.stateVariable, false, mountObjectId)
    }
    if (mountObjectId) {
      this.context.setScriptVariable('mounted', false, mountObjectId)
      this.context.setScriptVariable('movementState', 'idle', mountObjectId)
    }

    // Notifica mundo se posição/rotação mudaram
    if (mountObjectId && (wasPositionChanged || wasRotationChanged)) {
      this.context.world.notifyChanged(mountObjectId)
    }

    return { success: true, dismountPosition }
  }

  /**
   * Atualiza o sistema de montaria (chamado a cada frame)
   */
  update(deltaTime: number): void {
    if (!this.state.isMounted || !this.state.mountedObjectRoot) return

    const mountRoot = this.state.mountedObjectRoot
    const config = this.state.behaviorConfig

    // Processa input
    const input = this.processInput()

    // Atualiza movement state baseado no input
    this.updateMovementState(input)

    // Atualiza animações
    this.updateAnimations(deltaTime, input)

    // Atualiza física/movimento
    if (config.useCharacterController && this.state.characterController) {
      this.updateCharacterController(deltaTime, input)
    } else {
      this.updateKinematicMovement(deltaTime, input)
    }

    // Atualiza inclinação visual
    this.updateVisualSlope(mountRoot, deltaTime)

    // Atualiza camera
    this.updateCamera(deltaTime)

    // Atualiza variável de movimento
    if (this.state.mountedObjectId) {
      this.context.setScriptVariable('movementState', this.state.movementState, this.state.mountedObjectId)
    }
  }

  /**
   * Processa input bruto em comandos de movimento
   */
  private processInput(): { moveDirection: THREE.Vector3; jump: boolean; sprint: boolean; actions: string[] } {
    const { inputBuffer } = this.state

    // Em implementação real, leria estado real das teclas
    // Por agora, usa buffer interno
    const forward = inputBuffer.forward - inputBuffer.backward
    const side = inputBuffer.right - inputBuffer.left

    const moveDirection = new THREE.Vector3(
      side * Math.cos(this.context.getCameraYaw()) - forward * Math.sin(this.context.getCameraYaw()),
      0,
      -side * Math.sin(this.context.getCameraYaw()) - forward * Math.cos(this.context.getCameraYaw())
    ).normalize()

    const actions: string[] = []
    if (inputBuffer.action1) actions.push('action1')
    if (inputBuffer.action2) actions.push('action2')
    if (inputBuffer.action3) actions.push('action3')
    if (inputBuffer.action4) actions.push('action4')

    return {
      moveDirection: moveDirection.lengthSq() > 0 ? moveDirection : new THREE.Vector3(0, 0, 0),
      jump: inputBuffer.jump,
      sprint: inputBuffer.sprint || inputBuffer.run,
      actions,
    }
  }

  /**
   * Atualiza estado de movimento baseado no input
   */
  private updateMovementState(input: ReturnType<MountSystem['processInput']>): void {
    const { moveDirection, sprint } = input
    const length = moveDirection.length()

    if (length < 0.1) {
      this.state.movementState = 'idle'
      return
    }

    const forwardInput = -moveDirection.z
    const sideInput = moveDirection.x

    if (forwardInput !== 0 && sideInput !== 0) {
      this.state.movementState = sprint
        ? (sideInput < 0 ? 'run_diagonal_left' : 'run_diagonal_right')
        : (sideInput < 0 ? 'walk_diagonal_left' : 'walk_diagonal_right')
    } else {
      this.state.movementState = sprint ? 'run' : 'walk'
    }
  }

  /**
   * Atualiza animações da montaria e jogador
   */
  private updateAnimations(deltaTime: number, input: ReturnType<MountSystem['processInput']>): void {
    const { moveDirection, jump, sprint } = input
    const length = moveDirection.length()

    if (this.state.airborne) {
      // No ar - animação de pulo
      this.state.animationMapper.setMountMovementState('mount_jump_air')
      this.state.animationMapper.setPlayerMountState('player_mount_jump')
    } else if (length > 0.1) {
      // Movimento direcional - blend
      const forwardInput = -moveDirection.z
      const sideInput = moveDirection.x

      const weights = new Map<string, number>()
      // Lógica simplificada - em produção usaria getCircularDirectionalWeights
      if (forwardInput > 0.5 && Math.abs(sideInput) < 0.5) {
        weights.set(sprint ? 'mount_run' : 'mount_walk', 1)
        this.state.animationMapper.setPlayerMountState(sprint ? 'player_mount_run' : 'player_mount_walk')
      } else if (forwardInput < -0.5 && Math.abs(sideInput) < 0.5) {
        weights.set('mount_walk', 1) // walk_backward
        this.state.animationMapper.setPlayerMountState('player_mount_walk')
      } else if (sideInput > 0.5) {
        weights.set(sprint ? 'mount_run' : 'mount_walk', 0.7)
        weights.set('mount_turn_right', 0.3)
        this.state.animationMapper.setPlayerMountState('player_mount_turn_right')
      } else if (sideInput < -0.5) {
        weights.set(sprint ? 'mount_run' : 'mount_walk', 0.7)
        weights.set('mount_turn_left', 0.3)
        this.state.animationMapper.setPlayerMountState('player_mount_turn_left')
      }

      if (weights.size > 0) {
        this.state.animationMapper.setMountBlendWeights(weights, sprint ? 1.5 : 1.0)
      }
    } else {
      // Parado
      this.state.animationMapper.setMountMovementState('mount_idle')
      this.state.animationMapper.setPlayerMountState('player_mount_idle')
    }

    // Pulo
    if (jump && !this.state.airborne && this.state.behaviorConfig.canJump) {
      this.requestJump()
    }

    // Atualiza controladores
    this.state.animationMapper.update(deltaTime)
  }

  /**
   * Atualiza movement usando character controller (Rapier)
   */
  private updateCharacterController(deltaTime: number, input: ReturnType<MountSystem['processInput']>): void {
    if (!this.state.characterController || !this.state.mountedObjectRoot) return

    const config = this.state.behaviorConfig
    const speed = config.walkSpeed * (input.sprint ? config.sprintMultiplier : 1)

    const controllerInput = {
      moveDirection: input.moveDirection.clone().multiplyScalar(speed),
      jump: input.jump,
      sprint: input.sprint,
      deltaTime,
    }

    const result = this.state.characterController.update(controllerInput)
    this.context.physicsWorld.step(deltaTime)

    // Sincroniza posição da montaria com controller
    const controllerPos = this.state.characterController.getPosition()
    this.state.mountedObjectRoot.position.set(controllerPos.x, controllerPos.y, controllerPos.z)
    this.state.mountedObjectRoot.updateMatrixWorld(true)

    // Atualiza estado
    this.state.airborne = !result.grounded
    this.state.verticalVelocity = result.velocity.y
    this.placePlayerAtMountPoint(this.state.mountPoint!)
  }

  /**
   * Atualiza movement cinemático (sem Rapier)
   */
  private updateKinematicMovement(deltaTime: number, input: ReturnType<MountSystem['processInput']>): void {
    if (!this.state.mountedObjectRoot) return

    const mountRoot = this.state.mountedObjectRoot
    const config = this.state.behaviorConfig
    const speed = config.walkSpeed * (input.sprint ? config.sprintMultiplier : 1)

    // Movimento horizontal
    if (input.moveDirection.lengthSq() > 0) {
      const moveDelta = input.moveDirection.clone().multiplyScalar(speed * deltaTime)

      // Move em sub-passos para colisão precisa
      const subSteps = Math.max(1, Math.ceil(moveDelta.length() / 0.1))
      const subStepDelta = moveDelta.clone().divideScalar(subSteps)

      for (let i = 0; i < subSteps; i++) {
        mountRoot.position.add(subStepDelta)
        mountRoot.updateMatrixWorld(true)

        if (this.context.collidesWithObjects(mountRoot)) {
          mountRoot.position.sub(subStepDelta)
          mountRoot.updateMatrixWorld(true)
          break
        }
      }

      // Rotaciona para direção do movimento
      const targetYaw = Math.atan2(input.moveDirection.x, input.moveDirection.z)
      mountRoot.rotation.y = THREE.MathUtils.lerp(
        mountRoot.rotation.y,
        targetYaw,
        1 - Math.exp(-deltaTime * config.turnSpeed)
      )
      mountRoot.updateMatrixWorld(true)
    }

    // Gravidade e pulo
    if (this.state.airborne) {
      mountRoot.position.y += this.state.verticalVelocity * deltaTime
      this.state.verticalVelocity -= config.gravity * deltaTime
      mountRoot.updateMatrixWorld(true)

      // Verifica pouso
      const supportY = this.findGroundSurface(mountRoot)
      if (this.state.verticalVelocity <= 0 && mountRoot.position.y <= supportY + 0.05) {
        mountRoot.position.y = supportY
        this.state.verticalVelocity = 0
        this.state.airborne = false
        mountRoot.updateMatrixWorld(true)
      }
    } else {
      // No chão - segue superfície
      const supportY = this.findGroundSurface(mountRoot)
      const bounds = this.getMountBounds(mountRoot)
      const feetY = bounds.min.y

      if (Math.abs(feetY - supportY) > 0.02) {
        mountRoot.position.y += supportY - feetY
        mountRoot.updateMatrixWorld(true)
      }

      // Verifica se saiu da borda
      const newSupportY = this.findGroundSurface(mountRoot)
      if (newSupportY < feetY - 0.5) {
        this.state.airborne = true
        this.state.verticalVelocity = 0
      }
    }

    this.placePlayerAtMountPoint(this.state.mountPoint!)
  }

  /**
   * Atualiza inclinação visual da montaria para acompanhar rampas
   */
  private updateVisualSlope(mountRoot: THREE.Mesh, deltaTime: number): void {
    const pivot = this.state.mountVisualPivot
    const baseQuaternion = this.state.mountVisualBaseQuaternion
    if (!pivot || !baseQuaternion) return

    // Raycast para baixo para encontrar normal do piso
    const bounds = this.getMountBounds(mountRoot)
    const feetY = bounds.min.y
    const originY = bounds.max.y + 0.5
    const lowestY = feetY - 2.0

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(mountRoot.position.x, originY, mountRoot.position.z),
      new THREE.Vector3(0, -1, 0),
      0,
      originY - lowestY
    )

    const hits = raycaster.intersectObjects(this.context.world.list()
      .filter(o => o.mesh !== mountRoot && o.mesh.visible && o.mesh.userData.colliderType !== 'none')
      .map(o => o.mesh), true)

    let targetQuaternion = baseQuaternion.clone()
    let foundSupport = false

    for (const hit of hits) {
      if (!hit.face) continue
      const normal = hit.face.normal.clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize()

      if (normal.y < 0.2) continue // Muito íngreme
      if (hit.point.y > feetY + 0.5 || hit.point.y < lowestY) continue

      // Converte normal para espaço local da montaria
      const inverseRootRotation = mountRoot.getWorldQuaternion(new THREE.Quaternion()).invert()
      const localNormal = normal.clone().applyQuaternion(inverseRootRotation).normalize()

      const tilt = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        localNormal
      )

      // Limita inclinação máxima
      const maxTilt = THREE.MathUtils.degToRad(42)
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(tilt.w), 0, 1))
      if (angle > maxTilt && angle > 1e-5) {
        targetQuaternion = new THREE.Quaternion().identity().slerp(tilt, maxTilt / angle).multiply(baseQuaternion)
      } else {
        targetQuaternion = tilt.multiply(baseQuaternion)
      }

      foundSupport = true
      break
    }

    if (foundSupport) {
      const blend = 1 - Math.exp(-10 * Math.max(0, deltaTime))
      pivot.quaternion.slerp(targetQuaternion, blend)
      mountRoot.updateWorldMatrix(true, true)
    }
  }

  /**
   * Atualiza camera seguindo o jogador montado
   */
  private updateCamera(_deltaTime: number): void {
    if (!this.state.mountedObjectRoot || !this.state.mountPoint) return

    const mountPoint = this.state.mountPoint
    const seatWorld = this.state.mountedObjectRoot.localToWorld(
      new THREE.Vector3(...mountPoint.localOffset.toArray())
    )

    const cameraOffset = mountPoint.cameraOffset ?? new THREE.Vector3(0, 1.5, 3)
    const targetPos = seatWorld.clone().add(cameraOffset)

    this.context.updateCameraTarget(targetPos)
  }

  /**
   * Posiciona jogador no ponto de montagem
   */
  private placePlayerAtMountPoint(mountPoint: MountPoint | null): void {
    if (!mountPoint || !this.state.mountedObjectRoot) return

    const mountRoot = this.state.mountedObjectRoot
    const seatWorld = mountRoot.localToWorld(new THREE.Vector3(...mountPoint.localOffset.toArray()))

    this.context.playerVisualRoot.position.copy(seatWorld)
    if (mountPoint.localRotation) {
      this.context.playerVisualRoot.quaternion.setFromEuler(mountPoint.localRotation)
    } else {
      this.context.playerVisualRoot.quaternion.copy(mountRoot.quaternion)
    }
    this.context.playerVisualRoot.updateMatrixWorld(true)

    this.context.playerCollisionMesh.position.copy(seatWorld)
    this.context.playerCollisionMesh.updateMatrixWorld(true)

    // Atualiza camera target
    this.context.updateCameraTarget(new THREE.Vector3(
      seatWorld.x,
      seatWorld.y + 0.9,
      seatWorld.z
    ))
  }

  /**
   * Encontra posição segura para desmontagem
   */
  private findDismountPosition(mountRoot: THREE.Mesh, _mountPoint: MountPoint | null): THREE.Vector3 | null {
    const bounds = this.getMountBounds(mountRoot)
    const halfWidth = Math.max(0.5, bounds.getSize(new THREE.Vector3()).x * 0.5)
    const playerRadius = this.context.getPlayerRadius()
    const bodyScale = this.context.getBodyScale()
    const dismountDistance = halfWidth + playerRadius + 0.4 * bodyScale

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mountRoot.quaternion).setY(0).normalize()
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1)
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(mountRoot.quaternion).setY(0).normalize()
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)

    const candidates = [
      mountRoot.position.clone().addScaledVector(side, dismountDistance),
      mountRoot.position.clone().addScaledVector(side, -dismountDistance),
      mountRoot.position.clone().addScaledVector(forward, dismountDistance),
      mountRoot.position.clone().addScaledVector(forward, -dismountDistance),
      mountRoot.position.clone().addScaledVector(side, dismountDistance * 0.7).addScaledVector(forward, dismountDistance * 0.7),
      mountRoot.position.clone().addScaledVector(side, dismountDistance * 0.7).addScaledVector(forward, -dismountDistance * 0.7),
      mountRoot.position.clone().addScaledVector(side, -dismountDistance * 0.7).addScaledVector(forward, dismountDistance * 0.7),
      mountRoot.position.clone().addScaledVector(side, -dismountDistance * 0.7).addScaledVector(forward, -dismountDistance * 0.7),
    ]

    const mountFeetY = bounds.min.y

    for (const candidate of candidates) {
      const x = THREE.MathUtils.clamp(candidate.x, -49, 49)
      const z = THREE.MathUtils.clamp(candidate.z, -49, 49)

      const supportY = this.findDismountSupportY(x, z, mountFeetY, mountRoot)
      if (supportY === null) continue

      const hasNearbyFloor = supportY >= mountFeetY - 0.65
      const testY = hasNearbyFloor ? supportY : mountFeetY

      this.context.playerCollisionMesh.position.set(x, testY + 0.025, z)
      this.context.playerCollisionMesh.updateMatrixWorld(true)

      if (!this.context.collidesWithObjects(this.context.playerCollisionMesh)) {
        return new THREE.Vector3(x, testY + 0.025, z)
      }
    }

    // Fallback: posição lateral simples
    const fallbackX = THREE.MathUtils.clamp(mountRoot.position.x + dismountDistance, -49, 49)
    const fallbackZ = THREE.MathUtils.clamp(mountRoot.position.z, -49, 49)
    return new THREE.Vector3(fallbackX, mountFeetY + 0.025, fallbackZ)
  }

  /**
   * Encontra suporte no solo para desmontagem
   */
  private findDismountSupportY(
    x: number,
    z: number,
    referenceFeetY: number,
    ignoredRoot: THREE.Mesh
  ): number | null {
    const terrainY = this.context.world.terrain.heightAt(x, z)
    let supportY: number | null = terrainY

    const originY = Math.max(referenceFeetY + this.context.getStandingPlayerHeight() + 2 * this.context.getBodyScale(), terrainY + this.context.getStandingPlayerHeight() + 2 * this.context.getBodyScale())
    const lowestAllowedY = terrainY - 0.15

    const allCandidates = this.context.world.list().filter(object =>
      object.mesh !== ignoredRoot &&
      object.mesh.visible &&
      object.mesh.userData.colliderType !== 'none'
    )

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0),
      0,
      Math.max(1, originY - lowestAllowedY)
    )

    const hits = raycaster.intersectObjects(allCandidates.map(o => o.mesh), true)
    const normalMatrix = new THREE.Matrix3()

    for (const hit of hits) {
      if (!hit.face) continue
      const normal = hit.face.normal.clone()
        .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
        .normalize()

      if (normal.y < 0.24) continue
      if (hit.point.y > referenceFeetY + 0.45 || hit.point.y < lowestAllowedY) continue

      if (supportY === null || hit.point.y > supportY) supportY = hit.point.y
      break
    }

    return supportY
  }

  /**
   * Encontra superfície de chão sob a montaria
   */
  private findGroundSurface(mountRoot: THREE.Mesh): number {
    const bounds = this.getMountBounds(mountRoot)
    const feetY = bounds.min.y
    const terrainY = this.context.world.terrain.heightAt(mountRoot.position.x, mountRoot.position.z)

    const originY = bounds.max.y + 1
    const lowestY = feetY - 2.0

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(mountRoot.position.x, originY, mountRoot.position.z),
      new THREE.Vector3(0, -1, 0),
      0,
      originY - lowestY
    )

    const hits = raycaster.intersectObjects(this.context.world.list()
      .filter(o => o.mesh !== mountRoot && o.mesh.visible && o.mesh.userData.colliderType !== 'none')
      .map(o => o.mesh), true)

    let supportY = terrainY
    const normalMatrix = new THREE.Matrix3()

    for (const hit of hits) {
      if (!hit.face) continue
      const normal = hit.face.normal.clone()
        .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
        .normalize()

      if (normal.y < 0.24) continue
      if (hit.point.y > feetY + 0.5 || hit.point.y < lowestY) continue

      if (hit.point.y > supportY) supportY = hit.point.y
      break
    }

    return supportY
  }

  /**
   * Solicita pulo
   */
  requestJump(): void {
    if (!this.state.isMounted || this.state.airborne || !this.state.behaviorConfig.canJump) return

    this.state.airborne = true
    this.state.verticalVelocity = this.state.behaviorConfig.jumpImpulse

    // Dispara evento de pulo
    if (this.state.mountedObjectId) {
      this.context.emitScriptEvent('OnMountJump', {
        mountObjectId: this.state.mountedObjectId,
        mountPointId: this.state.mountPointId,
      })
    }
  }

  /**
   * Define input buffer (chamado pelo sistema de input)
   */
  setInput(input: Partial<MountInput>): void {
    Object.assign(this.state.inputBuffer, input)
  }

  /**
   * Obtém estado público atual
   */
  getState(): MountState {
    return {
      isMounted: this.state.isMounted,
      mountedObjectId: this.state.mountedObjectId,
      mountPointId: this.state.mountPointId,
      movementState: this.state.movementState,
      airborne: this.state.airborne,
      verticalVelocity: this.state.verticalVelocity,
      supportProbeElapsed: this.state.supportProbeElapsed,
      lastSupportPosition: this.state.lastSupportPosition.clone(),
      hasSupport: this.state.hasSupport,
    }
  }

  /**
   * Verifica se está montado
   */
  isMounted(): boolean {
    return this.state.isMounted
  }

  /**
   * Obtém ID do objeto montado
   */
  getMountedObjectId(): string | null {
    return this.state.mountedObjectId
  }

  /**
   * Obtém ID do ponto de montagem atual
   */
  getMountPointId(): string | null {
    return this.state.mountPointId
  }

  /**
   * Obtém configuração de comportamento
   */
  getBehaviorConfig(): MountBehaviorConfig {
    return { ...this.state.behaviorConfig }
  }

  /**
   * Atualiza configuração de comportamento
   */
  setBehaviorConfig(config: Partial<MountBehaviorConfig>): void {
    Object.assign(this.state.behaviorConfig, config)

    if (this.state.characterController) {
      this.state.characterController.setConfig({
        maxSlopeAngle: config.maxSlopeAngle,
        maxStepHeight: config.maxStepHeight,
        jumpImpulse: config.jumpImpulse,
      })
    }
  }

  /**
   * Obtém mapeador de animações
   */
  getAnimationMapper(): MountAnimationMapper {
    return this.state.animationMapper
  }

  /**
   * Extrai configuração de comportamento do MountConfig
   */
  private extractBehaviorConfig(mountConfig: MountConfig): Partial<MountBehaviorConfig> {
    const variables = this.getMountVariables(mountConfig)
    return {
      walkSpeed: (variables.speed as number) ?? 4.2,
      runMultiplier: (variables.runMultiplier as number) ?? 1.7,
      sprintMultiplier: (variables.sprintMultiplier as number) ?? 2.5,
      jumpImpulse: (variables.jumpImpulse as number) ?? 10.0,
      gravity: (variables.gravity as number) ?? 18.0,
      maxSlopeAngle: (variables.maxSlopeAngle as number) ?? Math.PI / 4,
      maxStepHeight: (variables.maxStepHeight as number) ?? 0.5,
      turnSpeed: (variables.turnSpeed as number) ?? 5.5,
      cameraSmoothing: (variables.cameraSmoothing as number) ?? 0.2,
      canJump: (variables.canJump as boolean) ?? true,
      canSprint: (variables.canSprint as boolean) ?? true,
      canAttack: (variables.canAttack as boolean) ?? false,
      useCharacterController: (variables.useCharacterController as boolean) ?? false,
    }
  }

  /**
   * Obtém variáveis do pacote de montaria
   */
  private getMountVariables(_mountConfig: MountConfig): Record<string, unknown> {
    if (!this.state.mountedObjectId) return {}

    const vars: Record<string, unknown> = {}
    const varNames = ['speed', 'runMultiplier', 'sprintMultiplier', 'jumpImpulse', 'gravity', 'maxSlopeAngle', 'maxStepHeight', 'turnSpeed', 'cameraSmoothing', 'canJump', 'canSprint', 'canAttack', 'useCharacterController']

    for (const name of varNames) {
      const value = this.context.getScriptVariable(name, this.state.mountedObjectId)
      if (value !== undefined) vars[name] = value
    }

    return vars
  }

  /**
   * Obtém configuração de montagem do objeto
   */
  private getMountConfig(object: THREE.Mesh): MountConfig | null {
    const userData = object.userData
    if (userData.mountConfig) return userData.mountConfig as MountConfig

    // Compatibilidade legada
    if (userData.mountPackageSettings) {
      const legacy = userData.mountPackageSettings
      return {
        mountPoints: [],
        defaultSeatOffset: new THREE.Vector3(...legacy.seatOffset),
        mountable: true,
        interactionRadius: legacy.interactionRadius,
        interactionKey: legacy.interactionKey,
        controlBindings: legacy.controlBindings,
      }
    }

    return null
  }

  /**
   * Seleciona melhor ponto de montagem
   */
  private selectMountPoint(
    _targetObject: THREE.Mesh,
    mountConfig: MountConfig,
    preferredId?: string
  ): MountPoint | null {
    if (mountConfig.mountPoints.length === 0) {
      // Fallback: cria ponto único do offset padrão
      return createMountPoint('default', 'Assento', mountConfig.defaultSeatOffset)
    }

    // Se ID preferido especificado, busca ele
    if (preferredId) {
      const preferred = mountConfig.mountPoints.find(p => p.id === preferredId)
      if (preferred && preferred.playerUsable) return preferred
    }

    // Seleciona por prioridade (maior primeiro) entre usáveis pelo jogador
    const usable = mountConfig.mountPoints.filter(p => p.playerUsable)
    if (usable.length === 0) return null

    usable.sort((a, b) => b.priority - a.priority)
    return usable[0]
  }

  /**
   * Obtém bounds da montaria
   */
  private getMountBounds(root: THREE.Mesh): THREE.Box3 {
    return getColliderBounds(root) ?? new THREE.Box3().setFromObject(root)
  }

  /**
   * Reseta estado de montagem
   */
  private resetMountState(): void {
    this.state.isMounted = false
    this.state.mountedObjectId = null
    this.state.mountedObjectRoot = null
    this.state.mountPointId = null
    this.state.mountPoint = null
    this.state.mountConfig = null
    this.state.movementState = 'idle'
    this.state.airborne = false
    this.state.verticalVelocity = 0
    this.state.supportProbeElapsed = 0
    this.state.hasSupport = false
    this.state.mountVisualPivot = null
    this.state.mountVisualBaseQuaternion = null
  }

  /**
   * Obtém control bindings padrão
   */
  private getDefaultControlBindings(): MountControlBindings {
    return {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
      action1: 'KeyQ',
      action2: 'KeyR',
      action3: 'KeyF',
      action4: 'KeyC',
    }
  }

  /**
   * Limpa recursos
   */
  dispose(): void {
    if (this.state.characterController) {
      this.state.characterController.dispose()
    }
    this.state.animationMapper.dispose()
    this.resetMountState()
  }
}

/**
 * Cria MountConfig a partir de dados legados (compatibilidade)
 */
export function createMountConfigFromLegacy(legacySettings: Record<string, unknown>): MountConfig {
  const seatOffset = legacySettings.seatOffset as [number, number, number] ?? [0, 0.55, 0]
  const controlBindings = legacySettings.controlBindings as MountControlBindings ?? {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    run: 'ShiftLeft',
    jump: 'Space',
    interact: 'KeyE',
  }

  return {
    mountPoints: [
      createMountPoint('seat_0', 'Assento Principal', new THREE.Vector3(...seatOffset), { priority: 10 })
    ],
    defaultSeatOffset: new THREE.Vector3(...seatOffset),
    mountable: true,
    interactionRadius: (legacySettings.interactionRadius as number) ?? 2.5,
    interactionKey: (legacySettings.interactionKey as string) ?? 'KeyE',
    controlBindings,
  }
}