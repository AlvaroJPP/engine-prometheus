<script setup lang="ts">
import UiIcon from './UiIcon.vue'

defineProps<{ projectName:string; dirty:boolean; isRunning:boolean; searchQuery:string; theme:'dark'|'light' }>()
defineEmits<{
  (e:'new-project'):void
  (e:'open-project'):void
  (e:'save-project'):void
  (e:'undo'):void
  (e:'redo'):void
  (e:'toggle-play'):void
  (e:'update:searchQuery', value:string):void
  (e:'toggle-theme'):void
}>()
</script>
<template>
  <header class="topbar">
    <div class="topbar-brand">
      <picture class="brand-logo-picture">
        <source media="(max-width:700px)" srcset="/logo-prometeu-mark.svg" />
        <img class="brand-logo" src="/logo-prometeu-header.svg" alt="Prometeu Engine" draggable="false" />
      </picture>
    </div>
    <div class="topbar-project">
      <details class="file-menu">
        <summary>Arquivo <UiIcon name="chevron-down" :size="14" /></summary>
        <div class="file-menu-popover">
          <button type="button" @click="$emit('new-project')"><span>＋</span>Novo projeto</button>
          <button type="button" @click="$emit('open-project')"><span>↗</span>Abrir projeto…</button>
        </div>
      </details>
      <button class="topbar-button save-project-button" type="button" aria-label="Salvar projeto" @click="$emit('save-project')"><UiIcon name="save" :size="17" /> Salvar <i v-if="dirty"></i></button>
      <button class="topbar-icon-button" type="button" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" @click="$emit('undo')"><UiIcon name="undo" :size="18" /></button>
      <button class="topbar-icon-button" type="button" aria-label="Refazer" title="Refazer (Ctrl+Y)" @click="$emit('redo')"><UiIcon name="redo" :size="18" /></button>
    </div>
    <div class="topbar-mode">
      <button class="mode-button edit-mode" :class="{selected:!isRunning}" type="button" @click="isRunning && $emit('toggle-play')"><UiIcon name="pencil" :size="16" /> Editar</button>
      <button class="mode-button play-mode" :class="{selected:isRunning}" type="button" aria-label="Jogar" @click="$emit('toggle-play')"><UiIcon :name="isRunning ? 'square' : 'play'" :size="15" /> {{isRunning?'Parar':'Jogar'}} <UiIcon name="chevron-down" :size="13" /></button>
    </div>
    <div class="topbar-tools">
      <label class="global-search"><UiIcon name="search" :size="18" /><input :value="searchQuery" type="search" placeholder="Pesquisar no editor…" aria-label="Pesquisar no editor" @input="$emit('update:searchQuery',($event.target as HTMLInputElement).value)" /><kbd>Ctrl K</kbd></label>
      <button class="topbar-icon-button theme-button" type="button" :aria-label="theme==='dark'?'Ativar tema claro':'Ativar tema escuro'" title="Alternar aparência" @click="$emit('toggle-theme')"><UiIcon :name="theme==='dark' ? 'sun' : 'moon'" :size="19" /></button>
    </div>
  </header>
</template>
