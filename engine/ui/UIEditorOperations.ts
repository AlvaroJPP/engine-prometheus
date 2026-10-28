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

export interface UIElementRect {
  x: number
  y: number
  width: number
  height: number
}

export type UIResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface UIElementResizeOptions {
  snapToGrid?: boolean
  gridSize?: number
  preserveAspectRatio?: boolean
}

/** Computes the smallest rectangle that contains all supplied elements. */
export function getUIElementsBounds(
  elements: readonly Pick<UIElementDefinition, 'x' | 'y' | 'width' | 'height'>[],
): UIElementRect | null {
  if (!elements.length) return null
  const left = Math.min(...elements.map(element => element.x))
  const top = Math.min(...elements.map(element => element.y))
  const right = Math.max(...elements.map(element => element.x + element.width))
  const bottom = Math.max(...elements.map(element => element.y + element.height))
  return {
    x: Number(left.toFixed(2)),
    y: Number(top.toFixed(2)),
    width: Number((right - left).toFixed(2)),
    height: Number((bottom - top).toFixed(2)),
  }
}

/**
 * Computes a bounded resize rectangle in percentage coordinates.
 * Corner handles can preserve the original aspect ratio while Shift is held.
 */
export function getResizedUIElementRect(
  origin: UIElementRect,
  handle: UIResizeHandle,
  deltaX: number,
  deltaY: number,
  options: UIElementResizeOptions = {},
): UIElementRect {
  if (origin.width <= 0 || origin.height <= 0) return origin
  const leftOrigin = clamp(origin.x, 0, 100)
  const topOrigin = clamp(origin.y, 0, 100)
  const rightOrigin = clamp(origin.x + origin.width, leftOrigin + 1, 100)
  const bottomOrigin = clamp(origin.y + origin.height, topOrigin + 1, 100)
  const grid = Number.isFinite(options.gridSize) && (options.gridSize ?? 0) > 0 ? options.gridSize! : 2.5
  const snap = (value: number) => options.snapToGrid ? Math.round(value / grid) * grid : value

  let left = leftOrigin
  let right = rightOrigin
  let top = topOrigin
  let bottom = bottomOrigin
  if (handle.includes('w')) left = clamp(snap(leftOrigin + deltaX), 0, rightOrigin - 1)
  if (handle.includes('e')) right = clamp(snap(rightOrigin + deltaX), leftOrigin + 1, 100)
  if (handle.includes('n')) top = clamp(snap(topOrigin + deltaY), 0, bottomOrigin - 1)
  if (handle.includes('s')) bottom = clamp(snap(bottomOrigin + deltaY), topOrigin + 1, 100)

  const isCorner = handle.length === 2
  if (options.preserveAspectRatio && isCorner) {
    const west = handle.includes('w')
    const north = handle.includes('n')
    const anchorX = west ? rightOrigin : leftOrigin
    const anchorY = north ? bottomOrigin : topOrigin
    const movingX = west ? left : right
    const movingY = north ? top : bottom
    const widthScale = Math.max(1, Math.abs(movingX - anchorX)) / origin.width
    const heightScale = Math.max(1, Math.abs(movingY - anchorY)) / origin.height
    let scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale

    const maxWidth = west ? anchorX : 100 - anchorX
    const maxHeight = north ? anchorY : 100 - anchorY
    const minScale = Math.max(1 / origin.width, 1 / origin.height)
    const maxScale = Math.max(minScale, Math.min(maxWidth / origin.width, maxHeight / origin.height))
    scale = clamp(scale, minScale, maxScale)

    const width = origin.width * scale
    const height = origin.height * scale
    if (west) left = anchorX - width
    else right = anchorX + width
    if (north) top = anchorY - height
    else bottom = anchorY + height
  }

  return {
    x: Number(clamp(left, 0, 99).toFixed(2)),
    y: Number(clamp(top, 0, 99).toFixed(2)),
    width: Number(clamp(right - left, 1, 100).toFixed(2)),
    height: Number(clamp(bottom - top, 1, 100).toFixed(2)),
  }
}

/** Returns IDs of UI elements intersecting a selection rectangle in percentage coordinates. */
export function getUIElementIdsInRect(
  elements: readonly UIElementDefinition[],
  rect: UIElementRect,
): string[] {
  const left = Math.min(rect.x, rect.x + rect.width)
  const right = Math.max(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const bottom = Math.max(rect.y, rect.y + rect.height)
  return elements.filter(element =>
    element.x <= right &&
    element.x + element.width >= left &&
    element.y <= bottom &&
    element.y + element.height >= top,
  ).map(element => element.id)
}

/** Scales a selected set of UI elements from one shared rectangle into another. */
export function resizeUIElements(
  elements: readonly UIElementDefinition[],
  elementIds: readonly string[],
  origin: UIElementRect,
  target: UIElementRect,
): readonly UIElementDefinition[] {
  const selectedIds = new Set(elementIds)
  const selectedCount = elements.filter(element => selectedIds.has(element.id)).length
  if (selectedCount === 0 || origin.width <= 0 || origin.height <= 0) return elements

  const scaleX = target.width / origin.width
  const scaleY = target.height / origin.height
  return elements.map(element => {
    if (!selectedIds.has(element.id)) return element
    const width = clamp(element.width * scaleX, 1, 100)
    const height = clamp(element.height * scaleY, 1, 100)
    const x = target.x + (element.x - origin.x) * scaleX
    const y = target.y + (element.y - origin.y) * scaleY
    return {
      ...element,
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
      ...getClampedUIElementPosition({ width, height }, x, y),
    }
  })
}

/** Distributes at least three selected elements with equal gaps along one axis. */
export function distributeUIElements(
  elements: readonly UIElementDefinition[],
  elementIds: readonly string[],
  axis: UIElementAxis,
): readonly UIElementDefinition[] {
  const selectedIds = new Set(elementIds)
  const selected = elements.filter(element => selectedIds.has(element.id))
  if (selected.length < 3) return elements

  const coordinate = axis === 'horizontal' ? 'x' : 'y'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const ordered = [...selected].sort((a, b) => a[coordinate] - b[coordinate])
  const start = Math.min(...ordered.map(element => element[coordinate]))
  const end = Math.max(...ordered.map(element => element[coordinate] + element[size]))
  const totalSize = ordered.reduce((total, element) => total + clamp(element[size], 1, 100), 0)
  const gap = (end - start - totalSize) / (ordered.length - 1)

  // Equal gaps cannot be achieved without overlap if the content is wider/taller than its bounds.
  if (gap < -0.001) return elements

  const positions = new Map<string, number>()
  let cursor = start
  for (const element of ordered) {
    positions.set(element.id, Number(cursor.toFixed(2)))
    cursor += clamp(element[size], 1, 100) + gap
  }

  return elements.map(element => {
    if (!selectedIds.has(element.id)) return element
    const position = positions.get(element.id)
    if (position === undefined) return element
    const x = axis === 'horizontal' ? position : element.x
    const y = axis === 'vertical' ? position : element.y
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
