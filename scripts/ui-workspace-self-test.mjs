import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createUIElement,
  createUIScreen,
  getRenderableUIScreenDefinitions,
  parseUIScreenDefinitions,
} from '../engine/ui/UIScreenDocument.ts'
import {
  alignUIElement,
  alignUIElements,
  alignUIElementsToKey,
  distributeUIElements,
  distributeUIElementsInGrid,
  getUIElementSmartAlignment,
  spaceUIElements,
  duplicateUIElement,
  getClampedUIElementPosition,
  getResizedUIElementRect,
  getUIElementIdsInRect,
  getUIElementsBounds,
  reorderUIElement,
  resizeUIElements,
} from '../engine/ui/UIEditorOperations.ts'
import { createUIScreenFromPreset, UI_SCREEN_PRESETS } from '../engine/ui/UIScreenPresets.ts'
import { UIWorkspaceHistory } from '../engine/ui/UIWorkspaceHistory.ts'
import { RuleEngine } from '../engine/script/RuleEngine.ts'
import { adjustUINumericValue, isUIVisibilityConditionMet, nextUIToggleValue, resolveUIValueBindings } from '../engine/ui/UIValueBinding.ts'
import { appendUIScreenHistory, takePreviousUIScreen } from '../engine/ui/UINavigationHistory.ts'
import { removeLegacyDefaultAlquimiaHudLayers } from '../src/lib/hud/HudPresetMigration.ts'
import { DEFAULT_PLAYER_SETTINGS, sanitizePlayerSettings } from '../engine/player/PlayerSettings.ts'

assert.equal(resolveUIValueBindings('Vida: {{vida}} / Mana: {{ mana }}', { vida: 73, mana: 0 }), 'Vida: 73 / Mana: 0')
assert.deepEqual(sanitizePlayerSettings(), DEFAULT_PLAYER_SETTINGS)
assert.deepEqual(
  sanitizePlayerSettings({ walkSpeed: 100, runMultiplier: 0.2, jumpSpeed: -1, gravity: 100, colliderRadius: 9 }),
  { walkSpeed: 15, runMultiplier: 1, jumpSpeed: 0, gravity: 40, colliderRadius: 0.8 },
)
assert.deepEqual(sanitizePlayerSettings({ walkSpeed: Number.NaN }), { ...DEFAULT_PLAYER_SETTINGS })
assert.deepEqual(sanitizePlayerSettings({ walkSpeed: 7.5, colliderRadius: 0.24 }), {
  ...DEFAULT_PLAYER_SETTINGS,
  walkSpeed: 7.5,
  colliderRadius: 0.24,
})

assert.equal(resolveUIValueBindings('Ativo: {{ativo}} · Jogador: {{player.name}}', { ativo: false, 'player.name': 'Alvaro' }), 'Ativo: false · Jogador: Alvaro')
assert.equal(resolveUIValueBindings('Sem valor: {{nao_existe}}', {}), 'Sem valor: {{nao_existe}}')
assert.equal(resolveUIValueBindings('Texto comum sem vinculos', { vida: 73 }), 'Texto comum sem vinculos')
assert.equal(isUIVisibilityConditionMet('', 'true', {}), true)
assert.equal(isUIVisibilityConditionMet('ui.inventory.open', 'true', { 'ui.inventory.open': true }), true)
assert.equal(isUIVisibilityConditionMet('ui.inventory.open', 'false', { 'ui.inventory.open': false }), true)
assert.equal(isUIVisibilityConditionMet('ui.inventory.open', 'true', { 'ui.inventory.open': false }), false)
assert.equal(isUIVisibilityConditionMet('ui.inventory.open', '1', { 'ui.inventory.open': 1 }), true)
assert.equal(isUIVisibilityConditionMet('ui.inventory.open', 'true', {}), false)
assert.equal(nextUIToggleValue(true), false)
assert.equal(nextUIToggleValue(false), true)
assert.equal(nextUIToggleValue(undefined), true)
assert.equal(nextUIToggleValue(1), true)
assert.equal(nextUIToggleValue('true'), true)
assert.equal(adjustUINumericValue(10, 2.5), 12.5)
assert.equal(adjustUINumericValue(10, -3), 7)
assert.equal(adjustUINumericValue(98, 10, 0, 100), 100)
assert.equal(adjustUINumericValue(2, -10, 0, 100), 0)
assert.equal(adjustUINumericValue(5, 1, 10, 0), 6)
assert.equal(adjustUINumericValue(undefined, 1), 1)
assert.equal(adjustUINumericValue('12', 2), 2)
assert.equal(adjustUINumericValue(Number.MAX_VALUE, 1e6), Number.MAX_VALUE)
assert.equal(adjustUINumericValue(4, Number.NaN), 5)
assert.deepEqual(appendUIScreenHistory([], 'menu'), ['menu'])
assert.deepEqual(appendUIScreenHistory(['menu'], 'options'), ['menu', 'options'])
assert.equal(appendUIScreenHistory(Array.from({ length: 100 }, (_, index) => `screen-${index}`), 'new').length, 100)
assert.deepEqual(takePreviousUIScreen(['menu', 'missing', 'options'], id => id !== 'missing'), { history: ['menu'], screenId: 'options' })
assert.deepEqual(takePreviousUIScreen(['missing', 'also-missing'], () => false), { history: [], screenId: '' })
assert.deepEqual(takePreviousUIScreen([], () => true), { history: [], screenId: '' })

const legacyAlquimiaLayers = [
  { id: 'hud-alquimia-nameplate', name: 'Alquimia Escarlate · Placa do jogador' },
  { id: 'hud-alquimia-sigil', name: 'Alquimia Escarlate · Sigilo mágico' },
  { id: 'hud-alquimia-statusbar', name: 'Alquimia Escarlate · Barras decorativas' },
  { id: 'old-alquimia-copy', name: 'Alquimia Escarlate · Cópia antiga' },
  { id: 'custom-hud-image', name: 'Imagem personalizada' },
]
const migratedAlquimiaLayers = removeLegacyDefaultAlquimiaHudLayers(legacyAlquimiaLayers)
assert.deepEqual(migratedAlquimiaLayers.layers.map(layer => layer.id), ['custom-hud-image'])
assert.deepEqual(new Set(migratedAlquimiaLayers.removedIds), new Set([
  'hud-alquimia-nameplate',
  'hud-alquimia-sigil',
  'hud-alquimia-statusbar',
  'old-alquimia-copy',
]))
assert.deepEqual(removeLegacyDefaultAlquimiaHudLayers(migratedAlquimiaLayers.layers), {
  layers: [{ id: 'custom-hud-image', name: 'Imagem personalizada' }],
  removedIds: [],
})

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

screen.visibilityVariable = 'ui.menu.visible'
screen.visibilityValue = 'true'
screen.elements[0].visibilityVariable = 'ui.health_panel.visible'
screen.elements[0].visibilityValue = '1'
const parsed = parseUIScreenDefinitions([screen])
assert.equal(parsed.length, 1)
assert.equal(parsed[0].name, 'Menu de teste')
assert.equal(parsed[0].enabledInGame, true)
assert.equal(parsed[0].displayMode, 'overlay')
assert.equal(parsed[0].visibilityVariable, 'ui.menu.visible')
assert.equal(parsed[0].visibilityValue, 'true')
assert.deepEqual(parsed[0].elements.map(element => element.kind), ['panel', 'text', 'button', 'image', 'progress'])
assert.equal(parsed[0].elements[0].opacity, 0.35)
assert.equal(parsed[0].elements[0].textAlign, 'left')
assert.equal(parsed[0].elements[0].fontWeight, 800)
assert.equal(parsed[0].elements[3].imageFit, 'cover')
assert.equal(parsed[0].elements[0].visibilityVariable, 'ui.health_panel.visible')
assert.equal(parsed[0].elements[0].visibilityValue, '1')
assert.equal(parsed[0].elements[0].groupId, 'group-header')
assert.equal(parsed[0].elements[1].groupId, 'group-header')

const hudEventScreen = createUIScreen('HUD com evento')
const hudEventButton = createUIElement('button')
hudEventButton.action = 'trigger-event'
hudEventButton.eventId = 'hud.inventory.open'
hudEventScreen.elements = [hudEventButton]
const parsedHudEvent = parseUIScreenDefinitions([hudEventScreen])[0]
assert.equal(parsedHudEvent.elements[0].action, 'trigger-event')
assert.equal(parsedHudEvent.elements[0].eventId, 'hud.inventory.open')

const toggleButton = createUIElement('button')
toggleButton.action = 'toggle-variable'
toggleButton.variableName = 'ui.inventory.open'
const parsedToggleScreen = parseUIScreenDefinitions([{ ...hudEventScreen, elements: [toggleButton] }])[0]
assert.equal(parsedToggleScreen.elements[0].action, 'toggle-variable')
assert.equal(parsedToggleScreen.elements[0].variableName, 'ui.inventory.open')
const backButton = createUIElement('button')
backButton.action = 'navigate-back'
assert.equal(parseUIScreenDefinitions([{ ...hudEventScreen, elements: [backButton] }])[0].elements[0].action, 'navigate-back')
const numericButton = createUIElement('button')
numericButton.action = 'adjust-variable'
numericButton.variableName = 'ouro'
numericButton.variableStep = -2
numericButton.variableMin = 0
numericButton.variableLimitMax = 50
const parsedNumericScreen = parseUIScreenDefinitions([{ ...hudEventScreen, elements: [numericButton] }])[0]
assert.equal(parsedNumericScreen.elements[0].action, 'adjust-variable')
assert.equal(parsedNumericScreen.elements[0].variableName, 'ouro')
assert.equal(parsedNumericScreen.elements[0].variableStep, -2)
assert.equal(parsedNumericScreen.elements[0].variableMin, 0)
assert.equal(parsedNumericScreen.elements[0].variableLimitMax, 50)
const legacyHudElement = { ...hudEventButton }
delete legacyHudElement.eventId
delete legacyHudElement.visibilityVariable
delete legacyHudElement.visibilityValue
const legacyHudScreen = { ...hudEventScreen }
delete legacyHudScreen.visibilityVariable
delete legacyHudScreen.visibilityValue
const parsedLegacyHudScreen = parseUIScreenDefinitions([{ ...legacyHudScreen, elements: [legacyHudElement] }])[0]
assert.equal(parsedLegacyHudScreen.elements[0].eventId, '')
assert.equal(parsedLegacyHudScreen.visibilityVariable, '')
assert.equal(parsedLegacyHudScreen.elements[0].visibilityVariable, '')

const runtimeScriptEngine = new RuleEngine({
  events: { emit() {} },
  getSelectedId: () => null,
  info: () => [],
})
runtimeScriptEngine.load({
  formatVersion: 1,
  variables: {},
  events: [{
    id: 'hud-inventory-flow',
    name: 'Abrir inventário via HUD',
    enabled: true,
    trigger: { type: 'global_event', eventId: 'hud.inventory.open' },
    conditions: [],
    actions: [{
      type: 'javascript',
      code: "api.global.set('hud.source', api.event.get('source') ?? 'missing'); api.global.set('hud.screen', api.event.get('screenName') ?? 'missing'); api.global.set('hud.screen_id', api.event.get('screenId') ?? 'missing'); api.global.set('hud.element_id', api.event.get('elementId') ?? 'missing'); api.global.set('hud.element', api.event.get('elementName') ?? 'missing')",
    }],
  }],
  packages: [],
  disabledPackageScripts: [],
})
assert.equal(runtimeScriptEngine.triggerGlobalEvent('hud.inventory.open', {
  source: 'hud',
  screenId: 'screen-adventure',
  screenName: 'HUD de aventura',
  elementId: 'button-inventory',
  elementName: 'Abrir inventário',
}), true)
assert.equal(runtimeScriptEngine.exportData().variables['hud.source'], 'hud')
assert.equal(runtimeScriptEngine.exportData().variables['hud.screen'], 'HUD de aventura')
assert.equal(runtimeScriptEngine.exportData().variables['hud.screen_id'], 'screen-adventure')
assert.equal(runtimeScriptEngine.exportData().variables['hud.element_id'], 'button-inventory')
assert.equal(runtimeScriptEngine.exportData().variables['hud.element'], 'Abrir inventário')
assert.equal(runtimeScriptEngine.triggerGlobalEvent('hud.event.missing'), false)

const visualScriptGraphSource = readFileSync(new URL('../src/components/VisualScriptGraph.vue', import.meta.url), 'utf8')
const editorControllerSource = readFileSync(new URL('../src/composables/useEditor.ts', import.meta.url), 'utf8')
const uiWorkspaceSource = readFileSync(new URL('../src/components/UIWorkspace.vue', import.meta.url), 'utf8')
const appWorkspaceSource = readFileSync(new URL('../src/components/AppWorkspace.vue', import.meta.url), 'utf8')
const gameUIRuntimeSource = readFileSync(new URL('../src/components/GameUIRuntime.vue', import.meta.url), 'utf8')
const runtimeHudSource = readFileSync(new URL('../src/components/RuntimeHUD.vue', import.meta.url), 'utf8')
const editorTopBarSource = readFileSync(new URL('../src/components/EditorTopBar.vue', import.meta.url), 'utf8')
const editorTopBarCssSource = readFileSync(new URL('../src/components/EditorTopBar.css', import.meta.url), 'utf8')
const editorViewportSource = readFileSync(new URL('../src/components/EditorViewport.vue', import.meta.url), 'utf8')
const viewportLayoutSource = readFileSync(new URL('../src/composables/useViewportLayout.ts', import.meta.url), 'utf8')
const viewportEngineSource = readFileSync(new URL('../engine/view/Viewport.ts', import.meta.url), 'utf8')
const viewportRootCssSource = readFileSync(new URL('../src/styles/base/02-viewport-and-status.css', import.meta.url), 'utf8')
const viewportActionsCssSource = readFileSync(new URL('../src/styles/parts/09-viewport-actions.css', import.meta.url), 'utf8')
const sidebarHudCssSource = readFileSync(new URL('../src/styles/parts/10-sidebar-hud.css', import.meta.url), 'utf8')
const viewportRuntimeCssSource = readFileSync(new URL('../src/styles/parts/03-visual-script-runtime.css', import.meta.url), 'utf8')
const viewportPositioningCssSource = readFileSync(new URL('../src/styles/parts/11-viewport-positioning.css', import.meta.url), 'utf8')
const responsiveWorkspaceCssSource = readFileSync(new URL('../src/styles/parts/12-responsive-workspace.css', import.meta.url), 'utf8')
const appStylesAggregatorSource = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const playerWorkspaceSource = readFileSync(new URL('../src/components/PlayerWorkspace.vue', import.meta.url), 'utf8')
const playerSettingsSource = readFileSync(new URL('../engine/player/PlayerSettings.ts', import.meta.url), 'utf8')
const playerAvatarSource = readFileSync(new URL('../engine/world/HumanoidAvatar.ts', import.meta.url), 'utf8')
const playerEngineSource = readFileSync(new URL('../engine/Engine.ts', import.meta.url), 'utf8')
const projectFormatSource = readFileSync(new URL('../engine/project/format.ts', import.meta.url), 'utf8')
const projectValidationSource = readFileSync(new URL('../engine/project/validate.ts', import.meta.url), 'utf8')
const appControllerSource = readFileSync(new URL('../src/composables/useAppController.ts', import.meta.url), 'utf8')
assert.match(visualScriptGraphSource, /@click="createGlobalEvent"/)
assert.match(visualScriptGraphSource, /graphGlobalRules/)
assert.match(visualScriptGraphSource, /Eventos globais · HUD \/ interface/)
assert.match(editorControllerSource, /function addGlobalLogicEvent\(/)
assert.match(editorControllerSource, /ui\.last_event_source/)
assert.match(editorControllerSource, /trigger: \{ type: 'global_event', eventId: cleanEventId \}/)
assert.match(uiWorkspaceSource, /ui-global-script-events/)
assert.match(uiWorkspaceSource, /createGlobalEventForButton/)
assert.match(uiWorkspaceSource, /requestedEventId \|\| undefined/)
assert.match(uiWorkspaceSource, /Já existe um fluxo global/)
assert.match(uiWorkspaceSource, /Criar fluxo global e vincular automaticamente/)
assert.match(appWorkspaceSource, /:create-global-logic-event="ctx\.addGlobalLogicEvent"/)

assert.match(editorTopBarSource, /class="topbar-controls player-workspace-trigger"/)
assert.match(editorTopBarSource, /@click="emit\('open-player-workspace'\)"/)
assert.match(appWorkspaceSource, /<PlayerWorkspace/)
assert.match(appWorkspaceSource, /:player-settings="ctx\.playerSettings"/)
assert.match(appWorkspaceSource, /@update-player-settings="ctx\.setPlayerSettings"/)
assert.match(playerWorkspaceSource, /Visão geral/)
assert.match(playerWorkspaceSource, /Movimento e salto/)
assert.match(playerWorkspaceSource, /Colisor do jogador/)
assert.match(playerWorkspaceSource, /Mapas de controles/)
assert.match(playerWorkspaceSource, /@click="emit\('open-model-import'\)"/)
assert.match(playerWorkspaceSource, /@click="emit\('open-controls'\)"/)
assert.match(playerSettingsSource, /walkSpeed: bounded\(value\?\.walkSpeed, DEFAULT_PLAYER_SETTINGS\.walkSpeed, 0\.5, 15\)/)
assert.match(playerSettingsSource, /colliderRadius: bounded\(value\?\.colliderRadius/)
assert.match(playerAvatarSource, /this\.playerSettings\.walkSpeed/)
assert.match(playerAvatarSource, /this\.playerSettings\.runMultiplier/)
assert.match(playerAvatarSource, /this\.playerSettings\.jumpSpeed/)
assert.match(playerAvatarSource, /this\.playerSettings\.gravity/)
assert.match(playerAvatarSource, /this\.playerSettings\.colliderRadius/)
assert.match(playerEngineSource, /bundle\.project\.settings\.player = \{ \.\.\.this\.playerSettings \}/)
assert.match(playerEngineSource, /this\.playerSettings = sanitizePlayerSettings\(bundle\.project\.settings\.player\)/)
assert.match(playerEngineSource, /async setPlayerModelHeight\(height: number\)/)
assert.match(projectFormatSource, /player\?: PlayerSettings/)
assert.match(projectValidationSource, /player: sanitizePlayerSettings\(playerSettings/)
assert.match(appControllerSource, /playerSettings,\s*setPlayerSettings,\s*setPlayerModelHeight/)

assert.match(appWorkspaceSource, /<Teleport to="\.viewport-hud" defer>[\s\S]*?<EditorToolbar/)
assert.match(editorTopBarSource, /<Teleport to="\.viewport-hud" defer>[\s\S]*?class="viewport-tools-overlay viewport-layout-positioned"/)
assert.match(editorTopBarSource, /class="topbar-fullscreen"[\s\S]*?@click="emit\('toggle-world-fullscreen'\)"/)
assert.doesNotMatch(editorTopBarSource, /hud-settings-toolbar-button|Configurar HUD|toggle-hud-settings/)
assert.match(editorTopBarSource, /class="render-settings"/)
assert.match(editorTopBarSource, /class="topbar-fullscreen"/)
assert.match(viewportRuntimeCssSource, /\.app\.is-running \.viewport-hud \.viewport-tools-overlay,\s*\.app\.is-running \.viewport-hud \.viewport-tools-overlay \* \{\s*pointer-events:auto !important;/)
assert.match(viewportRuntimeCssSource, /\.app\.is-running \.viewport-hud \.viewport-tools-overlay \{\s*z-index:10005 !important;/)
assert.match(editorViewportSource, /<div class="viewport-hud" role="group" aria-label="HUD da viewport">/)
assert.match(editorViewportSource, /<div class="viewport-hud"[\s\S]*?<GameUIRuntime[\s\S]*?<RuntimeHUD[\s\S]*?class="viewport-actions"[\s\S]*?class="viewport-fps viewport-layout-positioned"[\s\S]*?class="chips"[\s\S]*?class="axes viewport-layout-positioned"[\s\S]*?class="statusbar"/)
assert.match(viewportRootCssSource, /\.viewport-hud \{ position:absolute; inset:0;[\s\S]*?pointer-events:none; \}/)
assert.match(viewportRootCssSource, /\.viewport-hud > \* \{ pointer-events:auto; \}/)
assert.match(viewportRootCssSource, /\.viewport-hud > \.statusbar \{ position:absolute !important;/)
assert.match(sidebarHudCssSource, /\.viewport-hud > \.player-hud/)
assert.match(editorTopBarSource, /<Teleport to="\.viewport-hud" defer>/)
assert.match(viewportLayoutSource, /const left = localX\s+const top = localY/)
assert.match(viewportLayoutSource, /compactRenderHud = id === 'render'[\s\S]*?width <= 628/)
assert.match(viewportEngineSource, /continuousRenderRequests >= 4/)
assert.match(viewportEngineSource, /fps: measuredFps/)
assert.match(viewportEngineSource, /continuousRendering,\s*drawCalls: this\.renderer\.info\.render\.calls/)
assert.match(viewportEngineSource, /if \(continuousRendering\) this\.updateDynamicResolution\(fps, now\)/)
assert.match(viewportEngineSource, /this\.dynamicResolutionMultiplier = 1[\s\S]*?this\.applyPixelRatio\(\)[\s\S]*?this\.resize\(\)/)
assert.match(editorControllerSource, /if \(!stats\.continuousRendering\) return/)
assert.match(editorControllerSource, /appliedPerformancePreset = performanceMode\.value === 'auto' \? 'quality' : performanceMode\.value/)
assert.match(editorControllerSource, /value\.continuousRendering \? value\.fps : 0/)
assert.ok(viewportLayoutSource.includes('viewport-layout.v8'))
assert.match(viewportLayoutSource, /function syncViewportLayoutTargets\(\): void/)
assert.match(viewportLayoutSource, /viewportLayoutResizeObserver\.observe\(target\)/)
assert.match(viewportLayoutSource, /viewportLayoutMutationObserver = new MutationObserver/)
assert.match(viewportLayoutSource, /function scheduleViewportLayoutRefresh\(\): void/)
assert.match(viewportLayoutSource, /if \(viewportLayoutRefreshFrame !== 0\) return/)
assert.match(viewportLayoutSource, /new ResizeObserver\(scheduleViewportLayoutRefresh\)/)
assert.match(viewportLayoutSource, /new MutationObserver\(\(\) => \{[\s\S]*?scheduleViewportLayoutRefresh\(\)/)
assert.match(viewportLayoutSource, /function updateViewportLayoutBounds\(rect: DOMRect\): boolean/)
assert.match(viewportLayoutSource, /Math\.abs\(current\.width - rect\.width\) < 0\.5/)
assert.match(viewportLayoutSource, /cancelAnimationFrame\(viewportLayoutRefreshFrame\)/)
assert.match(viewportLayoutSource, /targetRect\.top - rootRect\.top\) \/ usableHeight/)
assert.match(viewportLayoutSource, /const rightGutter = drag\.id === 'render' \? 12 : 4/)
assert.match(viewportLayoutSource, /observedViewportLayoutTargets\.clear\(\)/)
assert.match(viewportLayoutSource, /LEGACY_VIEWPORT_LAYOUT_STORAGE_KEY_V7/)
assert.ok(viewportLayoutSource.includes('result.render.x = 1') && viewportLayoutSource.includes('result.render.y = 0.015'))
assert.match(appWorkspaceSource, /v-if="ctx\.sidebarCollapsed" class="collapsed-sidebar-actions"/)
assert.match(appWorkspaceSource, /collapsed-sidebar-add-trigger/)
assert.match(appWorkspaceSource, /aria-label="Importar modelo 3D"/)
assert.match(sidebarHudCssSource, /\.app\.sidebar-collapsed:not\(\.world-fullscreen\) \.viewport-actions \{\s*display:none !important;/)
assert.match(sidebarHudCssSource, /\.app\.sidebar-collapsed \.collapsed-sidebar-action \{[\s\S]*?width:100%;[\s\S]*?height:34px;/)
assert.match(sidebarHudCssSource, /\.app\.sidebar-collapsed:not\(\.world-fullscreen\) \.collapsed-sidebar-actions \{[\s\S]*?top:98px;[\s\S]*?width:172px;/)
assert.match(sidebarHudCssSource, /\.app\.sidebar-collapsed \.collapsed-sidebar-add-popover \{[\s\S]*?left:0 !important;/)
assert.match(sidebarHudCssSource, /\.app\.sidebar-collapsed \.toolbar \{[\s\S]*?top:128px !important;[\s\S]*?bottom:8px !important;/)
assert.doesNotMatch(sidebarHudCssSource, /\.app\.sidebar-collapsed \.toolbar \{[\s\S]*?padding:132px 7px 10px !important;/)
assert.match(viewportPositioningCssSource, /\.app\.sidebar-collapsed \.toolbar\.viewport-layout-positioned \{[\s\S]*?top: 128px !important;[\s\S]*?max-height: calc\(\(100dvh - 211px\) \/ var\(--viewport-layout-scale, 1\)\) !important;[\s\S]*?padding: 6px 7px 10px !important;[\s\S]*?scrollbar-width: thin !important;/)
assert.match(viewportPositioningCssSource, /\.app\.sidebar-collapsed \.toolbar\.viewport-layout-positioned::\-webkit-scrollbar \{\s*display: block !important;\s*width: 4px !important;/)
assert.ok(viewportActionsCssSource.includes('-webkit-text-fill-color:#f3efe6'))
assert.match(viewportActionsCssSource, /\.viewport-actions \.model-import-launch > \.viewport-action-label \{[\s\S]*?font-size:inherit !important;[\s\S]*?line-height:1 !important;[\s\S]*?font-weight:inherit !important;/)
assert.match(viewportActionsCssSource, /\.viewport-actions \.model-import-launch > span:first-child \{[\s\S]*?font-size:16px !important;[\s\S]*?line-height:1 !important;/)
assert.doesNotMatch(viewportActionsCssSource, /\.viewport-actions \.model-import-launch > \.viewport-action-label \{\s*display:inline !important;/)
assert.match(responsiveWorkspaceCssSource, /@container viewport-hud \(max-width:628px\)[\s\S]*?\.viewport-actions \.model-import-launch > \.viewport-action-label \{\s*display:none !important;/)
assert.match(responsiveWorkspaceCssSource, /\.app \.panel\.left \{[\s\S]*?width:clamp\(150px, 27vw, 180px\) !important;/)
assert.match(responsiveWorkspaceCssSource, /@media\(max-width:640px\)[\s\S]*?width:clamp\(132px, 26vw, 160px\) !important;/)
assert.match(editorTopBarCssSource, /@media\(max-width:760px\)[\s\S]*?\.topbar \.global-search-wrap \{\s*flex:0 1 78px;[\s\S]*?min-width:62px;/)
assert.match(editorTopBarCssSource, /\.topbar \.topbar-controls \{\s*width:30px;[\s\S]*?min-width:30px;/)
assert.ok(appStylesAggregatorSource.includes("@import './parts/12-responsive-workspace.css';"))
assert.match(viewportRootCssSource, /container-type:inline-size; container-name:viewport-hud/)
assert.match(editorTopBarCssSource, /@container viewport-hud \(max-width: 628px\)/)
assert.match(viewportActionsCssSource, /@container viewport-hud \(max-width: 628px\)/)
assert.doesNotMatch(viewportActionsCssSource, /\\n@container/)
assert.match(gameUIRuntimeSource, /source: 'hud'/)
assert.match(gameUIRuntimeSource, /screenId: screen\?\.id/)
assert.match(gameUIRuntimeSource, /screenName: screen\?\.name/)
assert.match(gameUIRuntimeSource, /elementId: element\.id/)
assert.match(gameUIRuntimeSource, /elementName: element\.name/)
assert.match(runtimeHudSource, /removeLegacyDefaultAlquimiaHudLayers\(storedImages\)/)
assert.match(runtimeHudSource, /ALQUIMIA_HUD_MIGRATION_KEY/)
assert.match(gameUIRuntimeSource, /resolveUIValueBindings/)
assert.match(gameUIRuntimeSource, /uiText\(element\.text, element\.variableName\)/)
assert.match(gameUIRuntimeSource, /isUIVisibilityConditionMet/)
assert.match(gameUIRuntimeSource, /nextUIToggleValue\(props\.gameVariables\[variableName\]\)/)
assert.match(gameUIRuntimeSource, /adjustUINumericValue\(props\.gameVariables\[variableName\], element\.variableStep, element\.variableMin, element\.variableLimitMax\)/)
assert.match(uiWorkspaceSource, /selectedElement\.variableMin/)
assert.match(uiWorkspaceSource, /selectedElement\.variableLimitMax/)
assert.match(uiWorkspaceSource, /value="adjust-variable">Ajustar variável numérica/)
assert.match(uiWorkspaceSource, /selectedElement\.variableStep/)
assert.match(uiWorkspaceSource, /value="toggle-variable">Alternar variável booleana/)
assert.match(uiWorkspaceSource, /value="navigate-back">Voltar à tela anterior/)
assert.match(gameUIRuntimeSource, /appendUIScreenHistory\(screenHistory\.value, activeScreenId\.value\)/)
assert.match(gameUIRuntimeSource, /takePreviousUIScreen\(screenHistory\.value/)
assert.match(gameUIRuntimeSource, /element\.action === 'navigate-back'/)
assert.match(uiWorkspaceSource, /element\.action === 'toggle-variable'/)
assert.match(gameUIRuntimeSource, /screen\.visibilityVariable, screen\.visibilityValue, props\.gameVariables/)
assert.match(gameUIRuntimeSource, /screen\.elements\.filter\(isElementVisible\)/)
assert.match(uiWorkspaceSource, /selectedElement\.visibilityVariable/)
assert.match(uiWorkspaceSource, /activeScreen\.visibilityVariable/)

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
  elements: [{ ...screen.elements[0], x: 200, width: 0, color: 'red', opacity: -3, fontWeight: 999, textAlign: 'diagonal', imageFit: 'stretch', variableStep: 2_000_000 }],
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
assert.equal(normalized[0].elements[0].variableStep, 1_000_000)
const normalizedGroup = parseUIScreenDefinitions([{ ...screen, elements: [{ ...screen.elements[0], groupId: '  clean-group  ' }] }])
assert.equal(normalizedGroup[0].elements[0].groupId, 'clean-group')

const legacyElement = { ...screen.elements[0] }
delete legacyElement.opacity
delete legacyElement.fontWeight
delete legacyElement.textAlign
delete legacyElement.imageFit
delete legacyElement.groupId
delete legacyElement.variableStep
const legacyDocument = parseUIScreenDefinitions([{ ...screen, elements: [legacyElement] }])
assert.equal(legacyDocument[0].elements[0].opacity, 1)
assert.equal(legacyDocument[0].elements[0].fontWeight, 600)
assert.equal(legacyDocument[0].elements[0].textAlign, 'center')
assert.equal(legacyDocument[0].elements[0].imageFit, 'contain')
assert.equal(legacyDocument[0].elements[0].groupId, undefined)
assert.equal(legacyDocument[0].elements[0].variableStep, 1)

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
assert.ok(presets[2].elements.some(element => element.kind === 'button' && element.action === 'trigger-event' && element.eventId === 'hud.inventory.open'))

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
assert.deepEqual(getUIElementsBounds(alignSource.slice(0, 2)), { x: 10, y: 20, width: 50, height: 40 })
assert.equal(getUIElementsBounds([]), null)
assert.deepEqual(
  getResizedUIElementRect({ x: 10, y: 20, width: 50, height: 40 }, 'se', 20, 10),
  { x: 10, y: 20, width: 70, height: 50 },
)
assert.deepEqual(
  getResizedUIElementRect({ x: 10, y: 20, width: 50, height: 40 }, 'nw', 10, 5),
  { x: 20, y: 25, width: 40, height: 35 },
)
assert.deepEqual(
  getResizedUIElementRect({ x: 10, y: 20, width: 50, height: 40 }, 'e', 4, 99),
  { x: 10, y: 20, width: 54, height: 40 },
)
assert.deepEqual(
  getResizedUIElementRect({ x: 10, y: 20, width: 50, height: 40 }, 'se', 13, 7, { snapToGrid: true }),
  { x: 10, y: 20, width: 62.5, height: 47.5 },
)
const aspectLocked = getResizedUIElementRect(
  { x: 10, y: 20, width: 50, height: 40 },
  'se',
  20,
  0,
  { preserveAspectRatio: true },
)
assert.deepEqual(aspectLocked, { x: 10, y: 20, width: 70, height: 56 })
assert.equal(aspectLocked.width / aspectLocked.height, 1.25)
assert.deepEqual(
  getResizedUIElementRect({ x: 80, y: 80, width: 15, height: 15 }, 'se', 20, 20),
  { x: 80, y: 80, width: 20, height: 20 },
)
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

const distributionThird = createUIElement('button')
distributionThird.id = 'distribution-third'
Object.assign(distributionThird, { x: 70, y: 70, width: 10, height: 10 })
const distributionSecond = { ...alignSecond, x: 30, y: 35 }
const distributionSource = [alignFirst, distributionSecond, distributionThird, alignUnselected]
const distributionIds = [alignFirst.id, distributionSecond.id, distributionThird.id]
const horizontallyDistributed = distributeUIElements(distributionSource, distributionIds, 'horizontal')
assert.deepEqual(horizontallyDistributed.slice(0, 3).map(element => element.x), [10, 45, 70])
assert.deepEqual(horizontallyDistributed.slice(0, 3).map(element => element.y), [20, 35, 70])
assert.equal(horizontallyDistributed[3], alignUnselected)
const verticallyDistributed = distributeUIElements(distributionSource, distributionIds, 'vertical')
assert.deepEqual(verticallyDistributed.slice(0, 3).map(element => element.y), [20, 40, 70])
assert.deepEqual(verticallyDistributed.slice(0, 3).map(element => element.x), [10, 30, 70])
assert.equal(verticallyDistributed[3], alignUnselected)
assert.equal(distributeUIElements(distributionSource, distributionIds.slice(0, 2), 'horizontal'), distributionSource)
const tooCrowded = distributionSource.slice(0, 3).map((element, index) => ({
  ...element,
  id: 'crowded-' + index,
  x: 10 + index * 5,
  width: 30,
}))
assert.equal(distributeUIElements(tooCrowded, tooCrowded.map(element => element.id), 'horizontal'), tooCrowded)

const gridArranged = distributeUIElementsInGrid(distributionSource, distributionIds, 2, 3, 3)
assert.deepEqual(
  gridArranged.slice(0, 3).map(element => ({ x: element.x, y: element.y })),
  [{ x: 10, y: 25 }, { x: 33, y: 20 }, { x: 15, y: 43 }],
)
assert.equal(gridArranged[3], alignUnselected)
assert.equal(distributeUIElementsInGrid(distributionSource, distributionIds.slice(0, 1), 2), distributionSource)
assert.equal(distributeUIElementsInGrid(distributionSource, distributionIds, 2, 100, 100), distributionSource)
assert.equal(distributeUIElementsInGrid(distributionSource, distributionIds, 2, -1, 0), distributionSource)

const smartAlignment = getUIElementSmartAlignment(
  distributionSource,
  [alignFirst],
  58,
  -8,
  0.8,
)
assert.deepEqual(
  { deltaX: smartAlignment.deltaX, deltaY: smartAlignment.deltaY },
  { deltaX: 58, deltaY: -8 },
)
assert.deepEqual(smartAlignment.guides, [
  { axis: 'vertical', position: 88 },
  { axis: 'horizontal', position: 12 },
])
assert.deepEqual(
  getUIElementSmartAlignment(distributionSource, [alignFirst], 1, 0, 0),
  { deltaX: 1, deltaY: 0, guides: [] },
)

const spacedHorizontally = spaceUIElements(distributionSource, distributionIds, 'horizontal', 5)
assert.deepEqual(spacedHorizontally.slice(0, 3).map(element => element.x), [10, 35, 50])
assert.deepEqual(spacedHorizontally.slice(0, 3).map(element => element.y), [20, 35, 70])
assert.equal(spacedHorizontally[3], alignUnselected)
const spacedVertically = spaceUIElements(distributionSource, distributionIds, 'vertical', 3)
assert.deepEqual(spacedVertically.slice(0, 3).map(element => element.y), [20, 33, 56])
assert.deepEqual(spacedVertically.slice(0, 3).map(element => element.x), [10, 30, 70])
assert.equal(spacedVertically[3], alignUnselected)
assert.equal(spaceUIElements(distributionSource, distributionIds.slice(0, 1), 'horizontal', 5), distributionSource)
assert.equal(spaceUIElements(distributionSource, distributionIds, 'horizontal', -1), distributionSource)
assert.equal(spaceUIElements(distributionSource, distributionIds, 'horizontal', Number.NaN), distributionSource)
assert.equal(spaceUIElements(distributionSource, distributionIds, 'horizontal', 80), distributionSource)

const keyAlignedLeft = alignUIElementsToKey(distributionSource, distributionIds, distributionSecond.id, 'left')
assert.deepEqual(keyAlignedLeft.slice(0, 3).map(element => element.x), [30, 30, 30])
assert.equal(keyAlignedLeft[1], distributionSecond)
assert.equal(keyAlignedLeft[3], alignUnselected)
const keyAlignedCenter = alignUIElementsToKey(distributionSource, distributionIds, distributionSecond.id, 'vertical-center')
assert.deepEqual(keyAlignedCenter.slice(0, 3).map(element => element.y), [40, 35, 40])
assert.equal(keyAlignedCenter[1], distributionSecond)
assert.equal(alignUIElementsToKey(distributionSource, distributionIds, 'missing-key', 'left'), distributionSource)
assert.equal(alignUIElementsToKey(distributionSource, [alignFirst.id], alignFirst.id, 'left'), distributionSource)

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

console.log('UI workspace self-test passed: undo/redo history, marquee selection, bounded/grid-snapped/aspect-locked resizing, multi-element alignment, grid layout, edge/center smart snapping, key-relative alignment, HUD event actions and fixed-gap distribution, persistent grouping metadata, cross-screen clipboard primitives, screen presets, unique IDs, legacy compatibility, appearance settings, assets, snapping, duplication and layers.')
