import { onMounted, onBeforeUnmount, ref, watch, type Ref } from 'vue'

const WORKSPACE_STORAGE_KEY = 'engine-prometheus.workspace.v1'

interface WorkspaceState {
  sidebarCollapsed: boolean
  inspectorTab: 'transform' | 'color' | 'variables' | 'nodes' | 'packages'
  graphOpen: boolean
  cameraPosition: { x: number; y: number; z: number } | null
  cameraTarget: { x: number; y: number; z: number } | null
  cameraPreset: string
  firstPersonMode: boolean
  renderDistance: number | null
  renderAll: boolean
  performanceMode: boolean
  gridVisible: boolean
  polygonLinesVisible: boolean
  colliderDebugVisible: boolean
  tool: string
  transform: string
}

const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  sidebarCollapsed: false,
  inspectorTab: 'transform',
  graphOpen: false,
  cameraPosition: null,
  cameraTarget: null,
  cameraPreset: 'free',
  firstPersonMode: false,
  renderDistance: null,
  renderAll: false,
  performanceMode: false,
  gridVisible: true,
  polygonLinesVisible: false,
  colliderDebugVisible: false,
  tool: 'select',
  transform: 'move',
}

function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_WORKSPACE_STATE }
    const saved = JSON.parse(raw) as Partial<WorkspaceState>
    return { ...DEFAULT_WORKSPACE_STATE, ...saved }
  } catch {
    return { ...DEFAULT_WORKSPACE_STATE }
  }
}

function saveWorkspaceState(state: WorkspaceState): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

export function useWorkspacePersistence(
  options: {
    sidebarCollapsed: Ref<boolean>
    inspectorTab: Ref<'transform' | 'color' | 'variables' | 'nodes' | 'packages'>
    graphOpen: Ref<boolean>
    executionMode: Ref<'edit' | 'running'>
    // Camera state getters (called when saving)
    getCameraState: () => { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; preset: string } | null
    getFirstPersonMode: () => boolean
    // Editor settings getters
    getRenderDistance: () => number | null
    getRenderAll: () => boolean
    getPerformanceMode: () => boolean
    getGridVisible: () => boolean
    getPolygonLinesVisible: () => boolean
    getColliderDebugVisible: () => boolean
    getTool: () => string
    getTransform: () => string
    // Restore functions (called when loading)
    restoreCameraState: (state: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; preset: string } | null) => void
    restoreFirstPersonMode: (enabled: boolean) => void
    restoreRenderDistance: (distance: number | null) => void
    restoreRenderAll: (value: boolean) => void
    restorePerformanceMode: (value: boolean) => void
    restoreGridVisible: (value: boolean) => void
    restorePolygonLinesVisible: (value: boolean) => void
    restoreColliderDebugVisible: (value: boolean) => void
    restoreTool: (tool: string) => void
    restoreTransform: (transform: string) => void
  }
) {
  const workspaceState = ref<WorkspaceState>(loadWorkspaceState())
  const isRestoring = ref(false)

  // Save workspace state when relevant values change
  function persistWorkspace(): void {
    if (isRestoring.value) return
    const state: WorkspaceState = {
      sidebarCollapsed: options.sidebarCollapsed.value,
      inspectorTab: options.inspectorTab.value,
      graphOpen: options.graphOpen.value,
      cameraPosition: null,
      cameraTarget: null,
      cameraPreset: 'free',
      firstPersonMode: options.getFirstPersonMode(),
      renderDistance: options.getRenderDistance(),
      renderAll: options.getRenderAll(),
      performanceMode: options.getPerformanceMode(),
      gridVisible: options.getGridVisible(),
      polygonLinesVisible: options.getPolygonLinesVisible(),
      colliderDebugVisible: options.getColliderDebugVisible(),
      tool: options.getTool(),
      transform: options.getTransform(),
    }

    // Capture camera state
    const cameraState = options.getCameraState()
    if (cameraState) {
      state.cameraPosition = cameraState.position
      state.cameraTarget = cameraState.target
      state.cameraPreset = cameraState.preset
    }

    workspaceState.value = state
    saveWorkspaceState(state)
  }

  // Restore workspace state on mount
  function restoreWorkspace(): void {
    isRestoring.value = true
    const state = workspaceState.value

    // Restore UI state
    options.sidebarCollapsed.value = state.sidebarCollapsed
    options.inspectorTab.value = state.inspectorTab
    options.graphOpen.value = state.graphOpen

    // Restore camera state
    if (state.cameraPosition && state.cameraTarget) {
      options.restoreCameraState({
        position: state.cameraPosition,
        target: state.cameraTarget,
        preset: state.cameraPreset,
      })
    }
    options.restoreFirstPersonMode(state.firstPersonMode)

    // Restore editor settings
    options.restoreRenderDistance(state.renderDistance)
    options.restoreRenderAll(state.renderAll)
    options.restorePerformanceMode(state.performanceMode)
    options.restoreGridVisible(state.gridVisible)
    options.restorePolygonLinesVisible(state.polygonLinesVisible)
    options.restoreColliderDebugVisible(state.colliderDebugVisible)
    options.restoreTool(state.tool)
    options.restoreTransform(state.transform)

    isRestoring.value = false
  }

  // Watch for changes to persist
  watch(
    [
      options.sidebarCollapsed,
      options.inspectorTab,
      options.graphOpen,
      options.executionMode,
    ],
    () => {
      // Debounce persistence
      setTimeout(persistWorkspace, 100)
    },
    { deep: true }
  )

  // Also persist camera changes periodically
  let cameraPersistTimer: number | null = null
  function scheduleCameraPersist(): void {
    if (cameraPersistTimer) return
    cameraPersistTimer = window.setTimeout(() => {
      cameraPersistTimer = null
      persistWorkspace()
    }, 500)
  }

  onMounted(() => {
    // Restore workspace state on mount
    restoreWorkspace()

    // Schedule periodic camera persistence
    const interval = window.setInterval(scheduleCameraPersist, 2000)
    onBeforeUnmount(() => {
      window.clearInterval(interval)
      persistWorkspace() // Final save on unmount
    })
  })

  return {
    workspaceState,
    persistWorkspace,
    restoreWorkspace,
  }
}