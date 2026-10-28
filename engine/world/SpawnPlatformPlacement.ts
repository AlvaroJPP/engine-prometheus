import * as THREE from 'three'
import { clamp, snap } from '../lib/math'
import type { World } from './World'

/** Places a unique, persistent player spawn platform at the current editor target. */
export function placeSpawnPlatform(world: World, cameraTarget: THREE.Vector3): void {
  const x = clamp(snap(cameraTarget.x, 0.5), -48, 48)
  const z = clamp(snap(cameraTarget.z, 0.5), -48, 48)
  const groundY = world.terrain.heightAt(x, z)

  for (const object of world.list()) {
    if (object.name === 'Plataforma de Spawn' || object.mesh.userData.playerSpawn === true) {
      world.rename(object.id, 'Plataforma')
      object.mesh.userData.playerSpawn = false
    }
  }

  const spawn = world.place('platform', x, groundY, z)
  spawn.name = 'Plataforma de Spawn'
  spawn.mesh.name = 'Plataforma de Spawn'
  spawn.mesh.scale.set(0.5, 0.5, 0.5)
  spawn.mesh.position.y = groundY + 0.1
  spawn.mesh.userData.playerSpawn = true
  world.notifyChanged(spawn.id)
  world.select(spawn.id)
}
