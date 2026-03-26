<template>
  <div class="app-shell">
    <ClassicTopBar />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router';
import ClassicTopBar from '@/components/ClassicTopBar.vue';
</script>
