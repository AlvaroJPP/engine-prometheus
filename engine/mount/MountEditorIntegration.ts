import * as THREE from 'three'
import type { MountPoint, MountConfig } from './MountPoint.ts'
import { createDefaultMountConfig as createDefaultMountConfigFromPoint } from './MountPoint.ts'

/**
 * Helper visual para MountPoint no Editor
 * Mostra gizmos de assento, permite edição visual
 */
export class MountPointGizmo {
  private readonly mountPoint: MountPoint
  private readonly objectRoot: THREE.Mesh
  private gizmoGroup: THREE.Group | null = null
  private seatMarker: THREE.Mesh | null = null
  private directionArrow: THREE.ArrowHelper | null = null
  private labelSprite: THREE.Sprite | null = null
  private isSelected: boolean = false
  private isHovered: boolean = false

  // Callbacks
  public onSelect?: (mountPoint: MountPoint) => void
  public onDrag?: (mountPoint: MountPoint, newLocalOffset: THREE.Vector3) => void
  public onDelete?: (mountPoint: MountPoint) => void

  constructor(mountPoint: MountPoint, objectRoot: THREE.Mesh) {
    this.mountPoint = mountPoint
    this.objectRoot = objectRoot
    this.createGizmo()
  }

  private createGizmo(): void {
    this.gizmoGroup = new THREE.Group()
    this.gizmoGroup.name = `MountPointGizmo_${this.mountPoint.id}`
    this.gizmoGroup.userData.mountPointId = this.mountPoint.id
    this.gizmoGroup.userData.isMountPointGizmo = true

    // Marcador de assento (cilindro achatado)
    const seatGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16)
    const seatMaterial = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.seatMarker = new THREE.Mesh(seatGeometry, seatMaterial)
    this.seatMarker.name = 'SeatMarker'
    this.seatMarker.renderOrder = 999
    this.gizmoGroup.add(this.seatMarker)

    // Seta de direção (para onde o jogador olha)
    this.directionArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0.1, 0),
      0.8,
      0xffff00,
      0.15,
      0.08
    )
    this.directionArrow.name = 'DirectionArrow'
    this.directionArrow.renderOrder = 999
    this.gizmoGroup.add(this.directionArrow)

    // Label com nome
    this.createLabel()

    // Posiciona no offset local
    this.updatePosition()

    // Adiciona à cena (pai do objeto para transformar junto)
    this.objectRoot.add(this.gizmoGroup)
  }

  private createLabel(): void {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = 256
    canvas.height = 64
    context.font = 'bold 24px Arial'
    context.fillStyle = '#ffffff'
    context.strokeStyle = '#000000'
    context.lineWidth = 4
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.strokeText(this.mountPoint.label, 128, 32)
    context.fillText(this.mountPoint.label, 128, 32)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: false,
    })
    this.labelSprite = new THREE.Sprite(spriteMaterial)
    this.labelSprite.name = 'Label'
    this.labelSprite.scale.set(2, 0.5, 1)
    this.labelSprite.position.set(0, 0.7, 0)
    this.labelSprite.renderOrder = 1000
    this.gizmoGroup!.add(this.labelSprite)
  }

  /**
   * Atualiza posição do gizmo baseada no offset local
   */
  updatePosition(): void {
    if (!this.gizmoGroup) return

    // O gizmo é filho do objectRoot, então posição local = offset local
    this.gizmoGroup.position.copy(this.mountPoint.localOffset)

    // Aplica rotação local se definida
    if (this.mountPoint.localRotation) {
      this.gizmoGroup.rotation.copy(this.mountPoint.localRotation)
    } else {
      this.gizmoGroup.rotation.set(0, 0, 0)
    }

    this.gizmoGroup.updateMatrixWorld(true)
  }

  /**
   * Define offset local (chamado durante drag)
   */
  setLocalOffset(offset: THREE.Vector3): void {
    this.mountPoint.localOffset.copy(offset)
    this.updatePosition()
    this.onDrag?.(this.mountPoint, offset.clone())
  }

  /**
   * Obtém posição mundial do ponto de montagem
   */
  getWorldPosition(): THREE.Vector3 {
    const pos = new THREE.Vector3()
    if (this.gizmoGroup) {
      this.gizmoGroup.getWorldPosition(pos)
    }
    return pos
  }

  /**
   * Define estado de seleção
   */
  setSelected(selected: boolean): void {
    this.isSelected = selected
    this.updateAppearance()
  }

  /**
   * Define estado de hover
   */
  setHovered(hovered: boolean): void {
    this.isHovered = hovered
    this.updateAppearance()
  }

  private updateAppearance(): void {
    if (!this.seatMarker || !this.directionArrow || !this.labelSprite) return

    const material = this.seatMarker.material as THREE.MeshBasicMaterial

    if (this.isSelected) {
      material.color.setHex(0xff8800)
      material.opacity = 0.9
      this.directionArrow.setColor(0xff8800)
      this.labelSprite.scale.set(2.5, 0.6, 1)
    } else if (this.isHovered) {
      material.color.setHex(0x88ccff)
      material.opacity = 0.8
      this.directionArrow.setColor(0xffffff)
      this.labelSprite.scale.set(2.2, 0.55, 1)
    } else {
      material.color.setHex(0x4488ff)
      material.opacity = 0.6
      this.directionArrow.setColor(0xffff00)
      this.labelSprite.scale.set(2, 0.5, 1)
    }

    // Tags de capacidade - mostra ícones pequenos
    this.updateCapacityTags()
  }

  private updateCapacityTags(): void {
    // Remove tags antigas
    const oldTags = this.gizmoGroup!.children.filter(c => c.name === 'CapacityTag')
    for (const tag of oldTags) {
      this.gizmoGroup!.remove(tag)
      if (tag instanceof THREE.Sprite) tag.material.dispose()
      if (tag instanceof THREE.Mesh) tag.geometry?.dispose()
    }

    // Adiciona tags de capacidade
    const tagLabels: Record<string, string> = {
      driver: '👑',
      passenger: '👤',
      gunner: '🔫',
      commander: '⭐',
    }

    this.mountPoint.capacityTags.forEach((tag, index) => {
      const label = tagLabels[tag] ?? tag
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = 48
      canvas.height = 48
      ctx.font = '32px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 24, 28)

      const texture = new THREE.CanvasTexture(canvas)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: false,
      }))
      sprite.name = 'CapacityTag'
      sprite.scale.set(0.5, 0.5, 1)
      sprite.position.set(
        (index - (this.mountPoint.capacityTags.length - 1) / 2) * 0.6,
        -0.5,
        0
      )
      sprite.renderOrder = 1001
      this.gizmoGroup!.add(sprite)
    })
  }

  /**
   * Manipula clique no gizmo
   */
  handleClick(raycaster: THREE.Raycaster, _camera: THREE.Camera): boolean {
    if (!this.gizmoGroup) return false

    const intersects = raycaster.intersectObject(this.gizmoGroup, true)
    if (intersects.length > 0) {
      this.onSelect?.(this.mountPoint)
      return true
    }
    return false
  }

  /**
   * Manipula raycast para hover
   */
  handleRaycast(raycaster: THREE.Raycaster): boolean {
    if (!this.gizmoGroup) return false

    const intersects = raycaster.intersectObject(this.gizmoGroup, true)
    const wasHovered = this.isHovered
    this.isHovered = intersects.length > 0

    if (wasHovered !== this.isHovered) {
      this.updateAppearance()
    }

    return this.isHovered
  }

  /**
   * Remove gizmo da cena
   */
  dispose(): void {
    if (!this.gizmoGroup) return

    this.objectRoot.remove(this.gizmoGroup)

    // Dispose geometries e materials
    this.gizmoGroup.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      } else if (child instanceof THREE.Sprite) {
        child.material.dispose()
        child.geometry?.dispose()
      }
    })

    this.gizmoGroup = null
    this.seatMarker = null
    this.directionArrow = null
    this.labelSprite = null
  }

  /**
   * Obtém dados do MountPoint
   */
  getMountPoint(): MountPoint {
    return this.mountPoint
  }

  /**
   * Obtém o grupo THREE do gizmo
   */
  getGizmoGroup(): THREE.Group | null {
    return this.gizmoGroup
  }
}

/**
 * Gerenciador de gizmos de montagem para um objeto
 */
export class MountPointGizmoManager {
  private gizmos: Map<string, MountPointGizmo> = new Map()
  private objectRoot: THREE.Mesh
  private selectedGizmo: MountPointGizmo | null = null
  private raycaster: THREE.Raycaster
  private camera: THREE.Camera | null = null

  // Callbacks
  public onMountPointSelect?: (mountPoint: MountPoint) => void
  public onMountPointChange?: (mountPoint: MountPoint, newOffset: THREE.Vector3) => void
  public onMountPointDelete?: (mountPoint: MountPoint) => void
  public onMountPointCreate?: (localPosition: THREE.Vector3) => void

  constructor(objectRoot: THREE.Mesh) {
    this.objectRoot = objectRoot
    this.raycaster = new THREE.Raycaster()
    this.raycaster.layers.set(1) // Layer para gizmos
  }

  /**
   * Define câmera para raycast
   */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera
  }

  /**
   * Cria gizmos para todos os pontos de montagem
   */
  createGizmos(mountConfig: MountConfig): void {
    this.clearGizmos()

    for (const mountPoint of mountConfig.mountPoints) {
      const gizmo = new MountPointGizmo(mountPoint, this.objectRoot)
      gizmo.onSelect = (_mp) => this.selectGizmo(gizmo)
      gizmo.onDrag = (mp, offset) => this.onMountPointChange?.(mp, offset)
      gizmo.onDelete = (mp) => this.deleteMountPoint(mp.id)
      this.gizmos.set(mountPoint.id, gizmo)
    }
  }

  /**
   * Atualiza gizmos (chamado quando config muda)
   */
  updateGizmos(mountConfig: MountConfig): void {
    // Remove gizmos de pontos deletados
    const currentIds = new Set(mountConfig.mountPoints.map(p => p.id))
    for (const [id, gizmo] of this.gizmos) {
      if (!currentIds.has(id)) {
        gizmo.dispose()
        this.gizmos.delete(id)
      }
    }

    // Atualiza ou cria gizmos
    for (const mountPoint of mountConfig.mountPoints) {
      let gizmo = this.gizmos.get(mountPoint.id)
      if (gizmo) {
        // Atualiza posição se offset mudou
        gizmo.setLocalOffset(mountPoint.localOffset)
        // Atualiza label se nome mudou
        // (recriaria label se necessário)
      } else {
        const newGizmo = new MountPointGizmo(mountPoint, this.objectRoot)
        newGizmo.onSelect = (_mp) => this.selectGizmo(newGizmo)
        newGizmo.onDrag = (mp, offset) => this.onMountPointChange?.(mp, offset)
        newGizmo.onDelete = (mp) => this.deleteMountPoint(mp.id)
        this.gizmos.set(mountPoint.id, newGizmo)
      }
    }
  }

  /**
   * Seleciona um gizmo
   */
  selectGizmo(gizmo: MountPointGizmo | null): void {
    if (this.selectedGizmo) {
      this.selectedGizmo.setSelected(false)
    }
    this.selectedGizmo = gizmo
    if (gizmo) {
      gizmo.setSelected(true)
      this.onMountPointSelect?.(gizmo.getMountPoint())
    } else {
      this.onMountPointSelect?.(null as any)
    }
  }

  /**
   * Obtém gizmo selecionado
   */
  getSelectedGizmo(): MountPointGizmo | null {
    return this.selectedGizmo
  }

  /**
   * Cria novo ponto de montagem na posição do cursor
   */
  createMountPointAtCursor(screenX: number, screenY: number): MountPoint | null {
    if (!this.camera) return null

    // Raycast no plano do objeto
    this.raycaster.setFromCamera(new THREE.Vector2(screenX, screenY), this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.objectRoot.position.y)
    const intersectPoint = new THREE.Vector3()
    this.raycaster.ray.intersectPlane(plane, intersectPoint)

    if (!intersectPoint) return null

    // Converte para espaço local do objeto
    const localPos = this.objectRoot.worldToLocal(intersectPoint.clone())
    localPos.y = 0.55 // Altura padrão do assento

    const newMountPoint = {
      id: `seat_${Date.now()}`,
      label: `Assento ${this.gizmos.size + 1}`,
      localOffset: localPos,
      capacityTags: ['passenger'],
      priority: this.gizmos.size * 10,
      playerUsable: true,
      requiresInteraction: true,
    } as MountPoint

    this.onMountPointCreate?.(localPos)
    return newMountPoint
  }

  /**
   * Deleta ponto de montagem
   */
  deleteMountPoint(id: string): void {
    const gizmo = this.gizmos.get(id)
    if (gizmo) {
      const mountPoint = gizmo.getMountPoint()
      gizmo.dispose()
      this.gizmos.delete(id)
      if (this.selectedGizmo === gizmo) this.selectedGizmo = null
      this.onMountPointDelete?.(mountPoint)
    }
  }

  /**
   * Manipula mouse down para seleção/drag
   */
  handleMouseDown(screenX: number, screenY: number): boolean {
    if (!this.camera) return false

    this.raycaster.setFromCamera(new THREE.Vector2(screenX, screenY), this.camera)

    // Verifica clique em gizmos existentes
    for (const gizmo of this.gizmos.values()) {
      if (gizmo.handleClick(this.raycaster, this.camera)) {
        return true
      }
    }

    // Se clicou no vazio e tem shift, cria novo ponto
    // (lógica de criação seria no nível superior)
    return false
  }

  /**
   * Manipula mouse move para hover/drag
   */
  handleMouseMove(screenX: number, screenY: number): boolean {
    if (!this.camera) return false

    this.raycaster.setFromCamera(new THREE.Vector2(screenX, screenY), this.camera)

    let anyHovered = false
    for (const gizmo of this.gizmos.values()) {
      if (gizmo.handleRaycast(this.raycaster)) {
        anyHovered = true
      }
    }

    return anyHovered
  }

  /**
   * Limpa todos os gizmos
   */
  clearGizmos(): void {
    for (const gizmo of this.gizmos.values()) {
      gizmo.dispose()
    }
    this.gizmos.clear()
    this.selectedGizmo = null
  }

  /**
   * Obtém todos os gizmos
   */
  getAllGizmos(): MountPointGizmo[] {
    return Array.from(this.gizmos.values())
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.clearGizmos()
  }
}

/**
 * Painel de propriedades do MountPoint para UI
 */
export type MountPointPropertyPanel = {
  mountPoint: MountPoint | null
  onChange: (mountPoint: MountPoint, changes: Partial<MountPoint>) => void
  onDelete: (mountPoint: MountPoint) => void
  onDuplicate: (mountPoint: MountPoint) => void
}

/**
 * Cria configuração padrão de montagem para novo objeto
 * Re-exporta de MountPoint.ts
 */
export const createDefaultMountConfig = createDefaultMountConfigFromPoint

/**
 * Serializa MountConfig para JSON (para salvar em projeto)
 */
export function serializeMountConfig(config: MountConfig): Record<string, unknown> {
  return {
    mountPoints: config.mountPoints.map(mp => ({
      id: mp.id,
      label: mp.label,
      localOffset: mp.localOffset.toArray(),
      localRotation: mp.localRotation ? mp.localRotation.toArray() : undefined,
      boneName: mp.boneName,
      capacityTags: mp.capacityTags,
      priority: mp.priority,
      stateVariable: mp.stateVariable,
      playerUsable: mp.playerUsable,
      requiresInteraction: mp.requiresInteraction,
      cameraOffset: mp.cameraOffset?.toArray(),
    })),
    defaultSeatOffset: config.defaultSeatOffset.toArray(),
    mountable: config.mountable,
    interactionRadius: config.interactionRadius,
    interactionKey: config.interactionKey,
    controlBindings: config.controlBindings,
    animationMapping: config.animationMapping,
  }
}

/**
 * Desserializa MountConfig de JSON
 */
export function deserializeMountConfig(data: Record<string, unknown>): MountConfig {
  return {
    mountPoints: ((data.mountPoints as Array<Record<string, unknown>>) ?? []).map(mp => ({
      id: mp.id as string,
      label: mp.label as string,
      localOffset: new THREE.Vector3(...(mp.localOffset as [number, number, number])),
      localRotation: mp.localRotation ? new THREE.Euler(...(mp.localRotation as [number, number, number])) : undefined,
      boneName: mp.boneName as string | undefined,
      capacityTags: (mp.capacityTags as string[]) ?? ['passenger'],
      priority: (mp.priority as number) ?? 0,
      stateVariable: mp.stateVariable as string | undefined,
      playerUsable: (mp.playerUsable as boolean) ?? true,
      requiresInteraction: (mp.requiresInteraction as boolean) ?? true,
      cameraOffset: mp.cameraOffset ? new THREE.Vector3(...(mp.cameraOffset as [number, number, number])) : undefined,
    })),
    defaultSeatOffset: new THREE.Vector3(...(data.defaultSeatOffset as [number, number, number])),
    mountable: (data.mountable as boolean) ?? true,
    interactionRadius: (data.interactionRadius as number) ?? 2.5,
    interactionKey: (data.interactionKey as string) ?? 'KeyE',
    controlBindings: (data.controlBindings as MountConfig['controlBindings']) ?? {
      forward: 'KeyW',
      backward: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
    },
    animationMapping: data.animationMapping as MountConfig['animationMapping'],
  }
}