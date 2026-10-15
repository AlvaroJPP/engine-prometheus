import * as THREE from 'three'
import { createPrimitive } from '../model/object/Primitives'
import type { GameObject } from '../model/object/GameObject'
import { ENGINE_VERSION, FORMAT_VERSION, MAIN_SCENE_PATH } from './format'
import type { CameraData, ProjectBundle, SceneObjectData, TerrainData } from './format'

export interface ProjectMeta {
  id: string
  name: string
}

export function buildBundle(
  objects: GameObject[],
  terrain: TerrainData,
  camera: CameraData,
  meta: ProjectMeta,
  editorSettings: { gridVisible: boolean; brushStrength: number; brushRadius: number } = { gridVisible: true, brushStrength: 1.5, brushRadius: 4 },
): ProjectBundle {
  const data: SceneObjectData[] = objects.map((o) => {
    const m = o.mesh
    return {
      id: o.id,
      name: o.name,
      type: o.type,
      position: [m.position.x, m.position.y, m.position.z],
      rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
      scale: [m.scale.x, m.scale.y, m.scale.z],
      visible: m.visible,
      locked: m.userData.locked === true,
      wireframeVisible: m.userData.wireframeVisible !== false,
      groupId: typeof m.userData.groupId === 'string' ? m.userData.groupId : null,
      mass: typeof m.userData.mass === 'number' && Number.isFinite(m.userData.mass) ? Math.max(0, m.userData.mass) : 1,
      colliderType: m.userData.colliderType === 'box' || m.userData.colliderType === 'sphere' || m.userData.colliderType === 'capsule' || m.userData.colliderType === 'none' ? m.userData.colliderType : 'auto',
      colliderSize: Array.isArray(m.userData.colliderSize) ? [...m.userData.colliderSize] as [number, number, number] : undefined,
      colliderOffset: Array.isArray(m.userData.colliderOffset) ? [...m.userData.colliderOffset] as [number, number, number] : [0, 0, 0],
      importedModelData: typeof m.userData.importedModelData === 'string' ? m.userData.importedModelData : undefined,
      importedModelHeight: typeof m.userData.importedModelHeight === 'number' ? m.userData.importedModelHeight : undefined,
      color: (m.material as THREE.MeshStandardMaterial).color.getHex(),
      texturePreset: m.userData.texturePreset === 'grass' || m.userData.texturePreset === 'stone' || m.userData.texturePreset === 'brick' || m.userData.texturePreset === 'wood' || m.userData.texturePreset === 'sand' || m.userData.texturePreset === 'metal' ? m.userData.texturePreset : 'none',
    }
  })

  return {
    project: {
      formatVersion: FORMAT_VERSION,
      id: meta.id,
      name: meta.name,
      template: 'empty-world',
      engineVersion: ENGINE_VERSION,
      settings: {
        cameraMode: 'orbit',
        multiplayer: { enabled: false, maxPlayers: 4 },
        editor: {
          gridVisible: editorSettings.gridVisible,
          brushStrength: editorSettings.brushStrength,
          brushRadius: editorSettings.brushRadius,
        },
      },
      modules: [],
      scenes: [MAIN_SCENE_PATH],
    },
    scenes: {
      [MAIN_SCENE_PATH]: {
        formatVersion: FORMAT_VERSION,
        id: 'main',
        name: 'Mundo principal',
        camera,
        terrain,
        objects: data,
      },
    },
  }
}

export function objectFromData(d: SceneObjectData): GameObject {
  return createPrimitive(d.type, {
    id: d.id,
    name: d.name,
    color: d.color,
    texturePreset: d.texturePreset ?? 'none',
    position: d.position,
    rotation: d.rotation,
    scale: d.scale,
    visible: d.visible,
    locked: d.locked ?? false,
    wireframeVisible: d.wireframeVisible ?? true,
    groupId: d.groupId ?? null,
    mass: d.mass ?? 1,
    colliderType: d.colliderType ?? 'auto',
    colliderSize: d.colliderSize,
    colliderOffset: d.colliderOffset ?? [0, 0, 0],
  })
}
