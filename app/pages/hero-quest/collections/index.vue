<script setup lang="ts">
/**
 * `/hero-quest/collections` has no content of its own — it is the submenu's parent. Landing on
 * it goes to the first collection rather than showing an empty frame.
 */
definePageMeta({ redirect: '/hero-quest/collections/gear' })
</script>

<template>
  <div />
</template>
