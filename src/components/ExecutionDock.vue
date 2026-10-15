<script setup lang="ts">
defineProps<{ mode: 'edit' | 'running' | 'stopped' }>()

const emit = defineEmits<{
  run: []
  stop: []
  edit: []
}>()
</script>

<template>
  <footer class="execution-dock runtime-controls" aria-label="Controles de execução">
    <button class="media-orb media-stop" :class="{ active: mode === 'stopped' }" @click="emit('stop')" title="Parar execução" aria-label="Stop"><span class="orb-glyph">■</span><small>Stop</small></button>
    <button class="media-orb media-run" :class="{ active: mode === 'running' }" @click="emit('run')" title="Executar cena" aria-label="Run"><span class="orb-glyph">▶</span><small>Run</small></button>
    <button class="media-orb media-edit" :class="{ active: mode === 'edit' }" @click="emit('edit')" title="Voltar ao modo de edição" aria-label="Edit"><span class="orb-glyph">✎</span><small>Edit</small></button>
    <span class="dock-state"><i :class="mode"></i>{{ mode === 'running' ? 'EM EXECUÇÃO' : mode === 'stopped' ? 'INTERROMPIDO' : 'MODO DE EDIÇÃO' }}</span>
  </footer>
</template>
