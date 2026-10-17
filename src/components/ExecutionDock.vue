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
    <button class="media-orb media-stop" :class="{ active: mode === 'stopped' }" @click="emit('stop')" title="Parar execução" aria-label="Parar execução"><span class="orb-glyph">■</span><small>Parar</small></button>
    <button class="media-orb media-run" :class="{ active: mode === 'running' }" @click="emit('run')" title="Executar cena" aria-label="Jogar"><span class="orb-glyph">▶</span><small>Jogar</small></button>
    <button class="media-orb media-edit" :class="{ active: mode === 'edit' }" @click="emit('edit')" title="Voltar ao modo de edição" aria-label="Voltar ao modo de edição"><span class="orb-glyph">✎</span><small>Editar</small></button>
    <span class="dock-state"><i :class="mode"></i>{{ mode === 'running' ? 'Em execução' : mode === 'stopped' ? 'Interrompido' : 'Modo de edição' }}</span>
  </footer>
</template>
