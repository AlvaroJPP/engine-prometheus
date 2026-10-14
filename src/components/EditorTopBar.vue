<script setup lang="ts">
defineProps<{
  projectName: string
  dirty: boolean
  cameraLabel: string
  firstPersonMode: boolean
}>()

const emit = defineEmits<{
  'update:projectName': [value: string]
  'mark-dirty': []
  'new-project': []
  'open-project': []
  'save-project': [saveAs: boolean]
  'cycle-camera': []
  'toggle-first-person': []
}>()
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <div class="logo">P</div>
      <div>
        <div class="title">ENGINE PROMETHEUS</div>
        <div class="subtitle">WORLD EDITOR · PROTOTYPE</div>
      </div>
    </div>

    <div class="project">
      <input :value="projectName" class="pname" spellcheck="false" @input="emit('update:projectName', ($event.target as HTMLInputElement).value); emit('mark-dirty')" />
      <i class="dot" :class="dirty ? 'warn' : 'ok'" :title="dirty ? 'Alterações não salvas' : 'Tudo salvo'" />
    </div>

    <div class="grow" />

    <div class="filebtns">
      <button class="ghost" @click="emit('new-project')">Novo</button>
      <button class="ghost" @click="emit('open-project')">Abrir</button>
      <button class="ghost" @click="emit('save-project', false)">Salvar</button>
      <button class="ghost hide-narrow" @click="emit('save-project', true)">Salvar como…</button>
    </div>

    <button class="cam" :class="{ active: firstPersonMode }" @click="emit('toggle-first-person')">{{ firstPersonMode ? 'Sair 1ª pessoa' : '1ª pessoa' }}</button>
    <button class="cam" @click="emit('cycle-camera')"><i class="cam-ring" />{{ cameraLabel }}</button>
  </header>
</template>
