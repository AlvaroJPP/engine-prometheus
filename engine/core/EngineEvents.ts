/**
 * Tipos de eventos centralizados para o núcleo do Engine Prometheus.
 *
 * Define o contrato de eventos entre subsistemas, módulos e a engine principal.
 * Usado pelo EventBus para type-safe event emission.
 */

import type { EngineGameModule } from '../runtime/GameModule'
import type { World } from '../world/World'
import type { Entity } from '../model/entity/Entity'
import type { Subsystem } from './Subsystem'
import type { Camera } from '../subsystems/RenderSubsystem'
import type { RenderStats } from '../subsystems/RenderSubsystem'
import type { RuntimeMode } from './EngineConfig'
import type { EngineConfig } from './EngineConfig'
import * as THREE from 'three'

/**
 * Mapa de eventos do núcleo da Engine.
 * Cada chave é o nome do evento e o valor é o payload tipado.
 */
export interface EngineEventMap {
  // --- Engine Lifecycle ---
  /** Emitido quando a engine está sendo inicializada */
  'engine:init': { timestamp: number }
  /** Emitido quando a engine inicia execução (após init) */
  'engine:start': { timestamp: number }
  /** Emitido quando a engine para execução */
  'engine:stop': { timestamp: number; reason?: string }
  /** Emitido quando a engine é descartada (cleanup final) */
  'engine:dispose': { timestamp: number }
  /** Emitido antes do render */
  'engine:beforeRender': { deltaTime: number; time: number }
  /** Emitido após o render */
  'engine:afterRender': { deltaTime: number; time: number }
  /** Emitido a cada frame do engine */
  'engine:frame': { deltaTime: number; time: number; frameId: number }
  /** Emitido quando o modo de runtime muda */
  'engine:runtimeModeChanged': { from: RuntimeMode; to: RuntimeMode }
  /** Emitido quando um subsistema é registrado */
  'engine:subsystemRegistered': { name: string; subsystem: Subsystem }
  /** Emitido quando um subsistema é desregistrado */
  'engine:subsystemUnregistered': { name: string }
  /** Emitido em caso de erro na engine */
  'engine:error': { error: Error; timestamp: number }

  // --- World Lifecycle ---
  /** Emitido quando um novo mundo é criado */
  'world:created': { worldId: string; timestamp: number }
  /** Emitido quando um mundo é descartado */
  'world:disposed': { worldId: string; timestamp: number }
  /** Emitido quando o mundo é resetado (novo projeto, clear) */
  'world:reset': { objectCount: number; timestamp: number }
  /** Emitido quando uma entidade é adicionada ao mundo */
  'world:entityAdded': { entity: Entity; timestamp: number }
  /** Emitido quando uma entidade é removida do mundo */
  'world:entityRemoved': { entity: Entity; timestamp: number }

  // --- Physics ---
  /** Emitido a cada step de física (fixed timestep) */
  'physics:stepped': { deltaTime: number; timestamp: number }
  /** Emitido quando colisão começa */
  'physics:collision:start': { bodyA: string; bodyB: string; contactPoint: { x: number; y: number; z: number } }
  /** Emitido quando colisão termina */
  'physics:collision:end': { bodyA: string; bodyB: string }

  // --- Render ---
  /** Emitido a cada frame de renderização */
  'render:frame': { deltaTime: number; timestamp: number; frameId: number }
  /** Emitido quando o viewport precisa ser invalidado */
  'render:invalidate': { reason?: string }
  /** Emitido antes do render (para preparar shaders, etc) */
  'render:pre': { timestamp: number }
  /** Emitido após o render */
  'render:post': { timestamp: number; stats: { drawCalls: number; triangles: number; frameTime: number } }
  /** Emitido quando o viewport é redimensionado */
  'render:viewportResize': { width: number; height: number }
  /** Emitido quando a câmera muda */
  'render:cameraChanged': { camera: Camera }
  /** Emitido com estatísticas de render */
  'render:stats': { stats: RenderStats }

  // --- Module System ---
  /** Emitido quando um módulo é registrado */
  'module:registered': { module: EngineGameModule; timestamp: number }
  /** Emitido quando um módulo inicia (onRuntimeStart) */
  'module:started': { moduleId: string; timestamp: number }
  /** Emitido quando um módulo para (onRuntimeStop) */
  'module:stopped': { moduleId: string; timestamp: number }
  /** Emitido quando um módulo reporta erro */
  'module:error': { moduleId: string; error: Error; timestamp: number }
  /** Emitido quando um módulo é descartado */
  'module:disposed': { moduleId: string; timestamp: number }

  // --- Input ---
  /** Evento de ponteiro (mouse, touch, pen) */
  'input:pointer': {
    type: 'down' | 'up' | 'move' | 'wheel'
    button: number
    x: number
    y: number
    pressure: number
    target: EventTarget | null
    timestamp: number
  }
  /** Evento de ponteiro down */
  'input:pointerDown': { event: PointerEvent; timestamp: number }
  /** Evento de ponteiro up */
  'input:pointerUp': { event: PointerEvent; timestamp: number }
  /** Evento de ponteiro move */
  'input:pointerMove': { event: PointerEvent; timestamp: number }
  /** Evento de tecla down */
  'input:keyDown': { event: KeyboardEvent; timestamp: number }
  /** Evento de tecla up */
  'input:keyUp': { event: KeyboardEvent; timestamp: number }
  /** Evento de roda do mouse */
  'input:wheel': { event: WheelEvent; timestamp: number }
  /** Evento de teclado (legacy) */
  'input:keyboard': {
    type: 'down' | 'up'
    code: string
    key: string
    repeat: boolean
    timestamp: number
  }
  /** Evento de gamepad */
  'input:gamepad': {
    index: number
    button: number
    pressed: boolean
    value: number
    timestamp: number
  }
  /** Foco perdido/restaurado */
  'input:focus': { focused: boolean; timestamp: number }
  /** Transform controls changed */
  'input:transformChange': { object: THREE.Object3D | null; timestamp: number }

  // --- Scripting / Logic ---
  /** Gatilho de evento de script (player event, package event, etc) */
  'script:trigger': { eventId: string; scope: 'player' | 'package' | 'global'; payload: Record<string, unknown>; timestamp: number }
  /** Variável de script alterada */
  'script:variable-changed': { name: string; value: boolean | number | string; scopeId?: string; timestamp: number }
  /** Regra de lógica adicionada/removida/modificada */
  'script:rule-changed': { action: 'added' | 'removed' | 'updated'; ruleId: string; timestamp: number }
  /** Pacote de comportamento instalado/removido/atualizado */
  'script:package-changed': { action: 'installed' | 'removed' | 'updated'; packageId: string; ownerObjectId: string; timestamp: number }

  // --- Objects / Entities ---
  /** Objeto adicionado ao mundo */
  'object:added': { id: string; type: string; timestamp: number }
  /** Objeto removido do mundo */
  'object:removed': { id: string; timestamp: number }
  /** Objeto renomeado */
  'object:renamed': { id: string; name: string; timestamp: number }
  /** Objeto modificado (transform, props, etc) */
  'object:changed': { id: string; changes: string[]; timestamp: number }
  /** Seleção alterada */
  'selection:changed': { id: string | null; timestamp: number }

  // --- Camera / Viewport ---
  /** Preset de câmera alterado */
  'camera:changed': { preset: string; previousPreset: string; timestamp: number }
  /** Alvo da câmera alterado */
  'camera:target-changed': { x: number; y: number; z: number; timestamp: number }
  /** Modo primeira pessoa alterado */
  'camera:first-person': { enabled: boolean; timestamp: number }

  // --- Terrain / Environment ---
  /** Terreno modificado */
  'terrain:changed': { edits: number; timestamp: number }
  /** Ambiente alterado (sky, time, fog) */
  'environment:changed': { key: string; value: unknown; timestamp: number }

  // --- Asset / Resource ---
  /** Asset carregado */
  'asset:loaded': { id: string; type: string; timestamp: number }
  /** Asset descarregado */
  'asset:unloaded': { id: string; timestamp: number }
  /** Erro ao carregar asset */
  'asset:error': { id: string; error: Error; timestamp: number }

  // --- UI / Editor ---
  /** Ferramenta alterada no editor */
  'editor:tool-changed': { tool: string; transform: string; timestamp: number }
  /** Workspace/painel alterado */
  'editor:workspace-changed': { workspaceId: string; timestamp: number }
  /** Projeto salvo/carregado */
  'editor:project-changed': { action: 'saved' | 'loaded' | 'new'; projectName: string; timestamp: number }
  /** Undo/Redo */
  'editor:history-changed': { action: 'undo' | 'redo' | 'clear'; timestamp: number }

  // --- Debug / Diagnostics ---
  /** Log de debug estruturado */
  'debug:log': { level: 'info' | 'warn' | 'error'; message: string; context?: Record<string, unknown>; timestamp: number }
  /** Métrica de performance */
  'debug:metric': { name: string; value: number; unit: string; timestamp: number }
}

/**
 * Tipo utilitário para extrair o payload de um evento pelo nome.
 */
export type EngineEventPayload<K extends keyof EngineEventMap> = EngineEventMap[K]

/**
 * Interface para o barramento de eventos da Engine.
 * Estende o padrão do EventBus existente com tipagem EngineEventMap.
 */
export interface EngineEventBus {
  /**
   * Registra um listener para um evento.
   * Retorna função de unsubscribe.
   */
  on<K extends keyof EngineEventMap>(
    type: K,
    listener: (payload: EngineEventPayload<K>) => void
  ): () => void

  /**
   * Registra um listener que executa apenas uma vez.
   */
  once<K extends keyof EngineEventMap>(
    type: K,
    listener: (payload: EngineEventPayload<K>) => void
  ): () => void

  /**
   * Emite um evento para todos os listeners.
   */
  emit<K extends keyof EngineEventMap>(type: K, payload: EngineEventPayload<K>): void

  /**
   * Retorna o número de listeners para um evento.
   */
  listenerCount<K extends keyof EngineEventMap>(type: K): number

  /**
   * Remove listeners (todos ou de um evento específico).
   */
  clear<K extends keyof EngineEventMap>(type?: K): void
}

/**
 * Cria um EventBus tipado para EngineEventMap.
 * Wrapper sobre o EventBus existente para compatibilidade.
 */
export async function createEngineEventBus(): Promise<EngineEventBus> {
  // Importação dinâmica para evitar dependência circular
  const { EventBus } = await import('../world/events/EventBus')
  return new EventBus<EngineEventMap>()
}

/**
 * Nomes de eventos como constantes para evitar typos.
 */
export const EngineEvents = {
  // Engine
  INIT: 'engine:init' as const,
  START: 'engine:start' as const,
  STOP: 'engine:stop' as const,
  DISPOSE: 'engine:dispose' as const,
  BEFORE_RENDER: 'engine:beforeRender' as const,
  AFTER_RENDER: 'engine:afterRender' as const,
  FRAME: 'engine:frame' as const,
  RUNTIME_MODE_CHANGED: 'engine:runtimeModeChanged' as const,
  SUBSYSTEM_REGISTERED: 'engine:subsystemRegistered' as const,
  SUBSYSTEM_UNREGISTERED: 'engine:subsystemUnregistered' as const,
  ERROR: 'engine:error' as const,
  VIEWPORT_RESIZE: 'render:viewportResize' as const,

  // World
  WORLD_CREATED: 'world:created' as const,
  WORLD_DISPOSED: 'world:disposed' as const,
  WORLD_RESET: 'world:reset' as const,
  WORLD_ENTITY_ADDED: 'world:entityAdded' as const,
  WORLD_ENTITY_REMOVED: 'world:entityRemoved' as const,

  // Physics
  PHYSICS_STEPPED: 'physics:stepped' as const,
  PHYSICS_COLLISION_START: 'physics:collision:start' as const,
  PHYSICS_COLLISION_END: 'physics:collision:end' as const,

  // Render
  RENDER_FRAME: 'render:frame' as const,
  RENDER_INVALIDATE: 'render:invalidate' as const,
  RENDER_PRE: 'render:pre' as const,
  RENDER_POST: 'render:post' as const,
  RENDER_VIEWPORT_RESIZE: 'render:viewportResize' as const,
  RENDER_CAMERA_CHANGED: 'render:cameraChanged' as const,
  RENDER_STATS: 'render:stats' as const,

  // Modules
  MODULE_REGISTERED: 'module:registered' as const,
  MODULE_STARTED: 'module:started' as const,
  MODULE_STOPPED: 'module:stopped' as const,
  MODULE_ERROR: 'module:error' as const,
  MODULE_DISPOSED: 'module:disposed' as const,

  // Input
  INPUT_POINTER: 'input:pointer' as const,
  INPUT_POINTER_DOWN: 'input:pointerDown' as const,
  INPUT_POINTER_UP: 'input:pointerUp' as const,
  INPUT_POINTER_MOVE: 'input:pointerMove' as const,
  INPUT_KEY_DOWN: 'input:keyDown' as const,
  INPUT_KEY_UP: 'input:keyUp' as const,
  INPUT_WHEEL: 'input:wheel' as const,
  INPUT_KEYBOARD: 'input:keyboard' as const,
  INPUT_GAMEPAD: 'input:gamepad' as const,
  INPUT_FOCUS: 'input:focus' as const,
  INPUT_TRANSFORM_CHANGE: 'input:transformChange' as const,

  // Script
  SCRIPT_TRIGGER: 'script:trigger' as const,
  SCRIPT_VARIABLE_CHANGED: 'script:variable-changed' as const,
  SCRIPT_RULE_CHANGED: 'script:rule-changed' as const,
  SCRIPT_PACKAGE_CHANGED: 'script:package-changed' as const,

  // Objects
  OBJECT_ADDED: 'object:added' as const,
  OBJECT_REMOVED: 'object:removed' as const,
  OBJECT_RENAMED: 'object:renamed' as const,
  OBJECT_CHANGED: 'object:changed' as const,
  SELECTION_CHANGED: 'selection:changed' as const,

  // Camera
  CAMERA_CHANGED: 'camera:changed' as const,
  CAMERA_TARGET_CHANGED: 'camera:target-changed' as const,
  CAMERA_FIRST_PERSON: 'camera:first-person' as const,

  // Terrain
  TERRAIN_CHANGED: 'terrain:changed' as const,
  ENVIRONMENT_CHANGED: 'environment:changed' as const,

  // Assets
  ASSET_LOADED: 'asset:loaded' as const,
  ASSET_UNLOADED: 'asset:unloaded' as const,
  ASSET_ERROR: 'asset:error' as const,

  // Editor
  EDITOR_TOOL_CHANGED: 'editor:tool-changed' as const,
  EDITOR_WORKSPACE_CHANGED: 'editor:workspace-changed' as const,
  EDITOR_PROJECT_CHANGED: 'editor:project-changed' as const,
  EDITOR_HISTORY_CHANGED: 'editor:history-changed' as const,

  // Debug
  DEBUG_LOG: 'debug:log' as const,
  DEBUG_METRIC: 'debug:metric' as const,
} as const