<script setup lang="ts">
const emit = defineEmits<{
  'open-interface': []
  'open-player': []
  'open-scripts': []
  'open-controls': []
  'open-settings': []
}>()
</script>

<template>
  <aside class="editor-side-rail" aria-label="Navegação principal do editor">
    <nav class="editor-side-rail-main">
      <button class="editor-rail-item active" type="button" aria-current="page" title="Cena">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg><span>Cena</span>
      </button>
      <button class="editor-rail-item" type="button" title="Abrir editor de interface" @click="emit('open-interface')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 8h16M8 3.5v4.5M16 3.5v4.5"/></svg><span>Interface</span>
      </button>
      <button class="editor-rail-item" type="button" title="Configurar jogador" @click="emit('open-player')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7.5" r="3.2"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/></svg><span>Jogador</span>
      </button>
      <button class="editor-rail-item" type="button" title="Abrir Visual Script" @click="emit('open-scripts')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.5 7.5l4 8M17.5 7.5l-4 8"/></svg><span>Scripts</span>
      </button>
      <button class="editor-rail-item" type="button" title="Configurar controles" @click="emit('open-controls')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h4M9 8v4M15.5 10h.01M18 13h.01"/></svg><span>Controles</span>
      </button>
    </nav>
    <div class="editor-side-rail-footer">
      <button class="editor-rail-item" type="button" title="Configurações e organização da viewport" @click="emit('open-settings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.3 1-1.5 2.6-1.6-.6a7.6 7.6 0 0 1-1.6.9l-.3 1.7h-3l-.3-1.7a7.6 7.6 0 0 1-1.6-.9l-1.6.6-1.5-2.6 1.3-1a7.5 7.5 0 0 1 0-1.8l-1.3-1 1.5-2.6 1.6.6a7.6 7.6 0 0 1 1.6-.9l.3-1.7h3l.3 1.7a7.6 7.6 0 0 1 1.6.9l1.6-.6 1.5 2.6-1.3 1a7.5 7.5 0 0 1 0 1.8Z"/></svg><span>Configurações</span>
      </button>
    </div>
  </aside>
</template>
