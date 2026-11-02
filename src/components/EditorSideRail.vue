<script setup lang="ts">
type Section='scene'|'interface'|'player'|'scripts'|'controls'|'settings'
defineProps<{activeSection:Section}>()
defineEmits<{(e:'navigate',section:Section):void}>()
const items:Array<{id:Section;label:string;icon:string}>= [
 {id:'scene',label:'Cena',icon:'▱'},{id:'interface',label:'Interface',icon:'▣'},
 {id:'player',label:'Jogador',icon:'♙'},{id:'scripts',label:'Scripts',icon:'⌘'},
 {id:'controls',label:'Controles',icon:'◎'}
]
</script>
<template>
 <nav class="side-rail" aria-label="Navegação do editor">
  <div class="rail-main">
   <button v-for="item in items" :key="item.id" class="rail-item" :class="{active:activeSection===item.id}" type="button" :aria-current="activeSection===item.id?'page':undefined" @click="$emit('navigate',item.id)">
    <span class="rail-icon" aria-hidden="true">{{item.icon}}</span><span>{{item.label}}</span>
   </button>
  </div>
  <button class="rail-item rail-settings" :class="{active:activeSection==='settings'}" type="button" @click="$emit('navigate','settings')"><span class="rail-icon">⚙</span><span>Configurações</span></button>
 </nav>
</template>