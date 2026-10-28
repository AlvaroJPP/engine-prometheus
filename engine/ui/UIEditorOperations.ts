import { createUIScreenId, type UIElementDefinition } from './UIScreenDocument.ts'

export type UIElementAxis = 'horizontal' | 'vertical'
export type UIElementLayerDirection = -1 | 1
export type UIElementGroupAlignment = 'left' | 'right' | 'top' | 'bottom' | 'horizontal-center' | 'vertical-center'

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

/** Aligns multiple selected elements against the shared selection bounds. */
export function alignUIElements(
  elements: readonly UIElementDefinition[],
  elementIds: readonly string[],
  alignment: UIElementGroupAlignment,
): readonly UIElementDefinition[] {
  const selectedIds = new Set(elementIds)
  const selected = elements.filter(element => selectedIds.has(element.id))
  if (selected.length < 2) return elements

  const left = Math.min(...selected.map(element => element.x))
  const top = Math.min(...selected.map(element => element.y))
  const right = Math.max(...selected.map(element => element.x + element.width))
  const bottom = Math.max(...selected.map(element => element.y + element.height))
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2

  return elements.map(element => {
    if (!selectedIds.has(element.id)) return element
    let x = element.x
    let y = element.y
    switch (alignment) {
      case 'left': x = left; break
      case 'right': x = right - element.width; break
      case 'top': y = top; break
      case 'bottom': y = bottom - element.height; break
      case 'horizontal-center': x = centerX - element.width / 2; break
      case 'vertical-center': y = centerY - element.height / 2; break
    }
    return { ...element, ...getClampedUIElementPosition(element, x, y) }
  })
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
