<script setup lang="ts">
import type {ObjectInfo,PlayerSettings} from '@engine'
type Tab='scene'|'player'|'sky'
type ObjField='x'|'y'|'z'|'rotationX'|'rotationY'|'rotationZ'|'scaleX'|'scaleY'|'scaleZ'
type PlayerField=keyof PlayerSettings
defineProps<{
 activeTab:Tab;projectName:string;selectedObject:ObjectInfo|null;terrain:{visible:boolean;seed:number;edits:number};
 playerModelName:string;playerModelHeight:number;playerSettings:PlayerSettings;timeOfDay:number;
 dayNightCycleEnabled:boolean;dayNightCycleSpeed:number;renderFogEnabled:boolean;renderFogDistanceScale:number;
 performanceMode:'quality'|'balanced'|'economy'|'auto';renderFpsLimit:number;renderDistance:number;renderAll:boolean;hasSkyTexture:boolean
}>()
const emit=defineEmits<{
 (e:'update:activeTab',tab:Tab):void;(e:'rename-object',value:string):void;(e:'object-number',field:ObjField,value:number):void;
 (e:'remove-object'):void;(e:'toggle-object-visibility'):void;(e:'toggle-terrain'):void;(e:'regenerate-terrain'):void;(e:'clear-terrain'):void;
 (e:'player-setting',field:PlayerField,value:number):void;(e:'time-of-day',value:number):void;(e:'toggle-cycle'):void;(e:'cycle-speed',value:number):void;
 (e:'fog',enabled:boolean):void;(e:'fog-distance',value:number):void;(e:'performance',value:'quality'|'balanced'|'economy'|'auto'):void;
 (e:'fps-limit',value:number):void;(e:'render-distance',value:number):void;(e:'render-all',enabled:boolean):void;(e:'sky-file',file:File):void
}>()
function setObjectNumber(field:ObjField,event:Event){emit('object-number',field,Number((event.target as HTMLInputElement).value))}
function setPlayerNumber(field:PlayerField,event:Event){emit('player-setting',field,Number((event.target as HTMLInputElement).value))}
function onSkyFile(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(file)emit('sky-file',file)}
</script>
<template>
 <aside class="inspector-panel">
  <div class="inspector-tabs" role="tablist" aria-label="Inspetor">
   <button type="button" role="tab" :aria-selected="activeTab==='scene'" :class="{active:activeTab==='scene'}" @click="emit('update:activeTab','scene')">Cena</button>
   <button type="button" role="tab" :aria-selected="activeTab==='player'" :class="{active:activeTab==='player'}" @click="emit('update:activeTab','player')">Jogador</button>
   <button type="button" role="tab" :aria-selected="activeTab==='sky'" :class="{active:activeTab==='sky'}" @click="emit('update:activeTab','sky')">Céu</button>
  </div>
  <div v-if="activeTab==='scene'" class="inspector-scroll">
   <div class="inspector-summary"><div class="summary-icon">{{selectedObject?(selectedObject.importedModel?'⬡':'◆'):'⌂'}}</div><div class="summary-copy"><strong>{{selectedObject?.name??projectName??'Mundo principal'}}</strong><small>{{selectedObject?'Objeto selecionado':'Nenhum objeto selecionado'}}</small></div><button v-if="selectedObject" type="button" class="summary-delete" aria-label="Excluir objeto selecionado" @click="emit('remove-object')">⌫</button></div>
   <template v-if="selectedObject">
    <section class="inspector-section"><h3><span class="section-diamond">◇</span> Objeto</h3>
     <label class="inspector-field full-field"><span>Nome</span><input :value="selectedObject.name" maxlength="80" @change="emit('rename-object',($event.target as HTMLInputElement).value)"/></label>
     <div class="inspector-toggle-row"><span>Visível na cena</span><button type="button" class="switch" :class="{on:selectedObject.visible}" role="switch" :aria-checked="selectedObject.visible" @click="emit('toggle-object-visibility')"><i></i></button></div>
    </section>
    <section class="inspector-section"><h3><span class="section-diamond">◇</span> Transformação</h3>
     <div class="vector-grid">
      <label class="inspector-field"><span><b class="axis-x">X</b> Posição</span><input type="number" step=".1" :value="selectedObject.x" @change="setObjectNumber('x',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-y">Y</b> Posição</span><input type="number" step=".1" :value="selectedObject.y" @change="setObjectNumber('y',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-z">Z</b> Posição</span><input type="number" step=".1" :value="selectedObject.z" @change="setObjectNumber('z',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-x">X</b> Rotação</span><input type="number" step="1" :value="selectedObject.rotationX" @change="setObjectNumber('rotationX',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-y">Y</b> Rotação</span><input type="number" step="1" :value="selectedObject.rotationY" @change="setObjectNumber('rotationY',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-z">Z</b> Rotação</span><input type="number" step="1" :value="selectedObject.rotationZ" @change="setObjectNumber('rotationZ',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-x">X</b> Escala</span><input type="number" min=".01" step=".1" :value="selectedObject.scaleX" @change="setObjectNumber('scaleX',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-y">Y</b> Escala</span><input type="number" min=".01" step=".1" :value="selectedObject.scaleY" @change="setObjectNumber('scaleY',$event)"/></label>
      <label class="inspector-field"><span><b class="axis-z">Z</b> Escala</span><input type="number" min=".01" step=".1" :value="selectedObject.scaleZ" @change="setObjectNumber('scaleZ',$event)"/></label>
     </div>
     <div class="inspector-toggle-row"><span>Bloquear transformação</span><span class="readonly-value">{{selectedObject.locked?'Bloqueado':'Livre'}}</span></div>
    </section>
   </template>
   <section class="inspector-section"><h3><span class="section-diamond">◇</span> Ambiente</h3>
    <div class="inspector-property"><span>Dimensão</span><span class="select-like">3D <b>⌄</b></span></div>
    <div class="inspector-property"><span>Terreno</span><span class="select-like">{{terrain.visible?'Procedural':'Oculto'}} <b>⌄</b></span></div>
    <div class="inspector-property"><span>Relevo</span><span class="select-like">Editável <b>⌄</b></span></div>
    <div class="inspector-toggle-row"><span>Terreno visível</span><button type="button" class="switch" :class="{on:terrain.visible}" role="switch" :aria-checked="terrain.visible" @click="emit('toggle-terrain')"><i></i></button></div>
    <div class="terrain-meta"><span>Seed {{terrain.seed}}</span><span>{{terrain.edits}} alterações</span></div>
    <div class="compact-actions"><button type="button" @click="emit('regenerate-terrain')">Regenerar</button><button type="button" @click="emit('clear-terrain')">Limpar relevo</button></div>
   </section>
   <section class="inspector-section"><h3><span class="section-chevron">⌄</span> Céu e iluminação</h3>
    <div class="inspector-property"><span>Textura do céu</span><label class="file-chip">{{hasSkyTexture?'Alterar imagem':'Adicionar imagem'}}<input type="file" accept="image/*" @change="onSkyFile"/></label></div>
    <div class="inspector-toggle-row"><span>Névoa</span><button type="button" class="switch" :class="{on:renderFogEnabled}" role="switch" :aria-checked="renderFogEnabled" @click="emit('fog',!renderFogEnabled)"><i></i></button></div>
    <label class="range-row"><span>Ciclo dia/noite</span><span class="day-range"><b>☀</b><input type="range" min="0" max="24" step=".25" :value="timeOfDay" @input="emit('time-of-day',Number(($event.target as HTMLInputElement).value))"/><b>☾</b></span></label>
    <label v-if="dayNightCycleEnabled" class="range-row"><span>Velocidade</span><input type="range" min=".01" max="4" step=".01" :value="dayNightCycleSpeed" @input="emit('cycle-speed',Number(($event.target as HTMLInputElement).value))"/></label>
    <div class="inspector-toggle-row"><span>Ciclo automático</span><button type="button" class="switch" :class="{on:dayNightCycleEnabled}" role="switch" :aria-checked="dayNightCycleEnabled" @click="emit('toggle-cycle')"><i></i></button></div>
   </section>
   <section class="inspector-section"><h3><span class="section-chevron">⌄</span> Desempenho</h3>
    <label class="inspector-property"><span>Qualidade gráfica</span><select :value="performanceMode" @change="emit('performance',($event.target as HTMLSelectElement).value as 'quality'|'balanced'|'economy'|'auto')"><option value="quality">Alta</option><option value="balanced">Equilibrada</option><option value="economy">Econômica</option><option value="auto">Automática</option></select></label>
    <label class="inspector-property"><span>FPS alvo</span><select :value="renderFpsLimit" @change="emit('fps-limit',Number(($event.target as HTMLSelectElement).value))"><option value="0">Sem limite</option><option value="30">30</option><option value="45">45</option><option value="60">60</option><option value="90">90</option><option value="120">120</option></select></label>
    <div class="inspector-property"><span>Distância de renderização</span><span class="readonly-value">{{renderAll?'Tudo':renderDistance+' u'}}</span></div>
    <label class="range-row"><span>Alcance</span><input type="range" min="10" max="250" step="5" :value="renderDistance" :disabled="renderAll" @input="emit('render-distance',Number(($event.target as HTMLInputElement).value))"/></label>
    <div class="inspector-toggle-row"><span>Renderizar tudo</span><button type="button" class="switch" :class="{on:renderAll}" role="switch" :aria-checked="renderAll" @click="emit('render-all',!renderAll)"><i></i></button></div>
   </section>
   <div class="editor-tip"><span>♧</span><div><strong>Dica do Editor</strong><p>Use as ferramentas da viewport para adicionar e organizar seus objetos.</p></div></div>
  </div>
  <div v-else-if="activeTab==='player'" class="inspector-scroll">
   <div class="inspector-summary"><div class="summary-icon player-summary-icon">♙</div><div class="summary-copy"><strong>Jogador</strong><small>Configuração do personagem</small></div></div>
   <section class="inspector-section"><h3><span class="section-diamond">◇</span> Modelo do jogador</h3><div class="model-name-card"><span>⬡</span><div><strong>{{playerModelName}}</strong><small>{{playerModelHeight.toFixed(2)}} unidades de altura</small></div></div></section>
   <section class="inspector-section"><h3><span class="section-diamond">◇</span> Movimento</h3>
    <label class="inspector-property"><span>Velocidade de caminhada</span><input type="number" min=".5" max="15" step=".1" :value="playerSettings.walkSpeed" @change="setPlayerNumber('walkSpeed',$event)"/></label>
    <label class="inspector-property"><span>Multiplicador de corrida</span><input type="number" min="1" max="3" step=".1" :value="playerSettings.runMultiplier" @change="setPlayerNumber('runMultiplier',$event)"/></label>
    <label class="inspector-property"><span>Força do salto</span><input type="number" min="0" max="14" step=".1" :value="playerSettings.jumpSpeed" @change="setPlayerNumber('jumpSpeed',$event)"/></label>
    <label class="inspector-property"><span>Gravidade</span><input type="number" min="2" max="40" step=".5" :value="playerSettings.gravity" @change="setPlayerNumber('gravity',$event)"/></label>
   </section>
   <section class="inspector-section"><h3><span class="section-diamond">◇</span> Colisor</h3><label class="inspector-property"><span>Raio</span><input type="number" min=".1" max=".8" step=".01" :value="playerSettings.colliderRadius" @change="setPlayerNumber('colliderRadius',$event)"/></label></section>
  </div>
  <div v-else class="inspector-scroll">
   <div class="inspector-summary"><div class="summary-icon sky-summary-icon">☼</div><div class="summary-copy"><strong>Céu e iluminação</strong><small>Ambiente da cena</small></div></div>
   <section class="inspector-section"><h3><span class="section-chevron">⌄</span> Horário do mundo</h3>
    <div class="time-readout">{{String(Math.floor(timeOfDay)).padStart(2,'0')}}:{{String(Math.round((timeOfDay%1)*60)).padStart(2,'0')}}</div>
    <label class="range-row"><span>Hora</span><input type="range" min="0" max="24" step=".25" :value="timeOfDay" @input="emit('time-of-day',Number(($event.target as HTMLInputElement).value))"/></label>
    <div class="inspector-toggle-row"><span>Ciclo automático</span><button type="button" class="switch" :class="{on:dayNightCycleEnabled}" role="switch" :aria-checked="dayNightCycleEnabled" @click="emit('toggle-cycle')"><i></i></button></div>
    <label v-if="dayNightCycleEnabled" class="inspector-property"><span>Velocidade</span><input type="number" min=".01" max="4" step=".01" :value="dayNightCycleSpeed" @change="emit('cycle-speed',Number(($event.target as HTMLInputElement).value))"/></label>
   </section>
   <section class="inspector-section"><h3><span class="section-chevron">⌄</span> Céu</h3>
    <label class="sky-upload-area"><span>▧</span><strong>{{hasSkyTexture?'Substituir textura do céu':'Importar imagem de céu'}}</strong><small>PNG, JPG ou WebP</small><input type="file" accept="image/*" @change="onSkyFile"/></label>
    <div class="inspector-toggle-row"><span>Névoa atmosférica</span><button type="button" class="switch" :class="{on:renderFogEnabled}" role="switch" :aria-checked="renderFogEnabled" @click="emit('fog',!renderFogEnabled)"><i></i></button></div>
    <label class="range-row"><span>Distância da névoa</span><input type="range" min=".5" max="2" step=".05" :value="renderFogDistanceScale" @input="emit('fog-distance',Number(($event.target as HTMLInputElement).value))"/></label>
   </section>
  </div>
 </aside>
</template>
