import type { CameraPreset } from '../../project/format'
import type { ToolMode, TransformMode } from '../../EditorState'

export interface EngineEvents {
  objectAdded: { id: string }
  objectRemoved: { id: string }
  objectRenamed: { id: string; name: string }
  /** posição, rotação, escala, cor ou visibilidade mudaram */
  objectChanged: { id: string }
  objectClicked: { id: string }
  selectionChanged: { id: string | null }
  terrainChanged: { edits: number }
  worldReset: { count: number }
  toolChanged: { tool: ToolMode; transform: TransformMode }
  cameraChanged: { preset: CameraPreset }
}
