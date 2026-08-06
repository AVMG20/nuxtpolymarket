<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { TcgSetDetailPayload } from '#shared/types/tcg'

const route = useRoute()
const toast = useToast()
const { user } = useAuth()

const id = computed(() => String(route.params.id))
const isAdmin = computed(() => user.value?.isPokemonAdmin === true)

const { data: detail, error, refresh } = useFetch<TcgSetDetailPayload>('/api/tcg/admin/sets/detail', {
  key: `tcg-admin-set-${id.value}`,
  query: { id }
})

const set = computed(() => detail.value?.set ?? null)

const digestShort = computed(() => {
  const d = set.value?.commitmentDigest
  return d ? `${d.slice(0, 8)}…${d.slice(-8)}` : null
})

async function copyDigest() {
  if (!set.value?.commitmentDigest) return
  await navigator.clipboard.writeText(set.value.commitmentDigest)
  toast.add({ title: 'Commitment digest copied', color: 'success' })
}

const isTemplateCreated = computed(() => set.value?.templateCode != null)

// Advanced mode reveals the Sheets / Pack template tabs on template-created
// sets. Remembered per session.
const advanced = useState('tcg-admin-advanced', () => false)

const allTabs: TabsItem[] = [
  { label: 'Checklist', icon: 'i-lucide-list-checks', slot: 'checklist' },
  { label: 'Sheets', icon: 'i-lucide-grid-3x3', slot: 'sheets' },
  { label: 'Pack template', icon: 'i-lucide-package', slot: 'template' },
  { label: 'Print run', icon: 'i-lucide-printer', slot: 'printrun' },
  { label: 'Debug open', icon: 'i-lucide-package-open', slot: 'debug' }
]

const tabs = computed<TabsItem[]>(() => {
  if (!isTemplateCreated.value || advanced.value) return allTabs
  return allTabs.filter(tab => tab.slot !== 'sheets' && tab.slot !== 'template')
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-6xl mx-auto w-full">
    <!-- Not an admin -->
    <div v-if="user && !isAdmin" class="flex justify-center pt-16">
      <UAlert
        class="max-w-md"
        color="warning"
        icon="i-lucide-shield-alert"
        title="Admins only"
        description="This area is restricted to TCG administrators."
        variant="subtle"
      />
    </div>

    <template v-else-if="isAdmin">
      <!-- Fetch error -->
      <div v-if="error" class="flex justify-center pt-16">
        <UAlert
          class="max-w-md"
          color="error"
          icon="i-lucide-circle-alert"
          title="Failed to load set"
          :description="error.statusMessage ?? error.message"
          variant="subtle"
          :actions="[{ label: 'Retry', color: 'error', variant: 'solid', onClick: () => refresh() }]"
        />
      </div>

      <!-- Loading skeleton -->
      <div v-else-if="!detail" class="space-y-4">
        <USkeleton class="h-4 w-32" />
        <USkeleton class="h-8 w-72" />
        <USkeleton class="h-9 w-full max-w-xl" />
        <USkeleton class="h-64 w-full" />
      </div>

      <template v-else>
        <!-- Header -->
        <div class="mb-6">
          <UButton
            class="mb-3 -ml-2"
            color="neutral"
            icon="i-lucide-arrow-left"
            label="All sets"
            size="xs"
            to="/tcg-admin"
            variant="ghost"
          />
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 class="text-2xl font-bold">{{ set!.name }}</h1>
            <span class="font-mono text-xs text-muted border border-default rounded px-1.5 py-0.5">{{ set!.code }}</span>
            <UBadge
              :color="setStatusColor(set!.status)"
              :label="set!.status"
              size="sm"
              variant="subtle"
            />
            <div v-if="isTemplateCreated" class="ml-auto flex items-center gap-1.5">
              <USwitch
                v-model="advanced"
                label="Advanced"
                size="xs"
              />
            </div>
          </div>
          <div
            v-if="set!.status === 'committed' && digestShort"
            class="mt-2 flex items-center gap-1.5 text-xs text-muted"
          >
            <span class="uppercase tracking-wider font-semibold">Commitment</span>
            <code class="font-mono bg-elevated rounded px-1.5 py-0.5">{{ digestShort }}</code>
            <UButton
              aria-label="Copy commitment digest"
              color="neutral"
              icon="i-lucide-copy"
              size="xs"
              variant="ghost"
              @click="copyDigest"
            />
          </div>
        </div>

        <!-- Tabs -->
        <UTabs
          :items="tabs"
          :unmount-on-hide="false"
          color="primary"
          variant="link"
        >
          <template #checklist>
            <TcgAdminChecklist :detail="detail" :advanced="advanced" class="pt-4" @refresh="refresh" />
          </template>
          <template #sheets>
            <TcgAdminSheetDesigner :detail="detail" class="pt-4" @refresh="refresh" />
          </template>
          <template #template>
            <TcgAdminTemplateEditor :detail="detail" class="pt-4" @refresh="refresh" />
          </template>
          <template #printrun>
            <TcgAdminPrintRun :detail="detail" class="pt-4" @refresh="refresh" />
          </template>
          <template #debug>
            <TcgAdminDebugOpen :detail="detail" class="pt-4" @refresh="refresh" />
          </template>
        </UTabs>
      </template>
    </template>
  </div>
</template>
