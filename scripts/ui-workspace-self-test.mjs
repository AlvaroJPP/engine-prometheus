import assert from 'node:assert/strict'
import {
  createUIElement,
  createUIScreen,
  parseUIScreenDefinitions,
} from '../engine/ui/UIScreenDocument.ts'

const screen = createUIScreen('Menu de teste')
screen.enabledInGame = true
screen.elements = (['panel', 'text', 'button', 'image', 'progress'] as const).map((kind, index) => {
  const element = createUIElement(kind, index)
  element.x = index * 4
  element.y = index * 5
  return element
})
screen.elements[3]!.imageDataUrl = 'data:image/png;base64,AA=='

const parsed = parseUIScreenDefinitions([screen])
assert.equal(parsed.length, 1)
assert.equal(parsed[0]!.name, 'Menu de teste')
assert.equal(parsed[0]!.enabledInGame, true)
assert.deepEqual(parsed[0]!.elements.map(element => element.kind), ['panel', 'text', 'button', 'image', 'progress'])
assert.equal(parsed[0]!.elements[3]!.imageDataUrl, 'data:image/png;base64,AA==')

const normalized = parseUIScreenDefinitions([{
  ...screen,
  background: 'url(javascript:alert(1))',
  elements: [{ ...screen.elements[0]!, x: 200, width: 0, color: 'red' }],
}])
assert.equal(normalized[0]!.background, '#101319')
assert.equal(normalized[0]!.elements[0]!.x, 100)
assert.equal(normalized[0]!.elements[0]!.width, 1)
assert.equal(normalized[0]!.elements[0]!.color, '#F4F1E9')

assert.throws(() => parseUIScreenDefinitions({ screens: [] }), /lista de telas/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, id: '' }]), /ID válido/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen }, { ...screen }]), /ID de tela duplicado/)
assert.throws(() => parseUIScreenDefinitions([{ ...screen, elements: Array.from({ length: 513 }, (_, index) => ({ ...screen.elements[0]!, id: `element-${index}` })) }]), /512 elementos/)
assert.throws(() => parseUIScreenDefinitions(Array.from({ length: 65 }, (_, index) => ({ ...screen, id: `screen-${index}` }))), /64 telas/)

console.log('UI workspace self-test passed: creation, normalization, assets and validation.')
