<script setup lang="ts">
import type { DisplaySummary } from '~~/server/utils/tcg/display'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import { TCG_DISPLAY } from '#shared/utils/tcg/display'

/* The display hub (§10.5): your binders (raw cards) and shelves (slabs). */
const { data: displays, refresh } = useAsyncData('tcg-displays', () => apiFetch<DisplaySummary[]>('/api/tcg/displays'))
const toast = useToast()

const binders = computed(() => (displays.value ?? []).filter(display => display.kind === 'binder'))
const shelves = computed(() => (displays.value ?? []).filter(display => display.kind === 'shelf'))

function coverProps(display: DisplaySummary) {
  const cover = display.cover
  if (!cover) return null
  if (cover.bundle) return { bundle: cover.bundle }
  const legacySet = legacySetOf(cover.plaatjesCardId)
  return legacySet && cover.assetNumber ? { legacySet, assetNumber: cover.assetNumber } : null
}

const createOpen = ref(false)
const createKind = ref<'binder' | 'shelf'>('binder')
const createName = ref('')
const creating = ref(false)
async function create() {
  if (creating.value) return
  creating.value = true
  try {
    const display = await apiFetch<{ id: string }>('/api/tcg/displays/create', {
      method: 'POST',
      body: { kind: createKind.value, name: createName.value }
    })
    createOpen.value = false
    createName.value = ''
    await refresh()
    await navigateTo(`/tcg/display/${display.id}`)
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not create'), color: 'error' })
  } finally {
    creating.value = false
  }
}

async function remove(displayId: string) {
  try {
    await apiFetch(`/api/tcg/displays/${displayId}`, { method: 'DELETE' })
    toast.add({ title: 'Display deleted — the cards stay in your collection', color: 'success' })
    await refresh()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not delete'), color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6 p-4">
    <div class="flex items-center justify-between">
      <span class="text-xs text-muted">Binders show off your raw cards, shelves your slabs — arrangement is the whole point.</span>
      <UButton
        icon="i-lucide-plus"
        size="sm"
        label="New display"
        @click="createOpen = true"
      />
    </div>

    <section
      v-for="group in [
        { title: 'Binders', items: binders, empty: 'No binders yet — a binder is how raw cards get shown off.' },
        { title: 'Shelves', items: shelves, empty: 'No shelves yet — grade something and give the slab a spot.' }
      ]"
      :key="group.title"
    >
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{{ group.title }}</h2>
      <div
        v-if="group.items.length"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      >
        <div
          v-for="display in group.items"
          :key="display.id"
          class="group relative"
        >
          <NuxtLink
            :to="`/tcg/display/${display.id}`"
            class="block cursor-pointer rounded-lg bg-elevated p-3 transition hover:ring-1 hover:ring-primary"
          >
            <div class="mx-auto w-24">
              <template v-if="coverProps(display)">
                <TcgCardThumb v-bind="coverProps(display)!" />
              </template>
              <div
                v-else
                class="flex aspect-[0.718] w-full items-center justify-center rounded border border-dashed border-default"
              >
                <UIcon
                  :name="display.kind === 'binder' ? 'i-lucide-book-open' : 'i-lucide-gallery-thumbnails'"
                  class="size-6 text-dimmed"
                />
              </div>
            </div>
            <p class="mt-2 truncate text-center text-sm font-medium text-highlighted">{{ display.name }}</p>
            <p class="text-center text-xs tabular-nums text-muted">{{ display.filled }}/{{ display.capacity }} pockets</p>
          </NuxtLink>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            class="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100"
            @click.prevent="remove(display.id)"
          />
        </div>
      </div>
      <div
        v-else
        class="rounded-lg bg-elevated/50 px-4 py-3 text-sm text-muted"
      >
        {{ group.empty }}
      </div>
    </section>

    <UModal v-model:open="createOpen">
      <template #content>
        <div class="flex flex-col gap-4 p-5">
          <h3 class="text-base font-semibold text-highlighted">New display</h3>
          <UFormField label="Kind">
            <USelect
              v-model="createKind"
              class="w-full"
              :items="[
                { label: 'Binder — raw cards, pages of nine', value: 'binder' },
                { label: 'Shelf — graded slabs, rows of six', value: 'shelf' }
              ]"
            />
          </UFormField>
          <UFormField label="Name">
            <UInput
              v-model="createName"
              class="w-full"
              :maxlength="TCG_DISPLAY.nameMaxLength"
              placeholder="e.g. Jungle master set"
              @keyup.enter="create"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="createOpen = false"
            />
            <UButton
              :loading="creating"
              label="Create"
              @click="create"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
