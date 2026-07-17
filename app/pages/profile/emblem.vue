<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'
import type { EmblemData } from '#shared/utils/emblem'

interface EmblemHistoryEntry {
  id: string
  emblem: string
  createdAt: string
}

const { user, fetchSession, signOut: authSignOut } = useAuth()
const toast = useToast()
const route = useRoute()

const { data: history, pending: historyPending, refresh: refreshHistory } = await useFetch<EmblemHistoryEntry[]>('/api/user/emblem/history')

const draftEmblem = ref<string | null>(null)
const sharedByName = ref<string | null>(null)

const shareId = route.query.share
if (typeof shareId === 'string' && shareId) {
  try {
    const shared = await $fetch<{ emblem: string, name: string }>(`/api/emblem/share/${shareId}`)
    draftEmblem.value = shared.emblem
    sharedByName.value = shared.name
  } catch {
    toast.add({ title: 'Shared emblem not found', description: 'That link may be invalid or expired.', color: 'error' })
  }
}

const emblemLoading = ref(false)
async function saveEmblem(emblem: EmblemData) {
  emblemLoading.value = true
  try {
    await $fetch('/api/user/emblem', { method: 'PUT', body: { emblem } })
    await fetchSession()
    await refreshHistory()
    draftEmblem.value = null
    sharedByName.value = null
    toast.add({ title: 'Emblem saved', description: 'Your new icon is now visible across Polynux.', color: 'success', icon: 'i-lucide-check' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMessage(e, 'Failed to save emblem'), color: 'error' })
  } finally {
    emblemLoading.value = false
  }
}

function loadHistoryEntry(entry: EmblemHistoryEntry) {
  draftEmblem.value = entry.emblem
  sharedByName.value = null
  toast.add({ title: 'Loaded from history', description: 'Click Save to keep it as your emblem.', color: 'success', icon: 'i-lucide-history' })
}

async function copyShareLink(entry: EmblemHistoryEntry) {
  const url = `${location.origin}/profile/emblem?share=${entry.id}`
  await navigator.clipboard.writeText(url)
  toast.add({ title: 'Share link copied', description: url, color: 'success', icon: 'i-lucide-link' })
}

function relative(date: string) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
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

    <UAlert
      v-if="sharedByName"
      color="primary"
      variant="soft"
      icon="i-lucide-link"
      :title="`Viewing an emblem shared by ${sharedByName}`"
      description="Click Save below to make it yours."
    />

    <UCard>
      <ProfileEmblemEditor :loading="emblemLoading" :model-value="draftEmblem ?? user?.emblem" @save="saveEmblem" />
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold">Emblem History</h2>
          <p class="mt-0.5 text-xs text-muted">Every save is kept here — up to 30, oldest drop off automatically. Load an old one back in, or share it with a link.</p>
        </div>
      </template>

      <div v-if="historyPending" class="flex flex-wrap gap-3">
        <USkeleton v-for="i in 6" :key="i" class="h-24 w-24 rounded-lg" />
      </div>
      <UEmpty
        v-else-if="!history?.length"
        description="No saved emblems yet — hit Save to start your history."
        icon="i-lucide-history"
      />
      <div v-else class="flex flex-wrap gap-3">
        <div
          v-for="entry in history"
          :key="entry.id"
          class="flex w-24 flex-col items-center gap-1.5 rounded-lg border border-default p-2.5"
        >
          <ProfileEmblem :emblem="entry.emblem" class="size-12" />
          <p class="text-center text-[10px] text-muted">{{ relative(entry.createdAt) }}</p>
          <div class="flex gap-1">
            <UTooltip text="Load into editor">
              <UButton
                aria-label="Load into editor"
                color="neutral"
                icon="i-lucide-corner-up-left"
                size="xs"
                variant="ghost"
                @click="loadHistoryEntry(entry)"
              />
            </UTooltip>
            <UTooltip text="Copy share link">
              <UButton
                aria-label="Copy share link"
                color="neutral"
                icon="i-lucide-link"
                size="xs"
                variant="ghost"
                @click="copyShareLink(entry)"
              />
            </UTooltip>
          </div>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
