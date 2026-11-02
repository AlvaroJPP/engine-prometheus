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

type RailSection='scene'|'interface'|'player'|'scripts'|'controls'|'settings'
type InspectorTab='scene'|'player'|'sky'
const canvas=ref<HTMLCanvasElement|null>(null)
const modelInput=ref<HTMLInputElement|null>(null)
const activeSection=ref<RailSection>('scene')
const inspectorTab=ref<InspectorTab>('scene')
const searchQuery=ref('')
const theme=ref<'dark'|'light'>('dark')
const workspaceFull=ref(false)
const {
 projectName,dirty,status,fps,renderStats,objects,selectedId,groupSelection,tool,transform,cameraPreset,gridVisible,engineInstance,isPlayMode,
 setTool,setTransform,cycleCamera,addPrimitive,selectItem,toggleVisible,toggleGrid,toggleTerrain,regenerateTerrain,clearTerrain,removeSelected,
 markDirty,newProject,openProject,saveProject,enterPlayMode,exitPlayMode,undo,redo,copySelectedObject,pasteObject,groupSelectedObjects,ungroupSelectedObjects,
 addSpawnPlatform,addImportedModel,playerModelName,playerModelHeight,playerSettings,setPlayerSettings,timeOfDay,dayNightCycleEnabled,dayNightCycleSpeed,
 setSkyTexture,setTimeOfDay,setDayNightCycleEnabled,setDayNightCycleSpeed,skyTextureDataUrl,renderFogEnabled,renderFogDistanceScale,setRenderFogEnabled,
 setRenderFogDistanceScale,performanceMode,setPerformanceMode,renderFpsLimit,setRenderFpsLimit,renderDistance,renderAll,setRenderDistance,setRenderAll,
 onRename,onNumber,togglePolygonLines,polygonLinesVisible,terrain
}=useEditor(canvas)
const selectedObject=computed<ObjectInfo|null>(()=>objects.value.find(o=>o.id===selectedId.value)??null)
const engineReady=computed(()=>Boolean(engineInstance.value))
const selectedCoordinates=computed(()=>selectedObject.value?{x:selectedObject.value.x,y:selectedObject.value.y,z:selectedObject.value.z}:{x:0,y:0,z:0})
const cameraLabel=computed(()=>({free:'Perspectiva',isometric:'Isométrica',top:'Topo'}[cameraPreset.value]??'Perspectiva'))
const renderFps=computed(()=>Math.round(renderStats.value.fps||fps.value))
const drawCalls=computed(()=>renderStats.value.drawCalls||0)
const workspaceTitle=computed(()=>({interface:'Interface',player:'Jogador',scripts:'Scripts',controls:'Controles',settings:'Configurações'}[activeSection.value]??'Cena'))
const workspaceDescription=computed(()=>({interface:'Crie e organize as telas da interface do seu jogo.',player:'Configure o personagem, seus movimentos e variáveis.',scripts:'Organize eventos, regras e pacotes de comportamento.',controls:'Consulte e configure os controles do jogador.',settings:'Ajuste as preferências gerais do editor.'}[activeSection.value]??''))

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
 <main class="editor-shell" :class="{'theme-light':theme==='light','viewport-expanded':workspaceFull,'is-running':isPlayMode}" data-testid="editor-shell">
  <EditorTopBar :project-name="projectName" :dirty="dirty" :is-running="isPlayMode" :search-query="searchQuery" :theme="theme"
   @new-project="newProject" @open-project="openProject" @save-project="saveProject()" @undo="undo" @redo="redo" @toggle-play="togglePlay" @update:search-query="searchQuery=$event" @toggle-theme="toggleAppearance"/>
  <EditorSideRail :active-section="activeSection" @navigate="activeSection=$event"/>
  <SceneHierarchyPanel v-if="activeSection==='scene'" :objects="objects" :selected-id="selectedId" :group-selection="groupSelection" :project-name="projectName" :search-query="searchQuery"
   @select="selectSceneObject" @toggle-visibility="toggleVisible" @add-object="addPrimitive" @add-spawn="addSpawnPlatform" @group="groupSelectedObjects" @ungroup="ungroupSelectedObjects" @copy="copySelectedObject" @paste="pasteObject" @remove="removeSelected" @import-model="importModel" @update:search-query="searchQuery=$event"/>
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
    <details class="add-menu"><summary class="command-button primary"><span class="plus">＋</span>Adicionar<span class="command-caret">⌄</span></summary>
     <div class="file-menu-popover"><button type="button" @click="addPrimitive('cube')"><span>◆</span>Cubo</button><button type="button" @click="addPrimitive('platform')"><span>▰</span>Plataforma</button><button type="button" @click="addSpawnPlatform"><span>▱</span>Plataforma de spawn</button></div>
    </details>
    <button class="command-button import-button" type="button" aria-label="Importar modelo 3D" @click="importModel"><span>⬡</span>Importar 3D</button>
    <input ref="modelInput" type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden @change="onModelFileSelected"/>
    <div class="command-spacer"></div>
    <button class="command-button viewport-preset" type="button" title="Alternar câmera" @click="cycleCamera"><span>◉</span>{{cameraLabel}} <b>⌄</b></button>
    <details class="render-menu"><summary class="command-button render-control"><span class="render-dot"></span>Render <b>⌄</b></summary>
     <div class="render-popover">
      <label>Qualidade<select :value="performanceMode" @change="setPerformanceMode(($event.target as HTMLSelectElement).value as 'quality'|'balanced'|'economy'|'auto')"><option value="quality">Alta</option><option value="balanced">Equilibrada</option><option value="economy">Econômica</option><option value="auto">Automática</option></select></label>
      <label>FPS alvo<select :value="renderFpsLimit" @change="setRenderFpsLimit(Number(($event.target as HTMLSelectElement).value))"><option value="0">Sem limite</option><option value="30">30</option><option value="45">45</option><option value="60">60</option><option value="90">90</option><option value="120">120</option></select></label>
      <label class="popover-toggle"><span>Névoa</span><input type="checkbox" :checked="renderFogEnabled" @change="setRenderFogEnabled(($event.target as HTMLInputElement).checked)"/></label>
      <label class="popover-toggle"><span>Grade</span><input type="checkbox" :checked="gridVisible" @change="toggleGrid"/></label>
      <label class="popover-toggle"><span>Linhas dos polígonos</span><input type="checkbox" :checked="polygonLinesVisible" @change="togglePolygonLines"/></label>
     </div>
    </details>
    <button class="command-button viewport-fullscreen" type="button" aria-label="Expandir viewport" title="Expandir viewport" @click="toggleViewportFull">⛶</button>
   </div>
   <div class="viewport-stage">
    <canvas ref="canvas" class="engine-canvas" data-testid="engine-canvas" aria-label="Área de renderização 3D"></canvas>
    <div class="viewport-overlay-label">PERSPECTIVA 3D</div>
    <div class="viewport-axis" aria-hidden="true"><svg viewBox="0 0 78 78" fill="none"><path d="M39 39 39 5" stroke="#4cc775" stroke-width="1.7"/><path d="M39 39 65 54" stroke="#f06a54" stroke-width="1.7"/><path d="M39 39 11 52" stroke="#4da8ed" stroke-width="1.7"/><circle cx="39" cy="39" r="2.7" fill="#c6ccd7"/><text x="34" y="10" fill="#4cc775" font-size="10">Y</text><text x="67" y="61" fill="#f06a54" font-size="10">X</text><text x="3" y="58" fill="#4da8ed" font-size="10">Z</text></svg></div>
    <div class="viewport-tool-dock" aria-label="Ferramentas do viewport">
     <button type="button" :class="{active:tool==='select'&&transform==='move'}" aria-label="Selecionar" title="Selecionar (Q)" @click="setTool('select')">↖</button>
     <button type="button" :class="{active:tool==='select'&&transform==='move'}" aria-label="Mover" title="Mover (W)" @click="setTool('select');setTransform('move')">✥</button>
     <button type="button" :class="{active:tool==='select'&&transform==='rotate'}" aria-label="Rotacionar" title="Rotacionar (E)" @click="setTool('select');setTransform('rotate')">⟳</button>
     <button type="button" :class="{active:tool==='select'&&transform==='scale'}" aria-label="Escalar" title="Escalar (R)" @click="setTool('select');setTransform('scale')">⤢</button>
     <button type="button" :class="{active:tool==='terrain'}" aria-label="Terreno" title="Ferramenta de terreno" @click="setTool('terrain')">⌁</button>
    </div>
    <div class="viewport-coordinate"><span><b class="axis-x">X</b> {{selectedCoordinates.x.toFixed(1)}}</span><span><b class="axis-y">Y</b> {{selectedCoordinates.y.toFixed(1)}}</span><span><b class="axis-z">Z</b> {{selectedCoordinates.z.toFixed(1)}}</span></div>
    <div class="viewport-stats"><i class="stats-live"></i><strong>{{renderFps}} FPS</strong><span>{{renderStats.cpuRenderMs.toFixed(1)}} ms</span><span>{{renderStats.drawCalls}} draw calls</span></div>
   </div>
   <div class="viewport-status"><div class="viewport-status-left"><span class="status-ready"><i></i>{{engineReady?'Motor 3D ativo':'Inicializando motor'}}</span><span>{{gridVisible?'Grade ativada':'Grade desativada'}}</span></div><div class="viewport-status-right"><span>Selecionar</span><kbd class="keycap">Q</kbd><span>Mover</span><kbd class="keycap">W</kbd><span>Rotacionar</span><kbd class="keycap">E</kbd><span>Escalar</span><kbd class="keycap">R</kbd><span>Zoom</span><kbd class="keycap">Scroll</kbd></div></div>
  </section>

  <EditorInspector :active-tab="inspectorTab" :project-name="projectName" :selected-object="selectedObject" :terrain="terrain" :player-model-name="playerModelName" :player-model-height="playerModelHeight" :player-settings="playerSettings" :time-of-day="timeOfDay" :day-night-cycle-enabled="dayNightCycleEnabled" :day-night-cycle-speed="dayNightCycleSpeed" :render-fog-enabled="renderFogEnabled" :render-fog-distance-scale="renderFogDistanceScale" :performance-mode="performanceMode" :render-fps-limit="renderFpsLimit" :render-distance="renderDistance" :render-all="renderAll" :has-sky-texture="Boolean(skyTextureDataUrl)"
   @update:active-tab="inspectorTab=$event" @rename-object="renameObject" @object-number="changeObjectNumber" @remove-object="removeSelected" @toggle-object-visibility="toggleObjectVisibility" @toggle-terrain="toggleTerrain" @regenerate-terrain="regenerateTerrain" @clear-terrain="clearTerrain" @player-setting="updatePlayerSetting" @time-of-day="setTimeOfDay" @toggle-cycle="setDayNightCycleEnabled(!dayNightCycleEnabled)" @cycle-speed="setDayNightCycleSpeed" @fog="setRenderFogEnabled" @fog-distance="setRenderFogDistanceScale" @performance="setPerformanceMode" @fps-limit="setRenderFpsLimit" @render-distance="setRenderDistance" @render-all="setRenderAll" @sky-file="onSkyFile"/>

  <footer class="statusbar"><div class="statusbar-left"><span class="status-ready"><i></i>{{status||'Pronto'}}</span><span>Motor 3D ativo</span><span>{{terrain.edits>0?'Terreno editado':'Terreno procedural'}}</span></div><div class="statusbar-right"><span>{{isPlayMode?'MODO JOGO':'MODO EDIÇÃO'}}</span><b>v0.1.0</b></div></footer>
 </main>
</template>