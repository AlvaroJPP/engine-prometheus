import * as THREE from 'three'
import { clamp } from '../lib/math'
import type { CameraData, CameraPreset } from '../project/format'

const PRESETS: Record<CameraPreset, { yaw: number; pitch: number; distance: number }> = {
  free: { yaw: 0.8, pitch: 0.5, distance: 30 },
  isometric: { yaw: Math.PI / 4, pitch: 0.6155, distance: 40 },
  top: { yaw: 0, pitch: 1.5, distance: 55 },
}

/** Câmera em órbita ao redor de um ponto: orbitar, mover (pan) e zoom. */
export class OrbitCamera {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
  readonly target = new THREE.Vector3(0, 1, 0)
  preset: CameraPreset = 'free'
  yaw = PRESETS.free.yaw
  pitch = PRESETS.free.pitch
  distance = PRESETS.free.distance
  firstPerson = false

  constructor() {
    this.update()
  }

  setFirstPersonMode(enabled: boolean): void {
    this.firstPerson = enabled
    if (enabled) {
      this.preset = 'free'
      this.pitch = 0
      this.distance = 0
    } else {
      this.distance = PRESETS.free.distance
      this.pitch = PRESETS.free.pitch
    }
  }

  setPreset(preset: CameraPreset): void {
    const p = PRESETS[preset]
    this.preset = preset
    this.yaw = p.yaw
    this.pitch = p.pitch
    this.distance = p.distance
    this.target.set(0, 1, 0)
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.005
    this.pitch = this.firstPerson
      ? clamp(this.pitch + dy * 0.005, -1.45, 1.45)
      : clamp(this.pitch + dy * 0.005, 0.05, 1.5)
  }

  zoom(deltaY: number): void {
    this.distance = clamp(this.distance * Math.exp(deltaY * 0.0012), 3, 150)
  }

  pan(dx: number, dy: number): void {
    const k = this.distance * 0.0015
    const rx = Math.cos(this.yaw)
    const rz = -Math.sin(this.yaw)
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    this.target.x = clamp(this.target.x - rx * dx * k + fx * dy * k, -50, 50)
    this.target.z = clamp(this.target.z - rz * dx * k + fz * dy * k, -50, 50)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  update(): void {
    if (this.firstPerson) {
      this.camera.position.set(this.target.x, this.target.y + 0.72, this.target.z)
      const direction = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
      this.camera.lookAt(this.camera.position.clone().add(direction))
      return
    }
    const cp = Math.cos(this.pitch)
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    )
    this.camera.lookAt(this.target)
  }

  getState(): CameraData {
    return {
      preset: this.preset,
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      target: [this.target.x, this.target.y, this.target.z],
    }
  }

  restore(d: CameraData): void {
    this.preset = d.preset
    this.yaw = d.yaw
    this.pitch = clamp(d.pitch, 0.05, 1.5)
    this.distance = clamp(d.distance, 3, 150)
    this.target.set(d.target[0], d.target[1], d.target[2])
  }
}
