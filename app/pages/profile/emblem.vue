<script setup lang="ts">
import type { EmblemData } from '#shared/utils/emblem'

const { user, fetchSession, signOut: authSignOut } = useAuth()
const toast = useToast()

const emblemLoading = ref(false)
async function saveEmblem(emblem: EmblemData) {
  emblemLoading.value = true
  try {
    await $fetch('/api/user/emblem', { method: 'PUT', body: { emblem } })
    await fetchSession()
    toast.add({ title: 'Emblem saved', description: 'Your new icon is now visible across Polynux.', color: 'success', icon: 'i-lucide-check' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMessage(e, 'Failed to save emblem'), color: 'error' })
  } finally {
    emblemLoading.value = false
  }
}

async function handleSignOut() {
  await authSignOut({ redirectTo: '/login' })
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Profile Emblem</h1>
        <p class="text-sm text-muted mt-0.5">Create the icon players see in chat, leaderboards, and around the app.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton
          to="/profile"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          label="Profile"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-log-out"
          label="Sign out"
          @click="handleSignOut"
        />
      </div>
    </div>

    <UCard>
      <ProfileEmblemEditor :loading="emblemLoading" :model-value="user?.emblem" @save="saveEmblem" />
    </UCard>
  </UContainer>
</template>
