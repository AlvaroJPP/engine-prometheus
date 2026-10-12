import type { ObjectType } from './project/format'

export type ToolMode = 'select' | 'build' | 'terrain'
export type TransformMode = 'move' | 'rotate' | 'scale'

export interface BrushSettings {
  strength: number
  radius: number
}

export interface EditorState {
  tool: ToolMode
  transform: TransformMode
  buildShape: ObjectType
  brush: BrushSettings
}

export function createEditorState(): EditorState {
  return {
    tool: 'select',
    transform: 'move',
    buildShape: 'cube',
    brush: { strength: 1.5, radius: 4 },
  }
}
