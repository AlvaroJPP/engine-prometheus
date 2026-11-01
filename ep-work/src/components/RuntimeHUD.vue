<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  isPlayMode: boolean
  fps: number
  entityCount: number
  mountStatus: 'unmounted' | 'mounting' | 'mounted' | 'dismounting'
  mountName: string
}

const props = defineProps<Props>()

const mountStatusText = computed(() => {
  switch (props.mountStatus) {
    case 'mounted': return `Montado: ${props.mountName || 'Objeto'}`
    case 'mounting': return 'Montando...'
    case 'dismounting': return 'Desmontando...'
    default: return 'A pé'
  }
})

const mountStatusClass = computed(() => {
  switch (props.mountStatus) {
    case 'mounted': return 'mounted'
    case 'mounting':
    case 'dismounting': return 'transitioning'
    default: return 'unmounted'
  }
})
</script>

<template>
  <div v-if="props.isPlayMode" class="runtime-hud" aria-label="Runtime HUD">
    <div class="hud-top-bar">
      <div class="hud-group hud-performance">
        <span class="hud-label">FPS</span>
        <span class="hud-value fps" :class="{ low: props.fps < 30, medium: props.fps >= 30 && props.fps < 55 }">
          {{ props.fps }}
        </span>
        <span class="hud-separator" />
        <span class="hud-label">Entidades</span>
        <span class="hud-value">{{ props.entityCount }}</span>
      </div>
    </div>

    <div class="hud-mount-status" :class="mountStatusClass">
      <span class="mount-icon" aria-hidden="true">↗</span>
      <span class="mount-text">{{ mountStatusText }}</span>
    </div>

    <div class="hud-mode-indicator">
      <span class="mode-badge play">▶ JOGANDO</span>
      <span class="mode-hint">Pressione Stop ou ESC para sair</span>
    </div>
  </div>
</template>

<style scoped>
.runtime-hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
}

.hud-top-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  gap: 24px;
}

.hud-group {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(18, 21, 28, 0.9);
  border: 1px solid #2a303d;
  border-radius: 8px;
  padding: 6px 12px;
  backdrop-filter: blur(4px);
}

.hud-label {
  font-size: 10px;
  color: #8a93a6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hud-value {
  font-size: 12px;
  font-weight: 600;
  color: #d6dae3;
}

.hud-value.fps.low { color: #e0566f; }
.hud-value.fps.medium { color: #e0b04a; }

.hud-separator {
  width: 1px;
  height: 16px;
  background: #2a303d;
  margin: 0 4px;
}

.hud-mount-status {
  position: absolute;
  bottom: 80px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(18, 21, 28, 0.9);
  border: 1px solid #2a303d;
  border-radius: 8px;
  padding: 8px 14px;
  backdrop-filter: blur(4px);
  transition: all 0.2s ease;
}

.hud-mount-status.mounted {
  border-color: #5bd08a;
  box-shadow: 0 0 12px rgba(91, 208, 138, 0.3);
}

.hud-mount-status.transitioning {
  border-color: #e0b04a;
  box-shadow: 0 0 12px rgba(224, 176, 74, 0.3);
}

.mount-icon { font-size: 16px; line-height: 1; }
.mount-text { font-size: 11px; font-weight: 500; color: #d6dae3; }
.hud-mount-status.mounted .mount-text { color: #5bd08a; }
.hud-mount-status.transitioning .mount-text { color: #e0b04a; }

.hud-mode-indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #c5533f, #a4443a);
  color: #fff;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  box-shadow: 0 4px 16px rgba(197, 83, 63, 0.4);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 4px 16px rgba(197, 83, 63, 0.4); }
  50% { box-shadow: 0 4px 24px rgba(197, 83, 63, 0.6); }
}

.mode-hint { font-size: 10px; color: #8a93a6; text-align: center; white-space: nowrap; }

@media (max-width: 768px) {
  .hud-top-bar { flex-direction: column; gap: 8px; align-items: center; }
  .hud-group.hud-performance { flex-wrap: wrap; justify-content: center; }
  .hud-mount-status { bottom: 70px; right: 12px; padding: 6px 10px; }
  .mount-text { font-size: 10px; }
}
</style>
