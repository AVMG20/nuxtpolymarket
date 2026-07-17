<script setup lang="ts">
defineProps<{
  disabled?: boolean
}>()

const bet = defineModel<number>({ required: true })
</script>

<template>
  <div>
    <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Bet Amount</label>
    <div class="flex items-center gap-2">
      <UInput v-model.number="bet" type="number" min="1" :disabled="disabled" class="flex-1 font-mono" size="lg" />
      <div class="flex gap-1">
        <UButton color="neutral" variant="soft" :disabled="disabled" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
        <UButton color="neutral" variant="soft" :disabled="disabled" @click="bet = bet * 2">2×</UButton>
      </div>
    </div>
  </div>
</template>
