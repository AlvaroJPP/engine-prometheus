<script setup lang="ts">
defineProps<{ projectName:string; dirty:boolean; isRunning:boolean; searchQuery:string; theme:'dark'|'light' }>()
defineEmits<{
  (e:'new-project'):void; (e:'open-project'):void; (e:'save-project'):void;
  (e:'undo'):void; (e:'redo'):void; (e:'toggle-play'):void;
  (e:'update:searchQuery', value:string):void; (e:'toggle-theme'):void
}>()
</script>
<template>
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-emblem" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <path d="M24 3.5 29.2 7l6.1-.8 3 5.4 5.8 2.3-.2 6.2 3.1 5.3-3.5 5.1.8 6.1-5.4 3-2.3 5.8-6.2-.2-5.3 3.1-5.1-3.5-6.1.8-3-5.4-5.8-2.3.2-6.2-3.1-5.3 3.5-5.1-.8-6.1 5.4-3 2.3-5.8 6.2.2L24 3.5Z" stroke="currentColor" stroke-width="1.15"/>
          <path d="M24 12.5c-1.8 5.1-7.2 8.1-7.2 14.1a7.2 7.2 0 1 0 14.4 0c0-6-5.4-9-7.2-14.1Z" stroke="currentColor" stroke-width="1.3"/>
          <path d="M24 23.4c-1.2 2.1-3.1 3.4-3.1 5.7a3.1 3.1 0 1 0 6.2 0c0-2.3-1.9-3.6-3.1-5.7Z" fill="#F15A24"/>
        </svg>
      </div>
      <div class="brand-wordmark"><strong>PROMETHEUS</strong><span>ENGINE <small>v0.1.0</small></span></div>
    </div>
    <div class="topbar-project">
      <details class="file-menu">
        <summary>Arquivo <span>⌄</span></summary>
        <div class="file-menu-popover">
          <button type="button" @click="$emit('new-project')"><span>＋</span>Novo projeto</button>
          <button type="button" @click="$emit('open-project')"><span>↗</span>Abrir projeto…</button>
        </div>
      </details>
      <button class="topbar-button save-project-button" type="button" aria-label="Salvar projeto" @click="$emit('save-project')"><span class="button-glyph">▣</span>Salvar<i v-if="dirty"></i></button>
      <button class="topbar-icon-button" type="button" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" @click="$emit('undo')">↶</button>
      <button class="topbar-icon-button" type="button" aria-label="Refazer" title="Refazer (Ctrl+Y)" @click="$emit('redo')">↷</button>
    </div>
    <div class="topbar-mode">
      <button class="mode-button edit-mode" :class="{selected:!isRunning}" type="button" @click="isRunning && $emit('toggle-play')"><span>⌁</span>Editar</button>
      <button class="mode-button play-mode" :class="{selected:isRunning}" type="button" aria-label="Jogar" @click="$emit('toggle-play')"><span>{{isRunning?'■':'▶'}}</span>{{isRunning?'Parar':'Jogar'}}<b>⌄</b></button>
    </div>
    <div class="topbar-tools">
      <label class="global-search"><span>⌕</span><input :value="searchQuery" type="search" placeholder="Pesquisar no editor…" aria-label="Pesquisar no editor" @input="$emit('update:searchQuery',($event.target as HTMLInputElement).value)"/><kbd>Ctrl K</kbd></label>
      <button class="topbar-icon-button theme-button" type="button" :aria-label="theme==='dark'?'Ativar tema claro':'Ativar tema escuro'" title="Alternar aparência" @click="$emit('toggle-theme')">{{theme==='dark'?'☼':'☾'}}</button>
    </div>
  </header>
</template>