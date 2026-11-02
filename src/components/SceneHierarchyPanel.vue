<script setup lang="ts">
import {computed,ref} from 'vue'
import type {ObjectInfo,ObjectType} from '@engine'
type Bucket={id:string;label:string;icon:string;items:ObjectInfo[]}
const props=defineProps<{objects:ObjectInfo[];selectedId:string|null;groupSelection:string[];projectName:string;searchQuery:string}>()
const emit=defineEmits<{
 (e:'select',id:string,additive:boolean):void;(e:'toggle-visibility',id:string):void;
 (e:'add-object',type:ObjectType):void;(e:'add-spawn'):void;(e:'group'):void;(e:'ungroup'):void;
 (e:'copy'):void;(e:'paste'):void;(e:'remove'):void;(e:'import-model'):void;
 (e:'update:searchQuery',value:string):void
}>()
const activeTab=ref<'hierarchy'|'components'>('hierarchy')
const collapsed=ref<string[]>([])
const buckets=computed<Bucket[]>(()=>{
 const query=props.searchQuery.trim().toLocaleLowerCase()
 const match=(o:ObjectInfo)=>!query||o.name.toLocaleLowerCase().includes(query)
 const all=props.objects
 return [
  {id:'terrain',label:'Cenário',icon:'▰',items:all.filter(o=>o.type==='platform'&&!o.importedModel&&match(o))},
  {id:'objects',label:'Objetos',icon:'▤',items:all.filter(o=>o.type==='cube'&&!o.importedModel&&match(o))},
  {id:'models',label:'Modelos 3D',icon:'⬡',items:all.filter(o=>o.importedModel&&match(o))}
 ].filter(group=>group.items.length>0||!query)
})
const isOpen=(id:string)=>!collapsed.value.includes(id)
function toggleFolder(id:string){collapsed.value=isOpen(id)?[...collapsed.value,id]:collapsed.value.filter(x=>x!==id)}
</script>
<template>
 <aside class="hierarchy-panel">
  <div class="hierarchy-tabs">
   <button type="button" :class="{active:activeTab==='hierarchy'}" @click="activeTab='hierarchy'">Hierarquia</button>
   <button type="button" :class="{active:activeTab==='components'}" @click="activeTab='components'">Componentes (0)</button>
  </div>
  <template v-if="activeTab==='hierarchy'">
   <label class="hierarchy-search"><span>⌕</span><input :value="searchQuery" type="search" placeholder="Buscar objetos…" aria-label="Buscar objetos" @input="emit('update:searchQuery',($event.target as HTMLInputElement).value)"/></label>
   <div class="hierarchy-scroll">
    <button class="tree-root" type="button" @click="toggleFolder('root')"><span class="tree-chevron">{{isOpen('root')?'⌄':'›'}}</span><span class="tree-folder">▰</span><strong>{{projectName||'Mundo principal'}}</strong><small>{{objects.length}}</small></button>
    <template v-if="isOpen('root')">
     <div v-for="bucket in buckets" :key="bucket.id" class="tree-group">
      <button class="tree-folder-row" type="button" @click="toggleFolder(bucket.id)"><span class="tree-chevron">{{isOpen(bucket.id)?'⌄':'›'}}</span><span class="tree-folder">{{bucket.icon}}</span><span>{{bucket.label}}</span><small>{{bucket.items.length||''}}</small></button>
      <div v-if="isOpen(bucket.id)" class="tree-children">
       <button v-for="object in bucket.items" :key="object.id" type="button" class="tree-object" :class="{selected:selectedId===object.id,multi:groupSelection.includes(object.id)&&selectedId!==object.id}" :data-testid="'scene-object-'+object.id" @click="emit('select',object.id,$event.ctrlKey||$event.metaKey)">
        <span class="object-type-icon" :class="{imported:object.importedModel,platform:object.type==='platform'}">{{object.importedModel?'⬡':object.type==='platform'?'▰':'◆'}}</span>
        <span class="tree-object-name">{{object.name}}</span>
        <span class="tree-eye" role="button" tabindex="0" :aria-label="object.visible?'Ocultar '+object.name:'Mostrar '+object.name" @click.stop="emit('toggle-visibility',object.id)" @keydown.enter.stop="emit('toggle-visibility',object.id)">{{object.visible?'◉':'○'}}</span>
       </button>
       <div v-if="bucket.items.length===0" class="tree-empty">Nenhum item</div>
      </div>
     </div>
    </template>
    <div v-if="objects.length===0&&!searchQuery" class="hierarchy-hint">Use <b>Adicionar</b> para criar os primeiros objetos da cena.</div>
    <div v-else-if="searchQuery&&buckets.every(b=>b.items.length===0)" class="hierarchy-hint">Nenhum objeto encontrado.</div>
   </div>
   <div class="hierarchy-actions">
    <div class="hierarchy-action-row"><button type="button" :disabled="groupSelection.length<2" @click="emit('group')">Agrupar</button><button type="button" :disabled="groupSelection.length===0" @click="emit('ungroup')">Desagrupar</button></div>
    <div class="hierarchy-icon-row"><button type="button" aria-label="Adicionar cubo" title="Adicionar cubo" @click="emit('add-object','cube')">＋</button><button type="button" aria-label="Duplicar objeto" title="Duplicar" :disabled="!selectedId" @click="emit('copy');emit('paste')">▢</button><button type="button" aria-label="Excluir objeto" title="Excluir selecionado" :disabled="!selectedId" @click="emit('remove')">▤</button></div>
   </div>
  </template>
  <div v-else class="component-library-empty"><span>⬡</span><strong>Componentes (0)</strong><p>A biblioteca de componentes será conectada a esta área na próxima etapa.</p><button type="button" @click="emit('import-model')">Importar modelo 3D</button></div>
 </aside>
</template>