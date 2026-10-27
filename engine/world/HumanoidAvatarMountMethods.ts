import * as THREE from 'three'
import { getAnimationControllerFromObject } from './AnimationController'
import {
  getStaticMeshCollisionData,
  raycastStaticMesh,
  visitStaticMeshTriangles,
} from './StaticMeshCollider'
import {
  GRAVITY,
  JUMP_SPEED,
  MAX_EXACT_MOUNT_COLLISION_TRIANGLES,
  MAX_WALK_STEP_UP,
  PLAYER_RADIUS,
  WALKABLE_SURFACE_NORMAL_Y,
  getCircularDirectionalWeights,
  getColliderBounds,
  smoothTurnYaw,
} from './HumanoidAvatarShared'
import type { AnimationRole, MountMovementState, MountPackageSettings } from '../script/packages'

export interface HumanoidAvatarMountMethods {
  isMounted(): boolean
  getMountedObjectId(): string | null
  getMountedMovementState(): MountMovementState | null
  updateMountSettings(settings: MountPackageSettings): void
  mount(root: THREE.Mesh, settings: MountPackageSettings): boolean
  dismount(): string | null
  updateMountedPlayerTransition(dt: number): void
  playMountAnimation(root: THREE.Mesh, role: AnimationRole, oneShot?: boolean): void
  updateMountedMovement(
    dt: number,
    forwardInput: number,
    sideInput: number,
    running: boolean,
    walkingSlow: boolean,
  ): void
}

/** Mantém o fluxo de montaria e seus testes físicos fora da classe de avatar principal. */
export function createHumanoidAvatarMountMethods(): HumanoidAvatarMountMethods {
  return {
    isMounted(this: any): boolean {
      return this.mountedRoot !== null
    },

    getMountedObjectId(this: any): string | null {
      const id = this.mountedRoot?.userData.id
      return typeof id === 'string' ? id : null
    },

    getMountedMovementState(this: any): MountMovementState | null {
      return this.mountedRoot ? this.mountedMovementState : null
    },

    /** Aplica alterações de configuração do pacote enquanto o jogador já está montado. */
    updateMountSettings(this: any, settings: MountPackageSettings): void {
      if (!this.mountedRoot) return
      this.mountSettings = {
        interactionKey: settings.interactionKey,
        seatOffset: [...settings.seatOffset],
        speed: settings.speed,
        runMultiplier: settings.runMultiplier,
        interactionRadius: settings.interactionRadius,
        modelStates: settings.modelStates.map(rule => ({ ...rule })),
        controlBindings: { ...settings.controlBindings },
      }
    },

    /** Vincula o avatar a qualquer objeto que tenha recebido o pacote Montaria. */
    mount(this: any, root: THREE.Mesh, settings: MountPackageSettings): boolean {
      if (!this.enabled || this.mountedRoot || !root.visible) return false

      this.mountedRoot = root
      // A física mantém a raiz/colisor nivelados. Somente o pivô visual do GLB
      // pode inclinar para acompanhar o plano da rampa sem girar a caixa física.
      this.mountedVisualPivot = root.getObjectByName('ImportedVisualPivot') ?? null
      this.mountedVisualBaseQuaternion = this.mountedVisualPivot?.quaternion.clone() ?? null
      // O controle montado passa a ser o dono exclusivo do movimento/colisão horizontal.
      root.userData.mountCollisionManaged = true
      this.mountedStartPosition = root.position.clone()
      this.mountedStartRotation = root.rotation.clone()
      this.mountedMovementState = 'idle'
      this.mountedJumpRequested = false
      this.mountedAirborne = false
      this.mountedVerticalVelocity = 0
      this.mountedSupportProbeElapsed = 1
      this.mountedHasSupportProbe = false
      this.mountedLastSupportProbePosition.copy(root.position)
      this.mountSettings = {
        interactionKey: settings.interactionKey,
        seatOffset: [...settings.seatOffset],
        speed: settings.speed,
        runMultiplier: settings.runMultiplier,
        interactionRadius: settings.interactionRadius,
        modelStates: settings.modelStates.map(rule => ({ ...rule })),
        controlBindings: { ...settings.controlBindings },
      }
      // Ambos os modelos iniciam o papel "mount" no mesmo evento do pacote.
      // O jogador fica visível durante o clipe próprio e some ao concluir a transição.
      this.visualRoot.visible = true
      this.placeAvatarAtMountSeat()
      if (this.animationActions.has('mount')) {
        this.playerMountTransition = 'mount'
        this.playAnimation('mount', true)
      } else {
        this.playerMountTransition = null
        this.visualRoot.visible = false
      }
      this.playMountAnimation(root, 'mount', true)
      if (!root.userData.importAnimationActions ||
          !(root.userData.importAnimationActions as Partial<Record<AnimationRole, THREE.AnimationAction>>).mount) {
        this.playMountAnimation(root, 'idle')
      }
      this.verticalVelocity = 0
      this.grounded = true
      this.activeCollisions.clear()
      this.pressed.clear()
      return true
    },

    updateMountedPlayerTransition(this: any, dt: number): void {
      if (!this.animationController || !this.playerMountTransition) return
      this.animationController.update(dt)
      if (this.animationController.isOneShotPlaying &&
          this.animationController.activeOneShotRole === this.playerMountTransition) return
      this.playerMountTransition = null
      this.visualRoot.visible = false
    },

    /** Desvincula o jogador e o posiciona junto ao lado livre da montaria. */
    dismount(this: any): string | null {
      const root = this.mountedRoot
      if (!root) return null

      const rootId = typeof root.userData.id === 'string' ? root.userData.id : null
      const positionChanged = this.mountedStartPosition
        ? root.position.distanceToSquared(this.mountedStartPosition) > 1e-6
        : false
      const rotationChanged = this.mountedStartRotation
        ? Math.abs(root.rotation.x - this.mountedStartRotation.x) > 1e-4 ||
          Math.abs(root.rotation.y - this.mountedStartRotation.y) > 1e-4 ||
          Math.abs(root.rotation.z - this.mountedStartRotation.z) > 1e-4
        : false
      root.updateWorldMatrix(true, true)
      this.playMountAnimation(root, 'dismount', true)
      if (this.mountedVisualPivot && this.mountedVisualBaseQuaternion) {
        this.mountedVisualPivot.quaternion.copy(this.mountedVisualBaseQuaternion)
        this.mountedVisualPivot.updateMatrixWorld(true)
      }
      this.mountedVisualPivot = null
      this.mountedVisualBaseQuaternion = null
      root.userData.mountCollisionManaged = false

      const bounds = getColliderBounds(root) ?? new THREE.Box3().setFromObject(root)
      const halfWidth = Math.max(0.45, bounds.getSize(new THREE.Vector3()).x * 0.5)
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion).setY(0).normalize()
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
      const dismountDistance = halfWidth + this.getPlayerRadius() + 0.4 * this.getBodyScale()
      const forward = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(root.quaternion)
        .setY(0)
        .normalize()
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1)
      const candidates = [
        root.position.clone().addScaledVector(side, dismountDistance),
        root.position.clone().addScaledVector(side, -dismountDistance),
        root.position.clone().addScaledVector(forward, dismountDistance),
        root.position.clone().addScaledVector(forward, -dismountDistance),
        root.position.clone().addScaledVector(side, dismountDistance * 0.72).addScaledVector(forward, dismountDistance * 0.72),
        root.position.clone().addScaledVector(side, dismountDistance * 0.72).addScaledVector(forward, -dismountDistance * 0.72),
        root.position.clone().addScaledVector(side, -dismountDistance * 0.72).addScaledVector(forward, dismountDistance * 0.72),
        root.position.clone().addScaledVector(side, -dismountDistance * 0.72).addScaledVector(forward, -dismountDistance * 0.72),
      ]

      this.mountedRoot = null
      this.mountSettings = null
      this.mountedMovementState = 'idle'
      this.mountedJumpRequested = false
      this.mountedAirborne = false
      this.mountedVerticalVelocity = 0
      this.mountedStartPosition = null
      this.mountedStartRotation = null
      this.visualRoot.visible = true
      this.playerMountTransition = null
      this.pressed.clear()
      let placed = false

      const mountFeetY = bounds.min.y
      let placedSupportY: number | null = null
      for (const candidate of candidates) {
        const x = THREE.MathUtils.clamp(candidate.x, -49, 49)
        const z = THREE.MathUtils.clamp(candidate.z, -49, 49)
        const supportY = this.findDismountSupportY(x, z, mountFeetY, root)
        if (supportY === null) continue

        // Se o candidato está além da borda, não teleporta o jogador para o chão
        // vários metros abaixo: deixa-o sair lateralmente e cair com a gravidade.
        const hasNearbyFloor = supportY >= mountFeetY - 0.65
        this.mesh.position.set(x, (hasNearbyFloor ? supportY : mountFeetY) + 0.025, z)
        this.mesh.updateMatrixWorld(true)
        if (!this.collidesWithObjects()) {
          placed = true
          placedSupportY = hasNearbyFloor ? supportY : null
          break
        }
      }

      // Em plataformas estreitas, tenta pontos laterais adicionais antes de usar
      // um fallback, evitando colocar o avatar sob a plataforma por erro de altura.
      if (!placed) {
        const radius = dismountDistance + 0.45
        for (let index = 0; index < 12; index += 1) {
          const angle = (Math.PI * 2 * index) / 12
          const x = THREE.MathUtils.clamp(root.position.x + Math.cos(angle) * radius, -49, 49)
          const z = THREE.MathUtils.clamp(root.position.z + Math.sin(angle) * radius, -49, 49)
          const supportY = this.findDismountSupportY(x, z, mountFeetY, root)
          if (supportY === null) continue
          const hasNearbyFloor = supportY >= mountFeetY - 0.65
          this.mesh.position.set(x, (hasNearbyFloor ? supportY : mountFeetY) + 0.025, z)
          this.mesh.updateMatrixWorld(true)
          if (!this.collidesWithObjects()) {
            placed = true
            placedSupportY = hasNearbyFloor ? supportY : null
            break
          }
        }
      }

      if (!placed) {
        // Último recurso: mantém a altura da montaria e permite que a física
        // resolva uma eventual queda. Não posiciona o jogador diretamente sob ela.
        const x = THREE.MathUtils.clamp(root.position.x + dismountDistance, -49, 49)
        const z = THREE.MathUtils.clamp(root.position.z, -49, 49)
        this.mesh.position.set(x, mountFeetY + 0.025, z)
        this.mesh.updateMatrixWorld(true)
        placedSupportY = null
      }
      this.verticalVelocity = 0
      this.grounded = placedSupportY !== null
      this.activeCollisions.clear()
      this.cameraTarget.set(this.mesh.position.x, this.mesh.position.y + 1, this.mesh.position.z)
      const hasDismountAnimation = this.animationActions.has('dismount')
      this.playAnimation(hasDismountAnimation ? 'dismount' : 'idle', hasDismountAnimation)
      // A cena só é notificada uma vez, ao sair da montaria e apenas se a
      // entidade realmente mudou de posição/rotação durante a execução.
      if (rootId && (positionChanged || rotationChanged)) this.world.notifyChanged(rootId)
      return rootId
    },

    placeAvatarAtMountSeat(this: any): void {
      const root = this.mountedRoot
      const settings = this.mountSettings
      if (!root || !settings) return
      root.updateWorldMatrix(true, true)
      const seat = root.localToWorld(new THREE.Vector3(...settings.seatOffset))
      this.mesh.position.copy(seat)
      this.mesh.updateMatrixWorld(true)
      this.cameraTarget.set(seat.x, seat.y + 0.9, seat.z)
    },

    /**
     * Obtém a superfície caminhável diretamente sob um ponto de desmontagem.
     * A altura do terreno é apenas um fallback; plataformas, rampas e objetos
     * elevados têm prioridade quando existe piso sob o candidato.
     */
    findDismountSupportY(this: any,
      x: number,
      z: number,
      referenceFeetY: number,
      ignoredRoot: THREE.Mesh,
    ): number | null {
      const terrainY = this.world.terrain.heightAt(x, z)
      let supportY: number | null = terrainY
      const originY = Math.max(referenceFeetY + this.getStandingPlayerHeight() + 2 * this.getBodyScale(), terrainY + this.getStandingPlayerHeight() + 2 * this.getBodyScale())
      const lowestAllowedY = terrainY - 0.15
      const allCandidates = this.world.list().filter(object =>
        object.mesh !== ignoredRoot &&
        object.mesh.visible &&
        object.mesh.userData.colliderType !== 'none',
      )
      const staticCandidates = allCandidates.filter(object =>
        object.mesh.userData.importedModel === true &&
        object.mesh.userData.colliderType === 'mesh' &&
        getStaticMeshCollisionData(object.mesh) !== null,
      )
      const staticMeshColliderIds = new Set(staticCandidates.map(object => object.id))
      // Se uma malha exceder o limite BVH, mantenha-a nas consultas comuns de
      // superfície em vez de removê-la do cálculo de piso e degraus.
      const candidates = allCandidates.filter(object => !staticMeshColliderIds.has(object.id))
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(x, originY, z),
        new THREE.Vector3(0, -1, 0),
        0,
        Math.max(1, originY - lowestAllowedY),
      )
      const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
      const normalMatrix = new THREE.Matrix3()

      for (const hit of hits) {
        if (!hit.face) continue
        const owner = candidates.find(object =>
          object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
        )
        if (!owner) continue
        if (owner.mesh.userData.importedModel === true && hit.object === owner.mesh) continue
        const normal = hit.face.normal.clone()
          .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize()
        if (normal.y < WALKABLE_SURFACE_NORMAL_Y) continue
        if (hit.point.y > referenceFeetY + 0.45 || hit.point.y < lowestAllowedY) continue

        if (supportY === null || hit.point.y > supportY) supportY = hit.point.y
        break
      }

      for (const object of staticCandidates) {
        const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, Math.max(1, originY - lowestAllowedY), candidate =>
          candidate.normal.y >= WALKABLE_SURFACE_NORMAL_Y &&
          candidate.point.y <= referenceFeetY + 0.45 &&
          candidate.point.y >= lowestAllowedY,
        )
        if (hit) supportY = supportY === null ? hit.point.y : Math.max(supportY, hit.point.y)
      }

      // Primitivas com colisor configurado também têm uma face superior válida
      // mesmo que o raycast visual não retorne uma interseção utilizável.
      for (const object of candidates) {
        if (object.mesh.userData.importedModel === true) continue
        const rotated = Math.abs(object.mesh.rotation.x) > 0.02 || Math.abs(object.mesh.rotation.z) > 0.02
        if (rotated) continue
        const box = getColliderBounds(object.mesh)
        if (!box || x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue
        const surfaceY = box.max.y
        if (surfaceY > referenceFeetY + 0.45 || surfaceY < lowestAllowedY) continue
        supportY = supportY === null ? surfaceY : Math.max(supportY, surfaceY)
      }

      return supportY
    },

    playMountAnimation(this: any, root: THREE.Mesh, role: AnimationRole, oneShot = false): void {
      const controller = getAnimationControllerFromObject(root)
      if (!controller) return
      if (oneShot) controller.playOneShot(role, false)
      else controller.setState(role)
      root.userData.importAnimationState = controller.currentState || role
    },

    /**
     * Inclina apenas o GLB visual para acompanhar a normal da rampa.
     * A raiz invisível permanece nivelada e continua sendo a fonte da colisão;
     * assim a inclinação visual não gira a caixa física nem altera o movimento.
     */
    updateMountedVisualSlope(this: any, root: THREE.Mesh, dt: number): void {
      const pivot = this.mountedVisualPivot
      const baseQuaternion = this.mountedVisualBaseQuaternion
      if (!pivot || !baseQuaternion) return

      let targetQuaternion = baseQuaternion.clone()

      if (!this.mountedAirborne) {
        const bounds = this.getMountedBounds(root)
        const feetY = bounds.min.y
        const size = bounds.getSize(new THREE.Vector3())
        const originY = bounds.max.y + 0.25
        const lowestY = feetY - Math.max(1.25, size.y * 0.45)
        const allCandidates = this.world.list().filter(object =>
          object.mesh !== root &&
          object.mesh.visible &&
          object.mesh.userData.colliderType !== 'none',
        )
        const staticCandidates = allCandidates.filter(object =>
          object.mesh.userData.colliderType === 'mesh' &&
          getStaticMeshCollisionData(object.mesh) !== null,
        )
        const staticIds = new Set(staticCandidates.map(object => object.id))
        const candidates = allCandidates.filter(object =>
          !staticIds.has(object.id) && object.mesh.userData.importedModel !== true,
        )
        const raycaster = new THREE.Raycaster(
          new THREE.Vector3(root.position.x, originY, root.position.z),
          new THREE.Vector3(0, -1, 0),
          0,
          Math.max(1, originY - lowestY),
        )

        const makeTilt = (worldNormal: THREE.Vector3): THREE.Quaternion => {
          // A normal em coordenadas locais remove o yaw da raiz. Uma rampa plana
          // produz identidade; uma rampa inclinada gera pitch/roll sem virar o cavalo.
          root.updateWorldMatrix(true, true)
          const inverseRootRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
          const localNormal = worldNormal.clone().applyQuaternion(inverseRootRotation).normalize()
          const tilt = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            localNormal,
          )

          // Limita apenas a inclinação visual; a altura e as colisões continuam
          // calculadas pelo movimento físico da raiz.
          const maxTilt = THREE.MathUtils.degToRad(42)
          const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(tilt.w), 0, 1))
          if (angle > maxTilt && angle > 1e-5) {
            return new THREE.Quaternion().identity().slerp(tilt, maxTilt / angle).multiply(baseQuaternion)
          }
          return tilt.multiply(baseQuaternion)
        }

        let foundSupport = false
        if (candidates.length > 0) {
          const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)
          const normalMatrix = new THREE.Matrix3()

          for (const hit of hits) {
            if (!hit.face) continue
            const owner = candidates.find(object =>
              object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
            )
            if (!owner) continue

            const worldNormal = hit.face.normal.clone()
              .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
              .normalize()
            if (worldNormal.y < 0.25) continue
            if (hit.point.y > feetY + 0.35 || hit.point.y < lowestY) continue

            targetQuaternion = makeTilt(worldNormal)
            foundSupport = true
            break
          }
        }

        if (!foundSupport && staticCandidates.length > 0) {
          let bestHit: ReturnType<typeof raycastStaticMesh> = null
          for (const object of staticCandidates) {
            const hit = raycastStaticMesh(
              object.mesh,
              raycaster.ray,
              0,
              Math.max(1, originY - lowestY),
              candidate => candidate.normal.y >= 0.25 &&
                candidate.point.y <= feetY + 0.35 &&
                candidate.point.y >= lowestY,
            )
            if (hit && (!bestHit || hit.point.y > bestHit.point.y)) bestHit = hit
          }
          if (bestHit) targetQuaternion = makeTilt(bestHit.normal)
        }
      }

      const blend = 1 - Math.exp(-10 * Math.max(0, dt))
      pivot.quaternion.slerp(targetQuaternion, blend)
      root.updateWorldMatrix(true, true)
    },

    updateMountedMovement(this: any,
      dt: number,
      forwardInput: number,
      sideInput: number,
      running: boolean,
      walkingSlow: boolean,
    ): void {
      const root = this.mountedRoot
      const settings = this.mountSettings
      if (!root || !settings) return

      const length = Math.hypot(forwardInput, sideInput)
      const movementStartX = root.position.x
      const movementStartZ = root.position.z
      this.mountedSupportProbeElapsed += dt
      const shouldJump = this.mountedJumpRequested && !this.mountedAirborne
      this.mountedJumpRequested = false
      let state: MountMovementState = 'idle'

      if (length > 0) {
        const direction = new THREE.Vector3(
          sideInput * Math.cos(this.getCameraYaw()) - forwardInput * Math.sin(this.getCameraYaw()),
          0,
          -sideInput * Math.sin(this.getCameraYaw()) - forwardInput * Math.cos(this.getCameraYaw()),
        ).normalize()
        const speed = settings.speed * (running ? settings.runMultiplier : walkingSlow ? 0.48 : 1)
        direction.multiplyScalar(speed * dt)

        const initialBounds = this.getMountedBounds(root)
        let feetY = initialBounds.min.y
        const moveAxis = (axis: 'x' | 'z', delta: number): void => {
          if (Math.abs(delta) < 1e-8) return
          const origin = root.position[axis]
          const maxSubstep = Math.min(0.08, PLAYER_RADIUS * 0.25)
          const count = Math.max(1, Math.ceil(Math.abs(delta) / maxSubstep))
          let lastSafe = origin
          let lastSafeY = root.position.y

          for (let step = 1; step <= count; step += 1) {
            root.position[axis] = THREE.MathUtils.clamp(origin + delta * step / count, -49, 49)
            root.updateWorldMatrix(true, true)

            // Ajusta a altura a cada subpasso, antes do teste lateral. Assim, a
            // montaria acompanha a subida gradual da rampa em vez de bater na sua face.
            if (!this.mountedAirborne && this.shouldRefreshMountedSupport(root, true)) {
              const supported = this.followMountedSurfaceAtStep(root, Math.abs(delta) / count)
              if (!supported) {
                // Se a montaria saiu da borda da rampa, deixa de congelar a altura:
                // inicia queda física em vez de continuar andando suspensa no ar.
                this.mountedAirborne = true
                this.mountedVerticalVelocity = 0
              }
            }

            if (!this.mountedCollidesWithObjects(root)) {
              lastSafe = root.position[axis]
              lastSafeY = root.position.y
              feetY = this.getMountedBounds(root).min.y
              continue
            }

            // Como o player, a montaria pode subir degraus baixos; faces laterais
            // bloqueiam, enquanto a face superior pode virar uma nova superfície de apoio.
            const stepSurface = this.findMountedStepUpSurface(root, feetY, axis, Math.sign(delta))
            if (stepSurface !== null) {
              const previousY = root.position.y
              const bounds = this.getMountedBounds(root)
              root.position.y += stepSurface - bounds.min.y
              root.updateWorldMatrix(true, true)
              if (!this.mountedCollidesWithObjects(root)) {
                lastSafe = root.position[axis]
                lastSafeY = root.position.y
                feetY = this.getMountedBounds(root).min.y
                continue
              }
              root.position.y = previousY
              root.updateWorldMatrix(true, true)
            }

            // Para no último ponto livre, preservando o movimento pelo outro eixo.
            root.position[axis] = lastSafe
            root.position.y = lastSafeY
            root.updateWorldMatrix(true, true)
            break
          }
        }

        moveAxis('x', direction.x)
        moveAxis('z', direction.z)
        const targetYaw = Math.atan2(direction.x, direction.z)
        root.rotation.y = smoothTurnYaw(root.rotation.y, targetYaw, dt, running ? 7.5 : 5.5)
        root.updateWorldMatrix(true, true)

        if (forwardInput !== 0 && sideInput !== 0) {
          state = running
            ? (sideInput < 0 ? 'run_diagonal_left' : 'run_diagonal_right')
            : (sideInput < 0 ? 'walk_diagonal_left' : 'walk_diagonal_right')
        } else {
          state = running ? 'run' : 'walk'
        }
      }

      // O pulo montado precisa de física própria: só tocar a animação não desloca
      // a raiz do cavalo. Velocidade vertical e gravidade mantêm o salto até aterrissar.
      if (shouldJump && !this.mountedAirborne) {
        this.mountedAirborne = true
        this.mountedVerticalVelocity = JUMP_SPEED
      }

      if (this.mountedAirborne) {
        const previousRootY = root.position.y
        const previousBounds = this.getMountedBounds(root)
        const previousFeetY = previousBounds.min.y

        root.position.y += this.mountedVerticalVelocity * dt
        root.updateWorldMatrix(true, true)

        // Bloqueia a subida ao atingir a parte inferior de um teto.
        if (this.mountedVerticalVelocity > 0 && this.mountedCollidesWithCeiling(root, previousRootY)) {
          root.position.y = previousRootY
          this.mountedVerticalVelocity = 0
          root.updateWorldMatrix(true, true)
        }

        this.mountedVerticalVelocity -= GRAVITY * dt
        const currentBounds = this.getMountedBounds(root)
        const supportY = this.findMountedGroundSurface(root, currentBounds)
        if (
          this.mountedVerticalVelocity <= 0 &&
          previousFeetY >= supportY - 0.05 &&
          currentBounds.min.y <= supportY + 0.05
        ) {
          root.position.y += supportY - currentBounds.min.y
          this.mountedVerticalVelocity = 0
          this.mountedAirborne = false
          root.updateWorldMatrix(true, true)
        }
      } else if (length === 0 && this.shouldRefreshMountedSupport(root, false)) {
        // Em repouso, o piso não precisa ser amostrado novamente a cada frame.
        // Revalidamos periodicamente e ao mover a montaria para acompanhar rampas
        // sem manter a interface ocupada com raycasts redundantes.
        const beforeGroundingY = root.position.y
        const supported = this.followMountedSurfaceAtStep(root, 0.08)
        if (!supported) {
          this.mountedAirborne = true
          this.mountedVerticalVelocity = 0
        } else if (this.mountedCollidesWithObjects(root)) {
          root.position.y = beforeGroundingY
          root.updateWorldMatrix(true, true)
        }
      }

      this.updateMountedVisualSlope(root, dt)
      this.placeAvatarAtMountSeat()
      const previousState = this.mountedMovementState
      this.mountedMovementState = state

      const animationController = getAnimationControllerFromObject(root)
      // Se o clipe de salto ainda estava tocando quando a física detectou o pouso,
      // interrompe-o imediatamente; se já acabou, o estado abaixo troca a pose final.
      if (!this.mountedAirborne && animationController?.activeOneShotRole === 'jump') {
        animationController.cancelOneShot('jump')
      }
      const canBlendMountedDirection = length > 0 && !this.mountedAirborne &&
        !!animationController && animationController.actions.size > 0 && !animationController.isOneShotPlaying
      let usedMountedDirectionalBlend = false
      if (canBlendMountedDirection && animationController) {
        const targetWeights = getCircularDirectionalWeights(
          animationController.actions, forwardInput, sideInput,
          this.getCameraYaw(), root.rotation.y, running,
        )
        if (targetWeights.size > 0) {
          const actualMountSpeed = Math.hypot(root.position.x - movementStartX, root.position.z - movementStartZ) / Math.max(dt, 1e-4)
          const nominalMountSpeed = settings.speed * (running ? settings.runMultiplier : walkingSlow ? 0.48 : 1)
          const dominantRole = animationController.setBlendWeights(
            targetWeights,
            actualMountSpeed / Math.max(0.1, nominalMountSpeed),
            String(root.userData.importAnimationState ?? state),
          )
          if (dominantRole) {
            root.userData.importAnimationState = dominantRole
            usedMountedDirectionalBlend = true
          }
        }
      }

      if (shouldJump) {
        this.playMountAnimation(root, 'jump', true)
      } else if (!usedMountedDirectionalBlend) {
        if (state === 'idle' && (previousState === 'run' || previousState === 'run_diagonal_left' || previousState === 'run_diagonal_right')) {
          this.playMountAnimation(root, 'run_stop', true)
        } else {
          this.playMountAnimation(root, state)
        }
      }
      this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.mesh.position.x, 0.2)
      this.cameraTarget.y = THREE.MathUtils.lerp(this.cameraTarget.y, this.mesh.position.y + 0.9, 0.2)
      this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.mesh.position.z, 0.2)
    },

    /**
     * Support probing is expensive: each probe raycasts the nearby scene at nine
     * positions. Reuse the last result for short intervals instead of repeating
     * those raycasts every movement micro-step and every idle frame.
     */
    shouldRefreshMountedSupport(this: any, root: THREE.Mesh, moving: boolean): boolean {
      const movedDistanceSq = this.mountedHasSupportProbe
        ? this.mountedLastSupportProbePosition.distanceToSquared(root.position)
        : Number.POSITIVE_INFINITY
      const distanceThreshold = moving ? 0.035 : 0.0025
      const timeThreshold = moving ? 0.075 : 0.25
      if (
        this.mountedHasSupportProbe &&
        movedDistanceSq < distanceThreshold &&
        this.mountedSupportProbeElapsed < timeThreshold
      ) return false

      this.mountedLastSupportProbePosition.copy(root.position)
      this.mountedHasSupportProbe = true
      this.mountedSupportProbeElapsed = 0
      return true
    },

    /** Bounds de movimento da montaria, usando o colisor configurado ou o modelo visual como fallback. */
    getMountedBounds(this: any, root: THREE.Mesh): THREE.Box3 {
      return getColliderBounds(root) ?? new THREE.Box3().setFromObject(root)
    },

    /** Cacheia a complexidade uma vez; não conte vértices novamente em cada quadro. */
    getImportedTriangleCount(this: any, root: THREE.Mesh): number {
      const cached = root.userData.mountCollisionTriangleCount
      if (typeof cached === 'number') return cached

      let triangleCount = 0
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh) || child === root) return
        if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
        const position = child.geometry.getAttribute('position')
        if (!position) return
        triangleCount += Math.floor((child.geometry.getIndex()?.count ?? position.count) / 3)
      })
      root.userData.mountCollisionTriangleCount = triangleCount
      return triangleCount
    },

    /**
     * Verifica colisão da montaria com o mesmo princípio usado pelo player:
     * colisor configurado para modelos importados e triângulos reais para colisão automática.
     */
    mountedCollidesWithObjects(this: any, root: THREE.Mesh): boolean {
      const mountBounds = getColliderBounds(root)
      if (!mountBounds || root.userData.colliderType === 'none') return false

      const triangle = new THREE.Triangle()
      const normal = new THREE.Vector3()
      const worldObjects = this.world.list()
      const collisionRoots = worldObjects.map(object => object.mesh)

      for (const obstacle of collisionRoots) {
        if (obstacle === root || !obstacle.visible || obstacle.userData.colliderType === 'none') continue
        obstacle.updateWorldMatrix(true, true)

        const configuredCollider = obstacle.userData.colliderType
        const obstacleBounds = getColliderBounds(obstacle)
        const nearRamp = obstacleBounds !== null && mountBounds.intersectsBox(obstacleBounds)
        // Só objetos cuja raiz esteja inclinada são tratados como rampas aqui.
        // Isso evita ignorar modelos comuns que por acaso tenham faces triangulares inclinadas.
        const isInclinedObject =
          Math.abs(obstacle.rotation.x) > 0.02 ||
          Math.abs(obstacle.rotation.z) > 0.02
        const rampSurfaceUnderMount = nearRamp && isInclinedObject &&
          obstacle.userData.importedModel !== true &&
          this.hasWalkableRampSurfaceBelow(obstacle, mountBounds)
        const owner = worldObjects.find(object => object.mesh === obstacle)
        const flatPlatformUnderMount = nearRamp &&
          owner?.type === 'platform' &&
          !isInclinedObject &&
          obstacle.userData.importedModel !== true &&
          this.hasConnectedFlatPlatformSurfaceBelow(obstacle, mountBounds, collisionRoots)

        // Uma face lateral que pertence à emenda de duas peças caminháveis não é
        // uma parede externa. Ignora o volume dessa peça enquanto seu topo plano
        // está sob a montaria e conectado à rampa; o suporte vertical continua
        // sendo decidido pelos raycasts de superfície.
        if (rampSurfaceUnderMount || flatPlatformUnderMount) continue

        if (obstacle.userData.importedModel === true && configuredCollider === 'mesh') {
          const staticData = getStaticMeshCollisionData(obstacle)
          if (staticData) {
            const blocked = visitStaticMeshTriangles(obstacle, mountBounds, (triangle) => {
              triangle.getNormal(normal).normalize()
              // Horizontal faces are walkable floors/ceilings; lateral and steep
              // faces are physical walls for a moving mount.
              // Superfícies caminháveis (pisos e rampas) não podem bloquear o
              // movimento horizontal; paredes e faces íngremes continuam sólidas.
              if (Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y) return false
              return mountBounds.intersectsTriangle(triangle)
            })
            if (blocked) return true
            continue
          }
        }

        if (
          obstacle.userData.importedModel === true &&
          configuredCollider !== undefined &&
          configuredCollider !== 'auto'
        ) {
          if (obstacleBounds && this.hasVolumeOverlap(mountBounds, obstacleBounds)) return true
          continue
        }

        if (
          obstacle.userData.importedModel === true &&
          configuredCollider === 'auto' &&
          this.getImportedTriangleCount(obstacle) > MAX_EXACT_MOUNT_COLLISION_TRIANGLES
        ) {
          // O colisor automático de um GLB denso não pode custar dezenas de
          // milhares de verificações de triângulos por subpasso de movimento.
          // Usa os limites físicos como fallback conservador para montarias.
          if (obstacleBounds && this.hasVolumeOverlap(mountBounds, obstacleBounds)) return true
          continue
        }

        const meshes: THREE.Mesh[] = []
        obstacle.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !child.visible) return
          if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
          if (obstacle.userData.importedModel === true && child === obstacle) return
          meshes.push(child)
        })

        for (const mesh of meshes) {
          const geometry = mesh.geometry
          const position = geometry.getAttribute('position')
          if (!position || position.count < 3) continue
          if (!geometry.boundingBox) geometry.computeBoundingBox()
          if (!geometry.boundingBox) continue

          const meshBounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
          if (!this.hasVolumeOverlap(mountBounds, meshBounds)) continue

          // Igual ao player: considera a pose atual de malhas esqueléticas, não apenas bind pose.
          if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update()
          const vertices: THREE.Vector3[] = new Array(position.count)
          for (let index = 0; index < position.count; index += 1) {
            vertices[index] = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
          }

          const geometryIndex = geometry.getIndex()
          const triangleCount = Math.floor((geometryIndex ? geometryIndex.count : position.count) / 3)
          for (let index = 0; index < triangleCount; index += 1) {
            const ia = geometryIndex ? geometryIndex.getX(index * 3) : index * 3
            const ib = geometryIndex ? geometryIndex.getX(index * 3 + 1) : index * 3 + 1
            const ic = geometryIndex ? geometryIndex.getX(index * 3 + 2) : index * 3 + 2
            const a = vertices[ia]
            const b = vertices[ib]
            const c = vertices[ic]
            if (!a || !b || !c) continue
            triangle.set(a, b, c)
            triangle.getNormal(normal).normalize()

            // Rampas reconhecidas já foram removidas do teste de obstáculo acima.
            // Nas outras primitivas, mantém a regra de ignorar apenas a face superior.
            if (obstacle.userData.importedModel !== true && Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y) continue
            if (mountBounds.intersectsTriangle(triangle)) return true
          }
        }
      }
      return false
    },

    /**
     * Detecta colisão ascendente com tetos. Usa colisores simplificados nos modelos
     * configurados manualmente e triângulos reais quando a colisão é automática.
     */
    mountedCollidesWithCeiling(this: any, root: THREE.Mesh, previousRootY: number): boolean {
      const currentBounds = this.getMountedBounds(root)
      const normal = new THREE.Vector3()
      const previousBounds = currentBounds.clone().translate(
        new THREE.Vector3(0, previousRootY - root.position.y, 0),
      )

      for (const obstacle of this.world.list().map(object => object.mesh)) {
        if (obstacle === root || !obstacle.visible || obstacle.userData.colliderType === 'none') continue
        obstacle.updateWorldMatrix(true, true)

        const configuredCollider = obstacle.userData.colliderType
        if (obstacle.userData.importedModel === true && configuredCollider === 'mesh') {
          const staticData = getStaticMeshCollisionData(obstacle)
          if (staticData) {
            const headBounds = new THREE.Box3(
              new THREE.Vector3(currentBounds.min.x, currentBounds.max.y - 0.12, currentBounds.min.z),
              new THREE.Vector3(currentBounds.max.x, currentBounds.max.y + 0.02, currentBounds.max.z),
            )
            const blocked = visitStaticMeshTriangles(obstacle, headBounds, triangle => {
              triangle.getNormal(normal).normalize()
              return Math.abs(normal.y) >= WALKABLE_SURFACE_NORMAL_Y && headBounds.intersectsTriangle(triangle)
            })
            if (blocked) return true
            continue
          }
        }

        if (
          obstacle.userData.importedModel === true &&
          (
            (configuredCollider !== undefined && configuredCollider !== 'auto' && configuredCollider !== 'mesh') ||
            (configuredCollider === 'mesh' && !getStaticMeshCollisionData(obstacle)) ||
            (configuredCollider === 'auto' && this.getImportedTriangleCount(obstacle) > MAX_EXACT_MOUNT_COLLISION_TRIANGLES)
          )
        ) {
          const box = getColliderBounds(obstacle)
          if (!box) continue
          const overlapsHorizontally = currentBounds.max.x > box.min.x && currentBounds.min.x < box.max.x &&
            currentBounds.max.z > box.min.z && currentBounds.min.z < box.max.z
          const crossesUnderside = previousBounds.max.y <= box.min.y + 0.05 &&
            currentBounds.max.y >= box.min.y - 0.02
          if (overlapsHorizontally && crossesUnderside) return true
          continue
        }

        const meshes: THREE.Mesh[] = []
        obstacle.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !child.visible) return
          if (child.userData.editorOverlay === true || child.name === 'collider-debug-wireframe') return
          if (obstacle.userData.importedModel === true && child === obstacle) return
          meshes.push(child)
        })

        for (const mesh of meshes) {
          const geometry = mesh.geometry
          const position = geometry.getAttribute('position')
          if (!position || position.count < 3) continue
          if (!geometry.boundingBox) geometry.computeBoundingBox()
          if (!geometry.boundingBox) continue
          const broadBounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)
          if (!currentBounds.intersectsBox(broadBounds)) continue

          if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update()
          const vertices: THREE.Vector3[] = new Array(position.count)
          for (let index = 0; index < position.count; index += 1) {
            vertices[index] = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
          }
          const geometryIndex = geometry.getIndex()
          const triangleCount = Math.floor((geometryIndex ? geometryIndex.count : position.count) / 3)
          const triangle = new THREE.Triangle()
          const normal = new THREE.Vector3()
          const triangleBounds = new THREE.Box3()

          for (let index = 0; index < triangleCount; index += 1) {
            const ia = geometryIndex ? geometryIndex.getX(index * 3) : index * 3
            const ib = geometryIndex ? geometryIndex.getX(index * 3 + 1) : index * 3 + 1
            const ic = geometryIndex ? geometryIndex.getX(index * 3 + 2) : index * 3 + 2
            const a = vertices[ia]
            const b = vertices[ib]
            const c = vertices[ic]
            if (!a || !b || !c) continue
            triangle.set(a, b, c)
            triangle.getNormal(normal).normalize()
            if (normal.y >= -0.45) continue
            triangleBounds.setFromPoints([a, b, c])
            if (!currentBounds.intersectsBox(triangleBounds) || !currentBounds.intersectsTriangle(triangle)) continue
            if (previousBounds.max.y <= triangleBounds.max.y + 0.05) return true
          }
        }
      }
      return false
    },

    /**
     * Detecta uma superfície alcançável na borda dianteira do colisor.
     * Consultar somente o centro falha em rampas compridas: a lateral da rampa
     * colide com a montaria antes de o centro chegar à superfície inclinada.
     */
    findMountedStepUpSurface(this: any,
      root: THREE.Mesh,
      feetY: number,
      axis: 'x' | 'z',
      direction: number,
    ): number | null {
      const bounds = this.getMountedBounds(root)
      const size = bounds.getSize(new THREE.Vector3())
      const height = Math.max(0.5, size.y)
      const sign = direction < 0 ? -1 : 1
      const leading = axis === 'x'
        ? (sign > 0 ? bounds.max.x : bounds.min.x)
        : (sign > 0 ? bounds.max.z : bounds.min.z)
      const lateralCenter = axis === 'x'
        ? (bounds.min.z + bounds.max.z) * 0.5
        : (bounds.min.x + bounds.max.x) * 0.5
      const lateralHalf = (axis === 'x' ? size.z : size.x) * 0.42
      const lateralSamples = [
        lateralCenter - lateralHalf,
        lateralCenter - lateralHalf * 0.5,
        lateralCenter,
        lateralCenter + lateralHalf * 0.5,
        lateralCenter + lateralHalf,
      ]
      const allCandidates = this.world.list().filter(object =>
        object.mesh !== root &&
        object.mesh.visible &&
        object.mesh.userData.colliderType !== 'none',
      )
      const staticCandidates = allCandidates.filter(object =>
        object.mesh.userData.colliderType === 'mesh' &&
        getStaticMeshCollisionData(object.mesh) !== null,
      )
      const staticIds = new Set(staticCandidates.map(object => object.id))
      const candidates = allCandidates.filter(object =>
        !staticIds.has(object.id) && object.mesh.userData.importedModel !== true,
      )
      const originY = feetY + height + 0.65
      const raycaster = new THREE.Raycaster()
      raycaster.ray.direction.set(0, -1, 0)
      let bestSurface: number | null = null

      for (const lateral of lateralSamples) {
        const probe = axis === 'x'
          ? new THREE.Vector3(leading + sign * 0.04, originY, lateral)
          : new THREE.Vector3(lateral, originY, leading + sign * 0.04)
        raycaster.ray.origin.copy(probe)
        raycaster.near = 0
        raycaster.far = height + 1.15
        const hits = raycaster.intersectObjects(candidates.map(object => object.mesh), true)

        for (const hit of hits) {
          if (!hit.face) continue
          const owner = candidates.find(object =>
            object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
          )
          if (!owner) continue
          const normal = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (normal.y < WALKABLE_SURFACE_NORMAL_Y) continue

          const rise = hit.point.y - feetY
          if (rise < -0.12 || rise > MAX_WALK_STEP_UP) continue
          if (bestSurface === null || hit.point.y > bestSurface) bestSurface = hit.point.y
          break
        }

        for (const object of staticCandidates) {
          const hit = raycastStaticMesh(object.mesh, raycaster.ray, 0, height + 1.15, candidate => {
            const rise = candidate.point.y - feetY
            return candidate.normal.y >= WALKABLE_SURFACE_NORMAL_Y && rise >= -0.12 && rise <= MAX_WALK_STEP_UP
          })
          if (hit && (bestSurface === null || hit.point.y > bestSurface)) bestSurface = hit.point.y
        }
      }
      return bestSurface
    },

    /**
     * Obtém o piso sob toda a pegada da montaria, não apenas sob o centro.
     * Isso permite apoiar a parte dianteira numa rampa antes que o centro chegue
     * nela, evitando que a caixa grande da montaria fique presa na parede inicial.
     */
    /**
     * Amostra a superfície sob vários pontos da pegada da montaria.
     * Faces inclinadas são agrupadas separadamente para que o ponto mais baixo
     * da pegada acompanhe a descida da rampa em vez de manter o corpo suspenso
     * na altura do lado mais alto.
     */
    sampleMountedSupportSurfaces(this: any,
      root: THREE.Mesh,
      bounds: THREE.Box3,
      maxFlatDrop: number,
      maxSlopeDrop: number,
      maxRise: number,
      originY: number,
    ): { flat: number[]; inclined: number[]; terrain: number[] } {
      const feetY = bounds.min.y
      const size = bounds.getSize(new THREE.Vector3())
      const centerX = (bounds.min.x + bounds.max.x) * 0.5
      const centerZ = (bounds.min.z + bounds.max.z) * 0.5
      const insetX = Math.max(0.05, size.x * 0.3)
      const insetZ = Math.max(0.05, size.z * 0.3)
      const probes: Array<[number, number]> = [
        [centerX, centerZ],
        [centerX - insetX, centerZ],
        [centerX + insetX, centerZ],
        [centerX, centerZ - insetZ],
        [centerX, centerZ + insetZ],
        [centerX - insetX, centerZ - insetZ],
        [centerX - insetX, centerZ + insetZ],
        [centerX + insetX, centerZ - insetZ],
        [centerX + insetX, centerZ + insetZ],
      ]

      const flat: number[] = []
      const inclined: number[] = []
      const terrain: number[] = []

      for (const [x, z] of probes) {
        const terrainY = this.world.terrain.heightAt(x, z)
        const terrainRise = terrainY - feetY
        if (terrainRise <= maxRise && terrainRise >= -maxFlatDrop) terrain.push(terrainY)
      }

      const minProbeX = centerX - insetX
      const maxProbeX = centerX + insetX
      const minProbeZ = centerZ - insetZ
      const maxProbeZ = centerZ + insetZ
      const allCandidates = this.world.list().filter(object =>
        object.mesh !== root &&
        object.mesh.visible &&
        object.mesh.userData.colliderType !== 'none',
      )
      // La cidade/terreno estático usa raycast BVH em vez de atravessar cada
      // mesh filho em cada ponto de apoio da montaria.
      const staticCandidates = allCandidates.filter(object =>
        object.mesh.userData.colliderType === 'mesh' &&
        getStaticMeshCollisionData(object.mesh) !== null,
      )
      const staticIds = new Set(staticCandidates.map(object => object.id))
      const candidates = allCandidates.filter(object => {
        if (staticIds.has(object.id) || object.mesh.userData.importedModel === true) return false
        object.mesh.updateWorldMatrix(true, true)
        const box = getColliderBounds(object.mesh) ?? new THREE.Box3().setFromObject(object.mesh)
        return box.max.x >= minProbeX - 0.02 && box.min.x <= maxProbeX + 0.02 &&
          box.max.z >= minProbeZ - 0.02 && box.min.z <= maxProbeZ + 0.02 &&
          box.max.y >= feetY - maxSlopeDrop && box.min.y <= originY
      })
      if (candidates.length === 0 && staticCandidates.length === 0) return { flat, inclined, terrain }

      const raycaster = new THREE.Raycaster()
      raycaster.ray.direction.set(0, -1, 0)
      raycaster.near = 0
      raycaster.far = Math.max(1, originY - (feetY - maxSlopeDrop))
      const objects = candidates.map(object => object.mesh)
      const normalMatrix = new THREE.Matrix3()

      for (const [x, z] of probes) {
        raycaster.ray.origin.set(x, originY, z)
        const hits = raycaster.intersectObjects(objects, true)

        for (const hit of hits) {
          if (!hit.face) continue
          const owner = candidates.find(object =>
            object.mesh === hit.object || object.mesh.getObjectById(hit.object.id),
          )
          if (!owner) continue

          const normal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (normal.y < 0.12) continue

          const isInclinedSurface = normal.y < 0.9995
          // Projeta a amostra inclinada para o centro da pegada: usar o ponto
          // mais baixo de uma rampa longa deixaria a montaria suspensa pelo outro lado.
          const surfaceY = isInclinedSurface && normal.y > 1e-4
            ? hit.point.y - (
              normal.x * (centerX - hit.point.x) +
              normal.z * (centerZ - hit.point.z)
            ) / normal.y
            : hit.point.y
          const rise = surfaceY - feetY
          if (rise > maxRise) continue
          if (rise < -maxFlatDrop && !(isInclinedSurface && rise >= -maxSlopeDrop)) continue

          if (isInclinedSurface) inclined.push(surfaceY)
          else flat.push(surfaceY)
          break
        }

        for (const object of staticCandidates) {
          const hit = raycastStaticMesh(
            object.mesh,
            raycaster.ray,
            raycaster.near,
            raycaster.far,
            candidate => {
              if (candidate.normal.y < 0.12) return false
              const isInclinedSurface = candidate.normal.y < 0.9995
              const surfaceY = isInclinedSurface && candidate.normal.y > 1e-4
                ? candidate.point.y - (
                  candidate.normal.x * (centerX - candidate.point.x) +
                  candidate.normal.z * (centerZ - candidate.point.z)
                ) / candidate.normal.y
                : candidate.point.y
              const rise = surfaceY - feetY
              return rise <= maxRise &&
                (rise >= -maxFlatDrop || (isInclinedSurface && rise >= -maxSlopeDrop))
            },
          )
          if (!hit) continue
          const normal = hit.normal
          const isInclinedSurface = normal.y < 0.9995
          const surfaceY = isInclinedSurface && normal.y > 1e-4
            ? hit.point.y - (
              normal.x * (centerX - hit.point.x) +
              normal.z * (centerZ - hit.point.z)
            ) / normal.y
            : hit.point.y
          if (isInclinedSurface) inclined.push(surfaceY)
          else flat.push(surfaceY)
        }
      }

      return { flat, inclined, terrain }
    },

    chooseMountedSupportSurface(this: any,
      surfaces: { flat: number[]; inclined: number[]; terrain: number[] },
      feetY: number,
      maxRise: number,
      followGroundedMovement = false,
    ): number | null {
      // Durante a caminhada, se dois níveis baixos estão sob a pegada, acompanha
      // o mais baixo para descer degraus; ao aterrissar após um salto, prioriza
      // o mais alto para não atravessar uma plataforma.
      const nearFlat = surfaces.flat.filter(y => y >= feetY - 0.28 && y <= feetY + maxRise)
      if (nearFlat.length > 0) {
        return followGroundedMovement ? Math.min(...nearFlat) : Math.max(...nearFlat)
      }

      // As alturas inclinadas já foram projetadas para o centro. A mediana
      // ignora amostras discrepantes em emendas entre segmentos da rampa.
      if (surfaces.inclined.length > 0) {
        const centerHeights = [...surfaces.inclined].sort((a, b) => a - b)
        return centerHeights[Math.floor((centerHeights.length - 1) / 2)] ?? null
      }
      if (surfaces.flat.length > 0) return Math.max(...surfaces.flat)

      if (surfaces.terrain.length > 0) {
        const terrainMin = Math.min(...surfaces.terrain)
        const terrainMax = Math.max(...surfaces.terrain)
        if (terrainMax - terrainMin > 0.12) return terrainMin
        const nearTerrain = surfaces.terrain.filter(y => y >= feetY - 0.28 && y <= feetY + maxRise)
        if (nearTerrain.length > 0) return Math.max(...nearTerrain)
        return terrainMax
      }
      return null
    },

    findMountedGroundSurface(this: any, root: THREE.Mesh, bounds: THREE.Box3): number {
      const feetY = bounds.min.y
      const terrainY = this.world.terrain.heightAt(root.position.x, root.position.z)
      const size = bounds.getSize(new THREE.Vector3())
      const maxRise = 0.55
      const maxFlatDrop = Math.max(0.75, size.y * 0.35)
      const maxSlopeDrop = Math.max(1.25, size.y * 0.4)
      const originY = Math.max(bounds.max.y + 1, feetY + size.y + 1, terrainY + size.y + 2)
      const surfaces = this.sampleMountedSupportSurfaces(
        root, bounds, maxFlatDrop, maxSlopeDrop, maxRise, originY,
      )
      return this.chooseMountedSupportSurface(surfaces, feetY, maxRise) ?? terrainY
    },

    /**
     * Detecta uma plataforma plana na junção inferior/superior de uma rampa.
     * Quando o topo já está sob a pegada, sua parede lateral é uma face interna
     * da transição e não deve bloquear o cruzamento. A tolerância para baixo é
     * ampliada somente quando uma rampa adjacente também sustenta a montaria.
     */
    hasConnectedFlatPlatformSurfaceBelow(this: any,
      platform: THREE.Mesh,
      mountBounds: THREE.Box3,
      collisionRoots: THREE.Mesh[],
    ): boolean {
      const platformBounds = getColliderBounds(platform) ?? new THREE.Box3().setFromObject(platform)
      if (!mountBounds.intersectsBox(platformBounds)) return false

      const size = mountBounds.getSize(new THREE.Vector3())
      const centerX = (mountBounds.min.x + mountBounds.max.x) * 0.5
      const centerZ = (mountBounds.min.z + mountBounds.max.z) * 0.5
      const insetX = size.x * 0.38
      const insetZ = size.z * 0.38
      const probes: Array<[number, number]> = [
        [centerX, centerZ],
        [centerX - insetX, centerZ],
        [centerX + insetX, centerZ],
        [centerX, centerZ - insetZ],
        [centerX, centerZ + insetZ],
        [centerX - insetX, centerZ - insetZ],
        [centerX - insetX, centerZ + insetZ],
        [centerX + insetX, centerZ - insetZ],
        [centerX + insetX, centerZ + insetZ],
      ]

      const feetY = mountBounds.min.y
      const nearSupportDrop = 0.35
      const transitionDrop = Math.max(0.45, Math.min(1.25, Math.max(size.x, size.z) * 0.6))
      const originY = mountBounds.max.y + 0.25
      const lowestY = feetY - transitionDrop
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(centerX, originY, centerZ),
        new THREE.Vector3(0, -1, 0),
        0,
        Math.max(1, originY - lowestY),
      )
      const normalMatrix = new THREE.Matrix3()
      let surfaceY: number | null = null

      for (const [x, z] of probes) {
        raycaster.ray.origin.set(x, originY, z)
        const hits = raycaster.intersectObject(platform, true)
        for (const hit of hits) {
          if (!hit.face) continue
          const faceNormal = hit.face.normal.clone()
            .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          if (faceNormal.y < 0.9995) continue
          if (hit.point.y < lowestY || hit.point.y > feetY + 0.35) continue
          surfaceY = hit.point.y
          break
        }
        if (surfaceY !== null) break
      }

      if (surfaceY === null) return false
      // Se a superfície está praticamente na altura dos pés, ela já é o piso atual.
      if (surfaceY >= feetY - nearSupportDrop) return true

      // Para um degrau mais baixo, só remove a parede quando a plataforma faz
      // parte da mesma junção e uma face inclinada caminhável segue sob a pegada.
      for (const ramp of collisionRoots) {
        if (
          ramp === platform ||
          !ramp.visible ||
          ramp.userData.colliderType === 'none' ||
          ramp.userData.importedModel === true
        ) continue
        if (Math.abs(ramp.rotation.x) <= 0.02 && Math.abs(ramp.rotation.z) <= 0.02) continue

        const rampBounds = getColliderBounds(ramp) ?? new THREE.Box3().setFromObject(ramp)
        if (!rampBounds.clone().expandByScalar(0.15).intersectsBox(platformBounds)) continue
        if (this.hasWalkableRampSurfaceBelow(ramp, mountBounds)) return true
      }

      return false
    },

    /**
     * Confirma que uma rampa inclinada tem uma face superior caminhável logo sob
     * a área da montaria. Só então as faces laterais daquele prisma deixam de ser
     * consideradas paredes; lados expostos continuam bloqueando normalmente.
     */
    hasWalkableRampSurfaceBelow(this: any, obstacle: THREE.Mesh, mountBounds: THREE.Box3): boolean {
      obstacle.updateWorldMatrix(true, true)
      const size = mountBounds.getSize(new THREE.Vector3())
      const centerX = (mountBounds.min.x + mountBounds.max.x) * 0.5
      const centerZ = (mountBounds.min.z + mountBounds.max.z) * 0.5
      const insetX = size.x * 0.38
      const insetZ = size.z * 0.38
      const probes: Array<[number, number]> = [
        [centerX, centerZ],
        [centerX - insetX, centerZ],
        [centerX + insetX, centerZ],
        [centerX, centerZ - insetZ],
        [centerX, centerZ + insetZ],
        [centerX - insetX, centerZ - insetZ],
        [centerX - insetX, centerZ + insetZ],
        [centerX + insetX, centerZ - insetZ],
        [centerX + insetX, centerZ + insetZ],
      ]
      const obstacleBounds = getColliderBounds(obstacle) ?? new THREE.Box3().setFromObject(obstacle)
      const originY = mountBounds.max.y + 0.5
      // Na entrada da rampa, a superfície pode estar bem abaixo do colisor.
      const lowestAllowedY = Math.min(mountBounds.min.y - 0.2, obstacleBounds.min.y - 0.05)
      const raycaster = new THREE.Raycaster()
      raycaster.ray.direction.set(0, -1, 0)
      raycaster.near = 0
      raycaster.far = Math.max(1, originY - lowestAllowedY)
      const rampUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(obstacle.getWorldQuaternion(new THREE.Quaternion()))
        .normalize()

      for (const [x, z] of probes) {
        raycaster.ray.origin.set(x, originY, z)
        const hits = raycaster.intersectObject(obstacle, true)
        for (const hit of hits) {
          if (!hit.face) continue
          const normal = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          const topAlignment = normal.dot(rampUp)
          // Distingue a face superior de laterais inclinadas pela rotação do objeto.
          if (topAlignment < 0.45 || normal.y < 0.02 || normal.y > 0.99999) continue
          if (hit.point.y < lowestAllowedY || hit.point.y > mountBounds.max.y + 0.05) continue
          return true
        }
      }
      return false
    },

    /**
     * Segue o piso sob o centro a cada subpasso de movimento. A tolerância vertical
     * acompanha inclinações contínuas sem transformar paredes em degraus.
     */
    /**
     * Segue o piso sob o centro a cada subpasso de movimento. A descida de uma
     * rampa pode ficar bem abaixo da altura antiga do cavalo se o frame anterior
     * perdeu a face inclinada; nesse caso, aceita a própria face de rampa como apoio.
     * Retorna false apenas quando não encontra suporte alcançável, para ativar a queda.
     */
    followMountedSurfaceAtStep(this: any, root: THREE.Mesh, horizontalStep: number): boolean {
      const bounds = this.getMountedBounds(root)
      const bottomOffset = root.position.y - bounds.min.y
      const feetY = bounds.min.y
      const maxRise = Math.max(0.16, horizontalStep * 3.5)
      const maxFlatDrop = Math.max(0.28, horizontalStep * 4)
      const maxSlopeDrop = Math.max(1.25, maxFlatDrop)
      const size = bounds.getSize(new THREE.Vector3())
      const originY = Math.max(bounds.max.y + 0.25, feetY + size.y + 0.25, feetY + maxRise + 0.25)
      const surfaces = this.sampleMountedSupportSurfaces(
        root, bounds, maxFlatDrop, maxSlopeDrop, maxRise, originY,
      )
      const supportY = this.chooseMountedSupportSurface(surfaces, feetY, maxRise, true)
      if (supportY === null) return false

      const riseFromFeet = supportY - feetY
      if (riseFromFeet < -maxSlopeDrop || riseFromFeet > maxRise) return false

      root.position.y = supportY + bottomOffset
      root.updateWorldMatrix(true, true)
      return true
    },

  }
}
