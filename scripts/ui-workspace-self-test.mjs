import assert from 'node:assert/strict'
import {
  createUIElement,
  createUIScreen,
  getRenderableUIScreenDefinitions,
  parseUIScreenDefinitions,
} from '../engine/ui/UIScreenDocument.ts'
import {
  alignUIElement,
  alignUIElements,
  duplicateUIElement,
  getClampedUIElementPosition,
  getUIElementIdsInRect,
  reorderUIElement,
  resizeUIElements,
} from '../engine/ui/UIEditorOperations.ts'
import { createUIScreenFromPreset, UI_SCREEN_PRESETS } from '../engine/ui/UIScreenPresets.ts'
import { UIWorkspaceHistory } from '../engine/ui/UIWorkspaceHistory.ts'

const screen = createUIScreen('Menu de teste')
screen.enabledInGame = true
screen.displayMode = 'overlay'
screen.elements = (['panel', 'text', 'button', 'image', 'progress']).map((kind, index) => {
  const element = createUIElement(kind, index)
  element.x = index * 4
  element.y = index * 5
  return element
})
screen.elements[3].imageDataUrl = 'data:image/png;base64,AA=='
screen.elements[0].groupId = 'group-header'
screen.elements[1].groupId = 'group-header'
screen.elements[0].opacity = 0.35
screen.elements[0].textAlign = 'left'
screen.elements[0].fontWeight = 800
screen.elements[3].imageFit = 'cover'

const parsed = parseUIScreenDefinitions([screen])
assert.equal(parsed.length, 1)
assert.equal(parsed[0].name, 'Menu de teste')
assert.equal(parsed[0].enabledInGame, true)
assert.equal(parsed[0].displayMode, 'overlay')
assert.deepEqual(parsed[0].elements.map(element => element.kind), ['panel', 'text', 'button', 'image', 'progress'])
assert.equal(parsed[0].elements[0].opacity, 0.35)
assert.equal(parsed[0].elements[0].textAlign, 'left')
assert.equal(parsed[0].elements[0].fontWeight, 800)
assert.equal(parsed[0].elements[3].imageFit, 'cover')
assert.equal(parsed[0].elements[0].groupId, 'group-header')
assert.equal(parsed[0].elements[1].groupId, 'group-header')

const emptyDraft = createUIScreen('Rascunho vazio')
emptyDraft.enabledInGame = true
const inactive = createUIScreen('Tela desativada')
inactive.elements.push(createUIElement('text'))
const active = createUIScreen('Menu ativo')
active.enabledInGame = true
active.elements.push(createUIElement('button'))
assert.deepEqual(getRenderableUIScreenDefinitions([emptyDraft, inactive, active]).map(item => item.id), [active.id])
assert.equal(parsed[0].elements[3].imageDataUrl, 'data:image/png;base64,AA==')

const normalized = parseUIScreenDefinitions([{
  ...screen,
  background: 'url(javascript:alert(1))',
  displayMode: 'unsupported',
  elements: [{ ...screen.elements[0], x: 200, width: 0, color: 'red', opacity: -3, fontWeight: 999, textAlign: 'diagonal', imageFit: 'stretch' }],
}])
assert.equal(normalized[0].background, '#00000000')
assert.equal(normalized[0].displayMode, 'screen')
assert.equal(normalized[0].elements[0].x, 100)
assert.equal(normalized[0].elements[0].width, 1)
assert.equal(normalized[0].elements[0].color, '#F4F1E9')
assert.equal(normalized[0].elements[0].opacity, 0)
assert.equal(normalized[0].elements[0].fontWeight, 600)
assert.equal(normalized[0].elements[0].textAlign, 'center')
assert.equal(normalized[0].elements[0].imageFit, 'contain')
const normalizedGroup = parseUIScreenDefinitions([{ ...screen, elements: [{ ...screen.elements[0], groupId: '  clean-group  ' }] }])
assert.equal(normalizedGroup[0].elements[0].groupId, 'clean-group')

const legacyElement = { ...screen.elements[0] }
delete legacyElement.opacity
delete legacyElement.fontWeight
delete legacyElement.textAlign
delete legacyElement.imageFit
delete legacyElement.groupId
const legacyDocument = parseUIScreenDefinitions([{ ...screen, elements: [legacyElement] }])
assert.equal(legacyDocument[0].elements[0].opacity, 1)
assert.equal(legacyDocument[0].elements[0].fontWeight, 600)
assert.equal(legacyDocument[0].elements[0].textAlign, 'center')
assert.equal(legacyDocument[0].elements[0].imageFit, 'contain')
assert.equal(legacyDocument[0].elements[0].groupId, undefined)

assert.throws(() => parseUIScreenDefinitions({ screens: [] }), /lista de telas/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, id: '' }]), /ID válido/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen }, { ...screen }]), /ID de tela duplicado/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, elements: Array.from({ length: 513 }, (_, index) => ({ ...screen.elements[0], id: `element-${index}` })) }]), /512 elementos/)
assert.throws(() => parseUIScreenDefinitions(Array.from({ length: 65 }, (_, index) => ({ ...screen, id: `screen-${index}` }))), /64 telas/)


const presets = UI_SCREEN_PRESETS.map(preset => createUIScreenFromPreset(preset.id))
assert.equal(presets.length, 3)
assert.deepEqual(presets.map(preset => preset.name), ['Menu principal', 'Menu de pausa', 'HUD de aventura'])
assert.ok(presets.every(preset => preset.enabledInGame === false))
assert.ok(presets.every(preset => preset.elements.length >= 4))
assert.ok(presets.every(preset => parseUIScreenDefinitions([preset]).length === 1))
assert.equal(presets[0].displayMode, 'screen')
assert.equal(presets[1].displayMode, 'screen')
assert.equal(presets[2].displayMode, 'overlay')

const presetScreenIds = presets.map(preset => preset.id)
assert.equal(new Set(presetScreenIds).size, presetScreenIds.length)
const presetElementIds = presets.flatMap(preset => preset.elements.map(element => element.id))
assert.equal(new Set(presetElementIds).size, presetElementIds.length)
assert.ok(presets[0].elements.some(element => element.kind === 'button' && element.action === 'set-variable' && element.variableName === 'ui.action.start'))
assert.ok(presets[1].elements.some(element => element.kind === 'button' && element.variableName === 'ui.action.resume'))
assert.deepEqual(
  presets[2].elements.filter(element => element.kind === 'progress').map(element => element.variableName),
  ['vida', 'mana'],
)

const firstHistoryScreen = createUIScreen('Estado A')
const history = new UIWorkspaceHistory(3)
history.reset({ screens: [firstHistoryScreen], activeScreenId: firstHistoryScreen.id })
assert.equal(history.canUndo, false)
assert.equal(history.canRedo, false)
assert.equal(history.size, 1)

const secondHistoryState = JSON.parse(JSON.stringify(firstHistoryScreen))
secondHistoryState.name = 'Estado B'
assert.equal(history.record({ screens: [secondHistoryState], activeScreenId: secondHistoryState.id }), true)
assert.equal(history.canUndo, true)
assert.equal(history.canRedo, false)

const thirdHistoryState = JSON.parse(JSON.stringify(secondHistoryState))
thirdHistoryState.name = 'Estado C'
history.record({ screens: [thirdHistoryState], activeScreenId: thirdHistoryState.id })
assert.equal(history.size, 3)
assert.equal(history.undo().screens[0].name, 'Estado B')
assert.equal(history.canRedo, true)
assert.equal(history.redo().screens[0].name, 'Estado C')
assert.equal(history.record({ screens: [thirdHistoryState], activeScreenId: thirdHistoryState.id }), false)

history.undo()
const fourthHistoryState = JSON.parse(JSON.stringify(secondHistoryState))
fourthHistoryState.name = 'Estado D'
history.record({ screens: [fourthHistoryState], activeScreenId: fourthHistoryState.id })
assert.equal(history.canRedo, false)
assert.equal(history.undo().screens[0].name, 'Estado B')
assert.equal(history.redo().screens[0].name, 'Estado D')

const boundedHistory = new UIWorkspaceHistory(3)
boundedHistory.reset({ screens: [firstHistoryScreen], activeScreenId: firstHistoryScreen.id })
for (const name of ['Limite B', 'Limite C', 'Limite D']) {
  boundedHistory.record({
    screens: [{ ...firstHistoryScreen, name }],
    activeScreenId: firstHistoryScreen.id,
  })
}
assert.equal(boundedHistory.size, 3)
assert.equal(boundedHistory.undo().screens[0].name, 'Limite C')
assert.equal(boundedHistory.undo().screens[0].name, 'Limite B')
assert.equal(boundedHistory.undo(), null)

const isolatedSnapshot = history.undo()
isolatedSnapshot.screens[0].name = 'Mutação externa'
assert.equal(history.redo().screens[0].name, 'Estado D')

const position = getClampedUIElementPosition(
  { width: 25, height: 20 },
  8.8,
  11.1,
  true,
  2.5,
)
assert.deepEqual(position, { x: 10, y: 10 })
assert.deepEqual(getClampedUIElementPosition({ width: 25, height: 20 }, 99, 99), { x: 75, y: 80 })
assert.deepEqual(alignUIElement({ x: 8, y: 12, width: 20, height: 10 }, 'horizontal'), { x: 40, y: 12 })
assert.deepEqual(alignUIElement({ x: 8, y: 12, width: 20, height: 10 }, 'vertical'), { x: 8, y: 45 })

const alignFirst = createUIElement('panel')
alignFirst.id = 'align-first'
Object.assign(alignFirst, { x: 10, y: 20, width: 20, height: 10 })
const alignSecond = createUIElement('text')
alignSecond.id = 'align-second'
Object.assign(alignSecond, { x: 50, y: 40, width: 10, height: 20 })
const alignUnselected = createUIElement('button')
alignUnselected.id = 'align-unselected'
Object.assign(alignUnselected, { x: 80, y: 12, width: 8, height: 6 })
const alignSource = [alignFirst, alignSecond, alignUnselected]
const alignIds = [alignFirst.id, alignSecond.id]
assert.deepEqual(getUIElementIdsInRect(alignSource, { x: 15, y: 25, width: 5, height: 5 }), [alignFirst.id])
assert.deepEqual(getUIElementIdsInRect(alignSource, { x: 49, y: 39, width: 3, height: 4 }), [alignSecond.id])
assert.deepEqual(getUIElementIdsInRect(alignSource, { x: 70, y: 70, width: 5, height: 5 }), [])
assert.deepEqual(getUIElementIdsInRect(alignSource, { x: 30, y: 30, width: -20, height: -10 }), [alignFirst.id])
const leftAligned = alignUIElements(alignSource, alignIds, 'left')
assert.deepEqual(leftAligned.slice(0, 2).map(element => element.x), [10, 10])
assert.equal(leftAligned[2], alignUnselected)
const rightAligned = alignUIElements(alignSource, alignIds, 'right')
assert.deepEqual(rightAligned.slice(0, 2).map(element => element.x), [40, 50])
const horizontalCentered = alignUIElements(alignSource, alignIds, 'horizontal-center')
assert.deepEqual(horizontalCentered.slice(0, 2).map(element => element.x), [25, 30])
const topAligned = alignUIElements(alignSource, alignIds, 'top')
assert.deepEqual(topAligned.slice(0, 2).map(element => element.y), [20, 20])
const bottomAligned = alignUIElements(alignSource, alignIds, 'bottom')
assert.deepEqual(bottomAligned.slice(0, 2).map(element => element.y), [50, 40])
const verticalCentered = alignUIElements(alignSource, alignIds, 'vertical-center')
assert.deepEqual(verticalCentered.slice(0, 2).map(element => element.y), [35, 30])
assert.equal(alignUIElements(alignSource, [alignFirst.id], 'left'), alignSource)

const resized = resizeUIElements(
  alignSource,
  alignIds,
  { x: 10, y: 20, width: 50, height: 40 },
  { x: 10, y: 20, width: 90, height: 80 },
)
assert.deepEqual(
  resized.slice(0, 2).map(element => ({ x: element.x, y: element.y, width: element.width, height: element.height })),
  [
    { x: 10, y: 20, width: 36, height: 20 },
    { x: 82, y: 60, width: 18, height: 40 },
  ],
)
assert.equal(resized[2], alignUnselected)
assert.equal(resizeUIElements(alignSource, ['missing-id'], { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 20, height: 20 }), alignSource)
assert.equal(resizeUIElements(alignSource, alignIds, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 20, height: 20 }), alignSource)

const duplicate = duplicateUIElement(screen.elements[3], screen.elements.length)
assert.notEqual(duplicate.id, screen.elements[3].id)
assert.equal(duplicate.name, screen.elements[3].name + ' - cópia')
assert.equal(duplicate.imageDataUrl, screen.elements[3].imageDataUrl)
assert.equal(duplicate.x, screen.elements[3].x + 2.5)
assert.equal(duplicate.y, screen.elements[3].y + 2.5)

const copySource = createUIElement('image')
copySource.name = 'Ícone de origem'
copySource.imageDataUrl = 'data:image/webp;base64,AA=='
copySource.imageFit = 'cover'
const copyTargetScreen = createUIScreen('Tela de destino')
const crossScreenPaste = duplicateUIElement(copySource, copyTargetScreen.elements.length)
copyTargetScreen.elements.push(crossScreenPaste)
assert.notEqual(crossScreenPaste.id, copySource.id)
assert.equal(crossScreenPaste.imageDataUrl, copySource.imageDataUrl)
assert.equal(crossScreenPaste.imageFit, copySource.imageFit)
crossScreenPaste.x = 50
assert.notEqual(crossScreenPaste.x, copySource.x)

const originalOrder = screen.elements.map(element => element.id)
const raised = reorderUIElement(screen.elements, originalOrder[0], 1)
assert.deepEqual(raised.map(element => element.id), [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)])
const lowered = reorderUIElement(raised, originalOrder[0], -1)
assert.deepEqual(lowered.map(element => element.id), originalOrder)
assert.equal(reorderUIElement(screen.elements, 'missing-element', 1), screen.elements)
assert.equal(reorderUIElement(screen.elements, originalOrder.at(-1), 1), screen.elements)

console.log('UI workspace self-test passed: undo/redo history, marquee selection and shared resize primitives, multi-element alignment, persistent grouping metadata, cross-screen clipboard primitives, screen presets, unique IDs, legacy compatibility, appearance settings, assets, snapping, duplication and layers.')
