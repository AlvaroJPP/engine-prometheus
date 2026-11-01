<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  isPlayMode: boolean
  fps: number
  entityCount: number
  memoryUsage: number
  playerHealth: number
  playerMaxHealth: number
  playerStamina: number
  playerMaxStamina: number
  playerMana: number
  playerMaxMana: number
  mountStatus: 'unmounted' | 'mounting' | 'mounted' | 'dismounting'
  mountName: string
}

const props = defineProps<Props>()

// Computed for health percentage
const healthPercent = computed(() =>
  props.playerMaxHealth > 0
    ? (props.playerHealth / props.playerMaxHealth) * 100
    : 0
)

const staminaPercent = computed(() =>
  props.playerMaxStamina > 0
    ? (props.playerStamina / props.playerMaxStamina) * 100
    : 0
)

const manaPercent = computed(() =>
  props.playerMaxMana > 0
    ? (props.playerMana / props.playerMaxMana) * 100
    : 0
)

// Mount status display
const mountStatusText = computed(() => {
  switch (props.mountStatus) {
    case 'mounted': return `Montado: ${props.mountName || 'Montaria'}`
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

// Check if Veilborne stats are available (non-zero max values indicate active module)
const hasVeilborneStats = computed(() =>
  props.playerMaxHealth > 0 || props.playerMaxStamina > 0 || props.playerMaxMana > 0
)
</script>

<template>
  <div
    v-if="props.isPlayMode"
    class="runtime-hud"
    aria-label="Runtime HUD"
  >
    <!-- Top bar: Performance stats -->
    <div class="hud-top-bar">
      <div class="hud-group hud-performance">
        <span class="hud-label">FPS</span>
        <span class="hud-value fps" :class="{ low: props.fps < 30, medium: props.fps >= 30 && props.fps < 55 }">
          {{ props.fps }}
        </span>
        <span class="hud-separator" />
        <span class="hud-label">Entidades</span>
        <span class="hud-value">{{ props.entityCount }}</span>
        <span class="hud-separator" />
        <span class="hud-label">Memória</span>
        <span class="hud-value">{{ props.memoryUsage.toFixed(1) }} MB</span>
      </div>

      <!-- Player stats (only when Veilborne module is active) -->
      <div v-if="hasVeilborneStats" class="hud-group hud-player-stats">
        <div class="stat-bar health">
          <span class="stat-icon" aria-hidden="true">❤</span>
          <div class="stat-bar-track">
            <div
              class="stat-bar-fill"
              :style="{ width: healthPercent + '%' }"
            />
          </div>
          <span class="stat-value">{{ props.playerHealth }} / {{ props.playerMaxHealth }}</span>
        </div>

        <div class="stat-bar stamina">
          <span class="stat-icon" aria-hidden="true">⚡</span>
          <div class="stat-bar-track">
            <div
              class="stat-bar-fill"
              :style="{ width: staminaPercent + '%' }"
            />
          </div>
          <span class="stat-value">{{ props.playerStamina }} / {{ props.playerMaxStamina }}</span>
        </div>

        <div class="stat-bar mana">
          <span class="stat-icon" aria-hidden="true">✦</span>
          <div class="stat-bar-track">
            <div
              class="stat-bar-fill"
              :style="{ width: manaPercent + '%' }"
            />
          </div>
          <span class="stat-value">{{ props.playerMana }} / {{ props.playerMaxMana }}</span>
        </div>
      </div>
    </div>

    <!-- Bottom right: Mount status -->
    <div class="hud-mount-status" :class="mountStatusClass">
      <span class="mount-icon" aria-hidden="true">
        <span v-if="props.mountStatus === 'mounted'">🐎</span>
        <span v-else-if="props.mountStatus === 'mounting'">⏳</span>
        <span v-else-if="props.mountStatus === 'dismounting'">⏳</span>
        <span v-else>👤</span>
      </span>
      <span class="mount-text">{{ mountStatusText }}</span>
    </div>

    <!-- Mode indicator -->
    <div class="hud-mode-indicator">
      <span class="mode-badge play">▶ JOGANDO</span>
      <span class="mode-hint">Pressione Stop ou ESC para sair</span>
    </div>
  </div>
</template>

<style scoped>
.runtime-hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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
  pointer-events: none;
}

.hud-group {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(18, 21, 28, 0.9);
  border: 1px solid #2a303d;
  border-radius: 8px;
  padding: 6px 12px;
  backdrop-filter: blur(4px);
}

.hud-group.hud-performance {
  gap: 12px;
}

.hud-group.hud-player-stats {
  gap: 16px;
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

.hud-value.fps.low {
  color: #e0566f;
}

.hud-value.fps.medium {
  color: #e0b04a;
}

.hud-separator {
  width: 1px;
  height: 16px;
  background: #2a303d;
  margin: 0 4px;
}

/* Player stat bars */
.stat-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
}

.stat-icon {
  font-size: 14px;
  line-height: 1;
}

.stat-bar-track {
  flex: 1;
  height: 6px;
  background: #1a1f29;
  border: 1px solid #2a303d;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.stat-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.1s ease-out;
}

.stat-bar.health .stat-bar-fill {
  background: linear-gradient(90deg, #e0566f, #f0705f);
}

.stat-bar.stamina .stat-bar-fill {
  background: linear-gradient(90deg, #e0b04a, #f0d060);
}

.stat-bar.mana .stat-bar-fill {
  background: linear-gradient(90deg, #6fb7f0, #8fd6f0);
}

.stat-value {
  font-size: 10px;
  color: #8a93a6;
  min-width: 50px;
  text-align: right;
}

/* Mount status */
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

.hud-mount-status.unmounted {
  border-color: #2a303d;
}

.mount-icon {
  font-size: 16px;
  line-height: 1;
}

.mount-text {
  font-size: 11px;
  font-weight: 500;
  color: #d6dae3;
}

.hud-mount-status.mounted .mount-text {
  color: #5bd08a;
}

.hud-mount-status.transitioning .mount-text {
  color: #e0b04a;
}

/* Mode indicator */
.hud-mode-indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
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

.mode-hint {
  font-size: 10px;
  color: #8a93a6;
  text-align: center;
  white-space: nowrap;
}

/* Responsive */
@media (max-width: 768px) {
  .hud-top-bar {
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }

  .hud-group.hud-performance {
    flex-wrap: wrap;
    justify-content: center;
  }

  .hud-group.hud-player-stats {
    flex-wrap: wrap;
    justify-content: center;
  }

  .stat-bar {
    min-width: 120px;
  }

  .hud-mount-status {
    bottom: 70px;
    right: 12px;
    padding: 6px 10px;
  }

  .mount-text {
    font-size: 10px;
  }
}
</style>