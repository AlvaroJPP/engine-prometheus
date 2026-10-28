import assert from 'node:assert/strict'
import {
  createUIElement,
  createUIScreen,
  getRenderableUIScreenDefinitions,
  parseUIScreenDefinitions,
} from '../engine/ui/UIScreenDocument.ts'
import {
  alignUIElement,
  duplicateUIElement,
  getClampedUIElementPosition,
  reorderUIElement,
} from '../engine/ui/UIEditorOperations.ts'

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

const legacyElement = { ...screen.elements[0] }
delete legacyElement.opacity
delete legacyElement.fontWeight
delete legacyElement.textAlign
delete legacyElement.imageFit
const legacyDocument = parseUIScreenDefinitions([{ ...screen, elements: [legacyElement] }])
assert.equal(legacyDocument[0].elements[0].opacity, 1)
assert.equal(legacyDocument[0].elements[0].fontWeight, 600)
assert.equal(legacyDocument[0].elements[0].textAlign, 'center')
assert.equal(legacyDocument[0].elements[0].imageFit, 'contain')

assert.throws(() => parseUIScreenDefinitions({ screens: [] }), /lista de telas/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, id: '' }]), /ID válido/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen }, { ...screen }]), /ID de tela duplicado/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, elements: Array.from({ length: 513 }, (_, index) => ({ ...screen.elements[0], id: `element-${index}` })) }]), /512 elementos/)
assert.throws(() => parseUIScreenDefinitions(Array.from({ length: 65 }, (_, index) => ({ ...screen, id: `screen-${index}` }))), /64 telas/)


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

const duplicate = duplicateUIElement(screen.elements[3], screen.elements.length)
assert.notEqual(duplicate.id, screen.elements[3].id)
assert.equal(duplicate.name, screen.elements[3].name + ' - cópia')
assert.equal(duplicate.imageDataUrl, screen.elements[3].imageDataUrl)
assert.equal(duplicate.x, screen.elements[3].x + 2.5)
assert.equal(duplicate.y, screen.elements[3].y + 2.5)

const originalOrder = screen.elements.map(element => element.id)
const raised = reorderUIElement(screen.elements, originalOrder[0], 1)
assert.deepEqual(raised.map(element => element.id), [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)])
const lowered = reorderUIElement(raised, originalOrder[0], -1)
assert.deepEqual(lowered.map(element => element.id), originalOrder)
assert.equal(reorderUIElement(screen.elements, 'missing-element', 1), screen.elements)
assert.equal(reorderUIElement(screen.elements, originalOrder.at(-1), 1), screen.elements)

console.log('UI workspace self-test passed: validation, legacy compatibility, appearance settings, asset handling, snapping, alignment, duplication and layer ordering.')
