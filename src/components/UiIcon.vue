<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
</script>
<template>
  <svg class="ui-icon" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <use :href="`/icons.svg#${name}`" />
  </svg>
</template>
