<script setup lang="ts">
import {computed,ref} from 'vue'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import type {Object3D} from 'three'
import type {ObjectInfo,ObjectType,PlayerSettings} from '@engine'
import type {NumField} from '@editor/composables/useEditor'
import {useEditor} from '@editor/composables/useEditor'
import EditorTopBar from './components/EditorTopBar.vue'
import EditorSideRail from './components/EditorSideRail.vue'
import SceneHierarchyPanel from './components/SceneHierarchyPanel.vue'
import EditorInspector from './components/EditorInspector.vue'
import UiIcon from './components/UiIcon.vue'

type RailSection='scene'|'interface'|'player'|'scripts'|'controls'|'settings'
type InspectorTab='scene'|'player'|'sky'
const canvas=ref<HTMLCanvasElement|null>(null)
const modelInput=ref<HTMLInputElement|null>(null)
const activeSection=ref<RailSection>('scene')
const inspectorTab=ref<InspectorTab>('scene')
const searchQuery=ref('')
const theme=ref<'dark'|'light'>('dark')
const workspaceFull=ref(false)
const hierarchyCollapsed=ref(false)
const {
 projectName,dirty,status,fps,renderStats,objects,sceneFolders,selectedId,groupSelection,tool,transform,cameraPreset,gridVisible,engineInstance,isPlayMode,
 brushStrength,brushRadius,polygonLinesVisible,performanceMode,renderDistance,renderAll,renderResolutionScale,renderFpsLimit,renderFogEnabled,renderFogDistanceScale,
 renderDynamicResolution,renderDynamicResolutionTargetFps,renderDynamicResolutionMinScale,
 grassVisible,grassUseDetailedModel,grassDensityPercent,grassRenderDistanceMode,grassRenderDistance,grassNearDetailDistance,grassMiddleDetailDistance,
 grassOcclusionEnabled,grassOcclusionIntervalMs,wallOcclusionQuality,grassWindPercent,
 playerModelName,playerModelCustom,playerModelHeight,playerSettings,setPlayerSettings,
 setTool,setTransform,cycleCamera,addPrimitive,selectItem,toggleVisible,toggleGrid,toggleTerrain,regenerateTerrain,clearTerrain,removeSelected,
 markDirty,newProject,openProject,saveProject,enterPlayMode,exitPlayMode,undo,redo,copySelectedObject,pasteObject,groupSelectedObjects,ungroupSelectedObjects,createSceneFolder,renameSceneFolder,moveSceneObjectToFolder,moveSceneFolderToParent,deleteSceneFolder,
 addSpawnPlatform,addImportedModel,addClickableCubeExample,togglePerformanceMode,setPerformanceMode,setRenderDistance,setRenderAll,setRenderResolutionScale,setRenderFpsLimit,
 setRenderFogEnabled,setRenderFogDistanceScale,setRenderDynamicResolution,setRenderDynamicResolutionTargetFps,setRenderDynamicResolutionMinScale,
 setGrassVisible,setGrassUseDetailedModel,setGrassDensityPercent,setGrassRenderDistance,setGrassDetailDistance,setGrassOcclusionEnabled,setGrassOcclusionInterval,setWallOcclusionQuality,setGrassWindPercent,
 setPlayerModelHeight,setPlayerModelFile,resetPlayerModel,
 onRename,onNumber,toggleObjectLock,toggleObjectWireframe,onColliderChange,onColliderVectorChange,colliderDebugVisible,toggleColliderDebug,onColor,onTexture,onTextureRepeat,onFaceTexture,colorHex,
 togglePolygonLines,polygonLinesVisible,terrain
}=useEditor(canvas)
const selectedObject=computed<ObjectInfo|null>(()=>objects.value.find(o=>o.id===selectedId.value)??null)
const engineReady=computed(()=>Boolean(engineInstance.value))
const selectedCoordinates=computed(()=>selectedObject.value?{x:selectedObject.value.x,y:selectedObject.value.y,z:selectedObject.value.z}:{x:0,y:0,z:0})
const cameraLabel=computed(()=>({free:'Perspectiva',isometric:'Isométrica',top:'Topo'}[cameraPreset.value]??'Perspectiva'))
const renderFps=computed(()=>Math.round(renderStats.value.fps||fps.value))
const drawCalls=computed(()=>renderStats.value.drawCalls||0)
const workspaceTitle=computed(()=>({scene:'Cena',interface:'Interface',player:'Jogador',scripts:'Scripts',controls:'Controles',settings:'Configurações'}[activeSection.value]??'Cena'))
const workspaceDescription=computed(()=>({scene:'Organize os objetos e componentes do mundo principal.',interface:'Crie e organize as telas da interface do seu jogo.',player:'Configure o personagem, seus movimentos e variáveis.',scripts:'Organize eventos, regras e pacotes de comportamento.',controls:'Consulte e configure os controles do jogador.',settings:'Ajuste as preferências gerais do editor.'}[activeSection.value]??''))

function updateProjectName(value:string){projectName.value=value;markDirty()}
function selectSceneObject(id:string,additive:boolean){selectItem(id,additive);inspectorTab.value='scene'}
function changeObjectNumber(field:string,value:number){onNumber(field as NumField,{target:{value:String(value)}} as unknown as Event)}
function renameObject(value:string){onRename({target:{value}} as unknown as Event)}
function updatePlayerSetting(field:keyof PlayerSettings,value:number){setPlayerSettings({[field]:value} as Partial<PlayerSettings>)}
function toggleObjectVisibility(){if(selectedObject.value)toggleVisible(selectedObject.value.id)}
function importModel(){modelInput.value?.click()}
async function onModelFileSelected(event:Event){
 const input=event.target as HTMLInputElement
 const file=input.files?.[0]
 input.value=''
 if(!file)return
 if(!/\.(glb|gltf)$/i.test(file.name)){console.warn('Escolha um arquivo .glb ou .gltf.');return}
 try{
  const data=await file.arrayBuffer()
  const loader=new GLTFLoader()
  await new Promise<void>((resolve,reject)=>loader.parse(data,'',gltf=>{addImportedModel(file.name.replace(/\.(glb|gltf)$/i,''),gltf.scene as Object3D,1.8);resolve()},reject))
 }catch(error){console.error('[Editor] Falha ao importar modelo 3D.',error)}
}
function updateBrushStrength(value:number){brushStrength.value=value}
function updateBrushRadius(value:number){brushRadius.value=value}
function onPlayerModelFile(file:File){void setPlayerModelFile(file)}
function clearSkyTexture(){setSkyTexture('')}
function onSkyFile(file:File){
 if(!file.type.startsWith('image/'))return
 const reader=new FileReader()
 reader.onload=()=>{if(typeof reader.result==='string')setSkyTexture(reader.result)}
 reader.onerror=()=>console.error('[Editor] Não foi possível ler a imagem do céu.')
 reader.readAsDataURL(file)
}
function togglePlay(){if(isPlayMode.value)exitPlayMode();else enterPlayMode()}
function toggleAppearance(){theme.value=theme.value==='dark'?'light':'dark'}
function toggleViewportFull(){workspaceFull.value=!workspaceFull.value}
</script>
<template>
 <main class="editor-shell" :class="{'theme-light':theme==='light','viewport-expanded':workspaceFull,'hierarchy-collapsed':hierarchyCollapsed,'is-running':isPlayMode}" data-testid="editor-shell">
  <EditorTopBar :project-name="projectName" :dirty="dirty" :is-running="isPlayMode" :search-query="searchQuery" :theme="theme"
   @new-project="newProject" @open-project="openProject" @save-project="saveProject()" @undo="undo" @redo="redo" @toggle-play="togglePlay" @update:search-query="searchQuery=$event" @toggle-theme="toggleAppearance"/>
  <EditorSideRail :active-section="activeSection" :hierarchy-collapsed="hierarchyCollapsed" @navigate="activeSection=$event" @toggle-hierarchy="hierarchyCollapsed=!hierarchyCollapsed"/>
  <SceneHierarchyPanel v-if="activeSection==='scene'" :objects="objects" :folders="sceneFolders" :selected-id="selectedId" :group-selection="groupSelection" :project-name="projectName" :search-query="searchQuery"
   @select="selectSceneObject" @toggle-visibility="toggleVisible" @add-object="addPrimitive" @add-spawn="addSpawnPlatform" @group="groupSelectedObjects" @ungroup="ungroupSelectedObjects" @copy="copySelectedObject" @paste="pasteObject" @remove="removeSelected" @import-model="importModel" @update:search-query="searchQuery=$event"
   @create-folder="createSceneFolder" @rename-folder="renameSceneFolder" @delete-folder="deleteSceneFolder" @move-object="moveSceneObjectToFolder" @move-folder="moveSceneFolderToParent"/>
  <section v-else class="workspace-placeholder">
   <span class="eyebrow">WORKSPACE</span><h2>{{workspaceTitle}}</h2><p>{{workspaceDescription}}</p>
   <div class="workspace-count" v-if="activeSection==='player'">{{playerModelName}} · {{playerSettings.walkSpeed.toFixed(1)}} u/s</div>
   <div class="workspace-count" v-else-if="activeSection==='scripts'">{{objects.length}} objetos · sistemas de eventos preservados</div>
   <div class="workspace-count" v-else-if="activeSection==='interface'">Telas salvas no projeto: área de edição visual em reconstrução</div>
   <div class="workspace-count" v-else-if="activeSection==='controls'">Controles do jogador · configuração disponível no módulo de entrada</div>
   <div class="workspace-count" v-else>Preferências do editor e renderização</div>
  </section>

  <section class="viewport-panel" aria-label="Viewport 3D" data-testid="viewport-panel">
   <div class="viewport-commandbar">
    <details class="add-menu"><summary class="command-button primary"><UiIcon name="plus" :size="17" />Adicionar<UiIcon name="chevron-down" :size="13" /></summary>
     <div class="file-menu-popover"><button type="button" @click="addPrimitive('cube')"><UiIcon name="square" :size="14" />Cubo</button><button type="button" @click="addPrimitive('platform')"><UiIcon name="terreno" :size="14" />Plataforma</button><button type="button" @click="addSpawnPlatform"><UiIcon name="player" :size="14" />Plataforma de spawn</button></div>
    </details>
    <button class="command-button import-button" type="button" aria-label="Importar modelo 3D" @click="importModel"><UiIcon name="box" :size="15" />Importar 3D</button>
    <input ref="modelInput" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden @change="onModelFileSelected"/>
    <div class="command-spacer"></div>
    <button class="command-button viewport-preset" type="button" title="Alternar câmera" @click="cycleCamera"><UiIcon name="camera" :size="15" />{{cameraLabel}} <UiIcon name="chevron-down" :size="13" /></button>
    <details class="render-menu"><summary class="command-button render-control"><span class="render-dot"></span>Render <UiIcon name="chevron-down" :size="13" /></summary>
     <div class="render-popover">
      <label>Qualidade<select :value="performanceMode" @change="setPerformanceMode(($event.target as HTMLSelectElement).value as 'quality'|'balanced'|'economy'|'auto')"><option value="quality">Alta</option><option value="balanced">Equilibrada</option><option value="economy">Econômica</option><option value="auto">Automática</option></select></label>
      <label>FPS alvo<select :value="renderFpsLimit" @change="setRenderFpsLimit(Number(($event.target as HTMLSelectElement).value))"><option value="0">Sem limite</option><option value="30">30</option><option value="45">45</option><option value="60">60</option><option value="90">90</option><option value="120">120</option></select></label>
      <label class="popover-toggle"><span>Névoa</span><input type="checkbox" :checked="renderFogEnabled" @change="setRenderFogEnabled(($event.target as HTMLInputElement).checked)"/></label>
      <label class="popover-toggle"><span>Grade</span><input type="checkbox" :checked="gridVisible" @change="toggleGrid"/></label>
      <label class="popover-toggle"><span>Linhas dos polígonos</span><input type="checkbox" :checked="polygonLinesVisible" @change="togglePolygonLines"/></label>
     </div>
    </details>
    <button class="command-button viewport-fullscreen" type="button" aria-label="Expandir viewport" title="Expandir viewport" @click="toggleViewportFull"><UiIcon name="maximize" :size="17" /></button>
   </div>
   <div class="viewport-stage">
    <canvas ref="canvas" class="engine-canvas" data-testid="engine-canvas" aria-label="Área de renderização 3D"></canvas>
    <div class="viewport-overlay-label">PERSPECTIVA 3D</div>
    <div class="viewport-axis" aria-hidden="true"><svg viewBox="0 0 78 78" fill="none"><path d="M39 39 39 5" stroke="#4cc775" stroke-width="1.7"/><path d="M39 39 65 54" stroke="#f06a54" stroke-width="1.7"/><path d="M39 39 11 52" stroke="#4da8ed" stroke-width="1.7"/><circle cx="39" cy="39" r="2.7" fill="#c6ccd7"/><text x="34" y="10" fill="#4cc775" font-size="10">Y</text><text x="67" y="61" fill="#f06a54" font-size="10">X</text><text x="3" y="58" fill="#4da8ed" font-size="10">Z</text></svg></div>
    <div
     class="viewport-tool-dock"
     data-testid="viewport-tool-dock"
     role="toolbar"
     aria-label="Ferramentas do viewport"
     aria-orientation="vertical"
     tabindex="0"
     @wheel.stop
    >
     <button class="viewport-tool-button" data-testid="tool-select" type="button"
      :class="{active:tool==='select'&&transform==='move'}" :aria-pressed="tool==='select'&&transform==='move'"
      aria-label="Selecionar" title="Selecionar (Q)" @click="setTool('select');setTransform('move')"><UiIcon name="select" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-build" type="button"
      :class="{active:tool==='build'}" :aria-pressed="tool==='build'"
      aria-label="Construir" title="Construir: clique no mundo para posicionar o objeto atual" @click="setTool('build')"><UiIcon name="plus" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-terrain" type="button"
      :class="{active:tool==='terrain'}" :aria-pressed="tool==='terrain'"
      aria-label="Terreno" title="Esculpir terreno; segure Shift para rebaixar" @click="setTool('terrain')"><UiIcon name="terreno" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-grass" type="button"
      :class="{active:tool==='grass'}" :aria-pressed="tool==='grass'"
      aria-label="Pintar grama" title="Pintar grama; segure Shift para apagar grama pintada" @click="setTool('grass')"><UiIcon name="floresta" :size="17" /></button>

     <span class="viewport-tool-separator" role="separator" aria-orientation="horizontal"></span>

     <button class="viewport-tool-button" data-testid="tool-move" type="button"
      :class="{active:tool==='select'&&transform==='move'}" :aria-pressed="tool==='select'&&transform==='move'"
      aria-label="Mover" title="Mover (W): transforma o objeto pelos eixos X, Y e Z" @click="setTool('select');setTransform('move')"><UiIcon name="move" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-rotate" type="button"
      :class="{active:tool==='select'&&transform==='rotate'}" :aria-pressed="tool==='select'&&transform==='rotate'"
      aria-label="Rotacionar" title="Rotacionar (E): gira o objeto pelos eixos X, Y e Z" @click="setTool('select');setTransform('rotate')"><UiIcon name="rotate" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-scale" type="button"
      :class="{active:tool==='select'&&transform==='scale'}" :aria-pressed="tool==='select'&&transform==='scale'"
      aria-label="Escalar" title="Escalar (R): altera a escala pelos eixos X, Y e Z" @click="setTool('select');setTransform('scale')"><UiIcon name="scale" :size="17" /></button>

     <span class="viewport-tool-separator" role="separator" aria-orientation="horizontal"></span>

     <button class="viewport-tool-button" data-testid="tool-import-model" type="button"
      aria-label="Importar modelo 3D" title="Importar um modelo 3D .glb ou .gltf" @click="importModel"><UiIcon name="box" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-visual-script" type="button"
      :class="{active:activeSection==='scripts'}" :aria-pressed="activeSection==='scripts'"
      aria-label="Visual Script" title="Abrir a área de Scripts e eventos" @click="activeSection='scripts'"><UiIcon name="route" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-add-cube" type="button"
      aria-label="Adicionar cubo" title="Adicionar um cubo à cena" @click="addPrimitive('cube')"><UiIcon name="square" :size="16" /></button>
     <button class="viewport-tool-button" data-testid="tool-add-platform" type="button"
      aria-label="Adicionar plataforma" title="Adicionar uma plataforma retangular à cena" @click="addPrimitive('platform')"><UiIcon name="terreno" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-add-spawn" type="button"
      aria-label="Adicionar spawn do jogador" title="Criar o ponto inicial do jogador" @click="addSpawnPlatform"><UiIcon name="player" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-add-clickable" type="button"
      aria-label="Criar exemplo clicável" title="Criar um objeto de exemplo com evento de clique" @click="addClickableCubeExample"><UiIcon name="diamond" :size="17" /></button>

     <span class="viewport-tool-separator" role="separator" aria-orientation="horizontal"></span>

     <button class="viewport-tool-button" data-testid="tool-grid" type="button"
      :class="{active:gridVisible}" :aria-pressed="gridVisible"
      aria-label="Alternar grade" title="Mostrar ou ocultar a grade do chão" @click="toggleGrid"><UiIcon name="layers" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-wireframe" type="button"
      :class="{active:polygonLinesVisible}" :aria-pressed="polygonLinesVisible"
      aria-label="Alternar linhas dos polígonos" title="Mostrar ou ocultar as linhas dos polígonos" @click="togglePolygonLines"><UiIcon name="box" :size="17" /></button>
     <button class="viewport-tool-button" data-testid="tool-performance" type="button"
      :class="{active:performanceMode!=='quality'}" :aria-pressed="performanceMode!=='quality'"
      aria-label="Alternar modo de desempenho" :title="'Perfil atual: '+performanceMode+'. Clique para alternar.'" @click="togglePerformanceMode"><UiIcon name="lightbulb" :size="17" /></button>
    </div>
    <div class="viewport-coordinate"><span><b class="axis-x">X</b> {{selectedCoordinates.x.toFixed(1)}}</span><span><b class="axis-y">Y</b> {{selectedCoordinates.y.toFixed(1)}}</span><span><b class="axis-z">Z</b> {{selectedCoordinates.z.toFixed(1)}}</span></div>
    <div class="viewport-stats"><i class="stats-live"></i><strong>{{renderFps}} FPS</strong><span>{{renderStats.cpuRenderMs.toFixed(1)}} ms</span><span>{{renderStats.drawCalls}} draw calls</span></div>
   </div>
   <div class="viewport-status"><div class="viewport-status-left"><span class="status-ready"><i></i>{{engineReady?'Motor 3D ativo':'Inicializando motor'}}</span><span>{{gridVisible?'Grade ativada':'Grade desativada'}}</span></div><div class="viewport-status-right"><span>Selecionar</span><kbd class="keycap">Q</kbd><span>Mover</span><kbd class="keycap">W</kbd><span>Rotacionar</span><kbd class="keycap">E</kbd><span>Escalar</span><kbd class="keycap">R</kbd><span>Zoom</span><kbd class="keycap">Scroll</kbd></div></div>
  </section>

  <EditorInspector
   :active-tab="inspectorTab"
   :project-name="projectName"
   :selected-object="selectedObject"
   :folders="sceneFolders"
   :terrain="terrain"
   :brush-strength="brushStrength"
   :brush-radius="brushRadius"
   :grid-visible="gridVisible"
   :polygon-lines-visible="polygonLinesVisible"
   :collider-debug-visible="colliderDebugVisible"
   :player-model-name="playerModelName"
   :player-model-custom="playerModelCustom"
   :player-model-height="playerModelHeight"
   :player-settings="playerSettings"
   :time-of-day="timeOfDay"
   :day-night-cycle-enabled="dayNightCycleEnabled"
   :day-night-cycle-speed="dayNightCycleSpeed"
   :render-fog-enabled="renderFogEnabled"
   :render-fog-distance-scale="renderFogDistanceScale"
   :performance-mode="performanceMode"
   :render-fps-limit="renderFpsLimit"
   :render-distance="renderDistance"
   :render-all="renderAll"
   :render-resolution-scale="renderResolutionScale"
   :render-dynamic-resolution="renderDynamicResolution"
   :render-dynamic-resolution-target-fps="renderDynamicResolutionTargetFps"
   :render-dynamic-resolution-min-scale="renderDynamicResolutionMinScale"
   :grass-visible="grassVisible"
   :grass-use-detailed-model="grassUseDetailedModel"
   :grass-density-percent="grassDensityPercent"
   :grass-render-distance-mode="grassRenderDistanceMode"
   :grass-render-distance="grassRenderDistance"
   :grass-near-detail-distance="grassNearDetailDistance"
   :grass-middle-detail-distance="grassMiddleDetailDistance"
   :grass-occlusion-enabled="grassOcclusionEnabled"
   :grass-occlusion-interval-ms="grassOcclusionIntervalMs"
   :wall-occlusion-quality="wallOcclusionQuality"
   :grass-wind-percent="grassWindPercent"
   :render-stats="renderStats"
   :has-sky-texture="Boolean(skyTextureDataUrl)"
   @update:active-tab="inspectorTab=$event"
   @rename-object="renameObject"
   @object-number="changeObjectNumber"
   @remove-object="removeSelected"
   @toggle-object-visibility="toggleObjectVisibility"
   @toggle-object-lock="toggleObjectLock"
   @toggle-object-wireframe="toggleObjectWireframe"
   @object-folder="moveSceneObjectToFolder"
   @object-color="onColor"
   @object-texture="onTexture"
   @texture-repeat="onTextureRepeat"
   @face-texture="onFaceTexture"
   @collider-type="onColliderChange"
   @collider-vector="onColliderVectorChange"
   @toggle-collider-debug="toggleColliderDebug"
   @toggle-terrain="toggleTerrain"
   @regenerate-terrain="regenerateTerrain"
   @clear-terrain="clearTerrain"
   @brush-strength="updateBrushStrength"
   @brush-radius="updateBrushRadius"
   @toggle-grid="toggleGrid"
   @toggle-polygon-lines="togglePolygonLines"
   @player-setting="updatePlayerSetting"
   @player-model-file="onPlayerModelFile"
   @player-model-height="setPlayerModelHeight"
   @reset-player-model="resetPlayerModel"
   @time-of-day="setTimeOfDay"
   @toggle-cycle="setDayNightCycleEnabled(!dayNightCycleEnabled)"
   @cycle-speed="setDayNightCycleSpeed"
   @fog="setRenderFogEnabled"
   @fog-distance="setRenderFogDistanceScale"
   @sky-file="onSkyFile"
   @clear-sky="clearSkyTexture"
   @performance="setPerformanceMode"
   @fps-limit="setRenderFpsLimit"
   @render-distance="setRenderDistance"
   @render-all="setRenderAll"
   @render-resolution="setRenderResolutionScale"
   @dynamic-resolution="setRenderDynamicResolution"
   @dynamic-target-fps="setRenderDynamicResolutionTargetFps"
   @dynamic-min-scale="setRenderDynamicResolutionMinScale"
   @grass-visible="setGrassVisible"
   @grass-detailed="setGrassUseDetailedModel"
   @grass-density="setGrassDensityPercent"
   @grass-distance="setGrassRenderDistance"
   @grass-detail-distance="setGrassDetailDistance"
   @grass-occlusion="setGrassOcclusionEnabled"
   @grass-occlusion-interval="setGrassOcclusionInterval"
   @wall-occlusion-quality="setWallOcclusionQuality"
   @grass-wind="setGrassWindPercent"
/>

  <footer class="statusbar"><div class="statusbar-left"><span class="status-ready"><i></i>{{status||'Pronto'}}</span><span>Motor 3D ativo</span><span>{{terrain.edits>0?'Terreno editado':'Terreno procedural'}}</span></div><div class="statusbar-right"><span>{{isPlayMode?'MODO JOGO':'MODO EDIÇÃO'}}</span><b>v0.1.0</b></div></footer>
 </main>
</template>