<script setup lang="ts">
defineProps<{
  projectName: string
  dirty: boolean
  cameraLabel: string
  firstPersonMode: boolean
  grassRenderDistance: number
  grassRenderAll: boolean
}>()

const emit = defineEmits<{
  'update:projectName': [value: string]
  'mark-dirty': []
  'new-project': []
  'open-project': []
  'save-project': [saveAs: boolean]
  'cycle-camera': []
  'toggle-first-person': []
  'grass-render-distance-change': [value: number]
  'grass-render-all-change': [value: boolean]
}>()
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <div class="logo">P</div>
      <div>
        <div class="title">ENGINE PROMETHEUS</div>
        <div class="subtitle">WORLD EDITOR · PROTOTYPE</div>
      </div>
    </div>

    <div class="project">
      <input :value="projectName" class="pname" spellcheck="false" @input="emit('update:projectName', ($event.target as HTMLInputElement).value); emit('mark-dirty')" />
      <i class="dot" :class="dirty ? 'warn' : 'ok'" :title="dirty ? 'Alterações não salvas' : 'Tudo salvo'" />
    </div>

    <div class="grow" />

    <div class="filebtns">
      <button class="ghost" @click="emit('new-project')">Novo</button>
      <button class="ghost" @click="emit('open-project')">Abrir</button>
      <button class="ghost" @click="emit('save-project', false)">Salvar</button>
      <button class="ghost hide-narrow" @click="emit('save-project', true)">Salvar como…</button>
    </div>

    <details class="render-settings">
      <summary class="cam render-settings-trigger" :class="{ active: grassRenderAll }" title="Configurar alcance de renderização da grama">
        <span class="render-settings-icon">◉</span>
        {{ grassRenderAll ? 'Grama · Tudo' : 'Grama' }}
        <span class="render-settings-chevron">▾</span>
      </summary>
      <div class="render-settings-popover">
        <div class="render-settings-heading">Renderização da grama</div>
        <p class="render-settings-description">Defina a distância máxima a partir do jogador ou da câmera do editor.</p>

        <label class="render-settings-field">
          <span>Alcance máximo</span>
          <span class="render-settings-number-wrap">
            <input
              type="number"
              min="10"
              max="5000"
              step="1"
              :value="grassRenderDistance"
              :disabled="grassRenderAll"
              aria-label="Alcance máximo da grama em unidades"
              @change="emit('grass-render-distance-change', Number(($event.target as HTMLInputElement).value))"
            />
            <small>un.</small>
          </span>
        </label>

        <input
          class="render-settings-range"
          type="range"
          min="10"
          max="500"
          step="1"
          :value="Math.min(grassRenderDistance, 500)"
          :disabled="grassRenderAll"
          aria-label="Ajuste rápido do alcance da grama"
          @input="emit('grass-render-distance-change', Number(($event.target as HTMLInputElement).value))"
        />
        <div class="render-settings-range-labels"><span>10 unidades</span><span>500 unidades</span></div>

        <label class="render-settings-everything">
          <input
            type="checkbox"
            :checked="grassRenderAll"
            @change="emit('grass-render-all-change', ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>Renderizar tudo</strong>
            <small>Ignora a distância máxima e inclui toda a grama do mapa.</small>
          </span>
        </label>

        <p class="render-settings-note">Quanto maior o alcance, maior o custo de renderização. A qualidade diminui gradualmente nos anéis mais distantes.</p>
      </div>
    </details>

    <button class="cam" :class="{ active: firstPersonMode }" @click="emit('toggle-first-person')">{{ firstPersonMode ? 'Sair 1ª pessoa' : '1ª pessoa' }}</button>
    <button class="cam" @click="emit('cycle-camera')"><i class="cam-ring" />{{ cameraLabel }}</button>
  </header>
</template>

<style scoped>
.render-settings {
  position: relative;
  flex: none;
}
.render-settings > summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.render-settings > summary::-webkit-details-marker {
  display: none;
}
.render-settings-trigger.active {
  background: #244231;
  border-color: #387653;
  color: #baf0cb;
}
.render-settings-icon {
  font-size: 13px;
}
.render-settings-chevron {
  opacity: 0.72;
  font-size: 10px;
  margin-left: 2px;
}
.render-settings-popover {
  position: absolute;
  z-index: 200;
  top: calc(100% + 7px);
  right: 0;
  width: min(330px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 14px;
  border: 1px solid var(--line, #242a35);
  border-radius: 7px;
  background: var(--panel, #161a22);
  color: var(--text, #d6dae3);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.42);
}
.render-settings-heading {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.025em;
}
.render-settings-description,
.render-settings-note {
  margin: 7px 0 12px;
  color: var(--muted, #8a93a6);
  font-size: 11px;
  line-height: 1.5;
}
.render-settings-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  font-weight: 600;
}
.render-settings-number-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.render-settings-number-wrap input {
  width: 88px;
  box-sizing: border-box;
  padding: 6px 7px;
  border: 1px solid var(--line, #242a35);
  border-radius: 4px;
  color: var(--text, #d6dae3);
  background: #10131a;
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.render-settings-number-wrap small {
  color: var(--muted, #8a93a6);
  font-size: 10px;
}
.render-settings-range {
  display: block;
  width: 100%;
  margin: 12px 0 2px;
  accent-color: var(--accent, #c5533f);
}
.render-settings-range-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted, #8a93a6);
  font-size: 9px;
}
.render-settings-everything {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  padding: 10px;
  border: 1px solid var(--line, #242a35);
  border-radius: 5px;
  background: var(--panel-2, #1a1f29);
  cursor: pointer;
}
.render-settings-everything input {
  margin-top: 2px;
  accent-color: #5bd08a;
}
.render-settings-everything span {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.render-settings-everything strong {
  font-size: 11px;
}
.render-settings-everything small {
  color: var(--muted, #8a93a6);
  font-size: 10px;
  line-height: 1.45;
}
.render-settings-note {
  margin-bottom: 0;
}
.render-settings-popover input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
