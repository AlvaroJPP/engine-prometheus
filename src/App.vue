<script setup lang="ts">
import '@/styles/app.css'
import AppWorkspace from '@/components/AppWorkspace.vue'
import { useAppController } from '@/composables/useAppController'

const workspaceContext = useAppController()
</script>

<template>
  <AppWorkspace :context="workspaceContext" />
</template>
