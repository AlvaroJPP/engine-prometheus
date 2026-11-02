<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditor } from '@editor/composables/useEditor'

const canvas = ref<HTMLCanvasElement | null>(null)
const {
  projectName, dirty, status, fps, objects, selectedId, tool, transform, gridVisible,
  engineInstance, isPlayMode, setTool, setTransform, addPrimitive, selectItem,
  toggleVisible, toggleGrid, removeSelected, markDirty, newProject, openProject,
  saveProject, enterPlayMode, exitPlayMode,
} = useEditor(canvas)

const selectedObject = computed(() => objects.value.find(object => object.id === selectedId.value))
const engineReady = computed(() => Boolean(engineInstance.value))
const formattedFps = computed(() => Math.round(fps.value))
const objectCount = computed(() => objects.value.length)

function updateProjectName(value: string) {
  projectName.value = value
  markDirty()
}
</script>

<template>
  <main class="editor-shell" :class="{ 'is-running': isPlayMode }" data-testid="editor-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span>P</span></div>
        <div class="brand-copy"><strong>Prometheus</strong><small>ENGINE EDITOR</small></div>
      </div>
      <div class="project-control">
        <span class="project-label">PROJETO</span>
        <input :value="projectName" aria-label="Nome do projeto" maxlength="64" spellcheck="false"
          @change="updateProjectName(($event.target as HTMLInputElement).value)" />
        <span v-if="dirty" class="dirty-indicator" title="Existem alterações não salvas">●</span>
      </div>
      <nav class="project-actions" aria-label="Ações do projeto">
        <button type="button" class="quiet-button" @click="newProject">Novo</button>
        <button type="button" class="quiet-button" @click="openProject">Abrir</button>
        <button type="button" class="quiet-button save-button" @click="saveProject()">Salvar</button>
      </nav>
      <div class="topbar-separator" aria-hidden="true"></div>
      <button type="button" class="run-button" :class="{ active: isPlayMode }"
        :aria-label="isPlayMode ? 'Parar execução' : 'Executar projeto'"
        @click="isPlayMode ? exitPlayMode() : enterPlayMode()">
        <span aria-hidden="true">{{ isPlayMode ? '■' : '▶' }}</span>{{ isPlayMode ? 'Parar' : 'Executar' }}
      </button>
    </header>

    <aside class="scene-panel panel">
      <div class="panel-heading">
        <div><span class="eyebrow">WORKSPACE</span><h2>Cena</h2></div>
        <span class="count-badge">{{ objectCount }}</span>
      </div>
      <div class="panel-tabs" aria-label="Seções da cena">
        <span class="tab active">Hierarquia</span><span class="tab muted">Recursos</span>
      </div>
      <div class="scene-toolbar">
        <span>OBJETOS DA CENA</span>
        <button type="button" aria-label="Adicionar cubo" title="Adicionar cubo" @click="addPrimitive('cube')">＋</button>
      </div>
      <div class="scene-list" role="list" aria-label="Objetos da cena">
        <button v-for="object in objects" :key="object.id" type="button" role="listitem"
          class="scene-object" :class="{ selected: selectedId === object.id }"
          :data-testid="'scene-object-' + object.id" @click="selectItem(object.id)">
          <span class="object-kind" aria-hidden="true">{{ object.type === 'cube' ? '◇' : object.type === 'platform' ? '▱' : '◈' }}</span>
          <span class="object-name">{{ object.name }}</span>
          <span class="object-visibility" :class="{ hidden: !object.visible }"
            @click.stop="toggleVisible(object.id)">{{ object.visible ? '◉' : '○' }}</span>
        </button>
        <div v-if="objects.length === 0" class="empty-scene">
          <span class="empty-icon">◇</span><strong>Nenhum objeto ainda</strong>
          <p>Adicione um objeto para começar a montar sua cena.</p>
          <button type="button" @click="addPrimitive('cube')">Adicionar cubo</button>
        </div>
      </div>
      <div class="scene-panel-footer">
        <button type="button" class="secondary-button" @click="addPrimitive('cube')">＋ Cubo</button>
        <button type="button" class="secondary-button" @click="addPrimitive('platform')">＋ Plataforma</button>
      </div>
    </aside>

    <section class="viewport-panel" aria-label="Viewport 3D">
      <div class="viewport-toolbar">
        <div class="tool-group" aria-label="Ferramentas">
          <button type="button" :class="{ active: tool === 'select' }" aria-label="Selecionar" title="Selecionar (Q)" @click="setTool('select')">↖</button>
          <button type="button" :class="{ active: tool === 'build' }" aria-label="Construir" title="Construir (B)" @click="setTool('build')">＋</button>
          <button type="button" :class="{ active: tool === 'terrain' }" aria-label="Terreno" title="Terreno (T)" @click="setTool('terrain')">⌁</button>
        </div>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="tool-group" aria-label="Transformação">
          <button type="button" :class="{ active: transform === 'move' }" aria-label="Mover" title="Mover (W)" @click="setTransform('move')">✥</button>
          <button type="button" :class="{ active: transform === 'rotate' }" aria-label="Rotacionar" title="Rotacionar (E)" @click="setTransform('rotate')">⟳</button>
          <button type="button" :class="{ active: transform === 'scale' }" aria-label="Escalar" title="Escalar (R)" @click="setTransform('scale')">⤢</button>
        </div>
        <div class="viewport-toolbar-spacer"></div>
        <span class="viewport-caption">PERSPECTIVA 3D</span>
        <button type="button" class="grid-toggle" :class="{ active: gridVisible }" :aria-pressed="gridVisible" @click="toggleGrid">
          {{ gridVisible ? 'Grade ligada' : 'Grade desligada' }}
        </button>
      </div>
      <div class="viewport-stage">
        <canvas ref="canvas" class="engine-canvas" data-testid="engine-canvas" aria-label="Área de renderização 3D"></canvas>
        <div class="viewport-corner-label">SCENE VIEW <span>·</span> EDIT MODE</div>
        <div v-if="!engineReady" class="engine-loading" role="status">Inicializando o motor 3D…</div>
      </div>
      <footer class="viewport-footer">
        <span><i class="status-dot" :class="{ online: engineReady }"></i>{{ engineReady ? 'ENGINE ONLINE' : 'INICIALIZANDO ENGINE' }}</span>
        <span>{{ objectCount }} {{ objectCount === 1 ? 'objeto' : 'objetos' }}</span>
        <span>{{ formattedFps }} FPS</span>
      </footer>
    </section>

    <aside class="inspector-panel panel">
      <div class="panel-heading inspector-heading">
        <div><span class="eyebrow">PROPERTIES</span><h2>Inspetor</h2></div>
        <button v-if="selectedObject" type="button" class="danger-icon" aria-label="Excluir objeto selecionado"
          title="Excluir objeto" @click="removeSelected">⌫</button>
      </div>
      <div v-if="selectedObject" class="inspector-content">
        <div class="selected-object-card">
          <span class="selected-object-icon">◇</span>
          <div><strong>{{ selectedObject.name }}</strong><small>{{ selectedObject.type }}</small></div>
        </div>
        <section class="property-section">
          <div class="section-title">TRANSFORMAÇÃO</div>
          <div class="property-row"><span>Posição X</span><output>{{ selectedObject.x.toFixed(2) }}</output></div>
          <div class="property-row"><span>Posição Y</span><output>{{ selectedObject.y.toFixed(2) }}</output></div>
          <div class="property-row"><span>Posição Z</span><output>{{ selectedObject.z.toFixed(2) }}</output></div>
          <div class="property-note">Os controles completos de transformação serão adicionados nesta nova interface.</div>
        </section>
        <section class="property-section">
          <div class="section-title">ESTADO</div>
          <div class="property-row"><span>Visibilidade</span><output>{{ selectedObject.visible ? 'Visível' : 'Oculto' }}</output></div>
          <div class="property-row"><span>Identificador</span><output class="id-value">{{ selectedObject.id.slice(0, 12) }}</output></div>
        </section>
      </div>
      <div v-else class="inspector-empty">
        <span class="inspector-empty-icon">◎</span><strong>Nada selecionado</strong>
        <p>Selecione um objeto na hierarquia ou diretamente na viewport.</p>
      </div>
    </aside>

    <footer class="statusbar">
      <span class="status-message">{{ status || 'Pronto' }}</span>
      <span class="status-right">PROMETHEUS ENGINE <b>·</b> {{ engineReady ? 'READY' : 'LOADING' }}</span>
    </footer>
  </main>
</template>
