import { createUIScreenId, type UIElementDefinition } from './UIScreenDocument'

export type UIElementAxis = 'horizontal' | 'vertical'
export type UIElementLayerDirection = -1 | 1

export interface UIElementPosition {
  x: number
  y: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function roundPosition(value: number): number {
  return Number(clamp(value, 0, 100).toFixed(2))
}

/** Returns a bounded position, optionally snapped to a configurable percentage grid. */
export function getClampedUIElementPosition(
  element: Pick<UIElementDefinition, 'width' | 'height'>,
  x: number,
  y: number,
  snapToGrid = false,
  gridSize = 2.5,
): UIElementPosition {
  const safeGridSize = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 1
  const snap = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return snapToGrid ? Math.round(value / safeGridSize) * safeGridSize : value
  }

  const maxX = Math.max(0, 100 - clamp(element.width, 1, 100))
  const maxY = Math.max(0, 100 - clamp(element.height, 1, 100))
  return {
    x: roundPosition(clamp(snap(x), 0, maxX)),
    y: roundPosition(clamp(snap(y), 0, maxY)),
  }
}

/** Produces a new element with a fresh ID and a small, bounded offset. */
export function duplicateUIElement(
  element: UIElementDefinition,
  elementCount = 0,
  offset = 2.5,
): UIElementDefinition {
  const copy: UIElementDefinition = {
    ...element,
    id: createUIScreenId('element'),
    name: `${element.name || 'Elemento'} - cópia`.slice(0, 80),
  }
  const position = getClampedUIElementPosition(
    copy,
    copy.x + (Number.isFinite(offset) ? offset : 2.5),
    copy.y + (Number.isFinite(offset) ? offset : 2.5),
  )
  copy.x = position.x
  copy.y = position.y
  if (!copy.name.trim()) copy.name = `Elemento ${elementCount + 1}`
  return copy
}

/** Re-centers one axis without changing the element's size or other coordinate. */
export function alignUIElement(
  element: Pick<UIElementDefinition, 'x' | 'y' | 'width' | 'height'>,
  axis: UIElementAxis,
): UIElementPosition {
  return axis === 'horizontal'
    ? { x: roundPosition((100 - clamp(element.width, 1, 100)) / 2), y: element.y }
    : { x: element.x, y: roundPosition((100 - clamp(element.height, 1, 100)) / 2) }
}

/** Reorders a layer by one position; the last array entry is rendered on top. */
export function reorderUIElement(
  elements: readonly UIElementDefinition[],
  elementId: string,
  direction: UIElementLayerDirection,
): readonly UIElementDefinition[] {
  const index = elements.findIndex(element => element.id === elementId)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= elements.length) return elements

  const result = [...elements]
  ;[result[index], result[nextIndex]] = [result[nextIndex], result[index]]
  return result
}
