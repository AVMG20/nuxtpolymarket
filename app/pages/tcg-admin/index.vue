<script setup lang="ts">
import type { TcgAdminSet } from '#shared/types/tcg'

// Row shape of GET /api/tcg/admin/templates.
interface RateTemplateRow {
  code: string
  name: string
  slug: string | null
  cardsPerPack: number | null
  packsPerBox: number | null
  tierCount: number
  plaatjesSetCode: string | null
  cards: number | null
}

const { user } = useAuth()
const { call } = useTcgAdmin()
const toast = useToast()

const isAdmin = computed(() => user.value?.isPokemonAdmin === true)

const { data: sets, pending } = useFetch<TcgAdminSet[]>('/api/tcg/admin/sets', {
  key: 'tcg-admin-sets',
  immediate: true,
  default: () => []
})

// ── New set from template (primary flow) ──────────────────────────
const templateOpen = ref(false)
const templateSearch = ref('')
const creatingCode = ref<string | null>(null)

const { data: templateData, pending: templatesPending, error: templatesError, execute: loadTemplates } = useFetch<{ templates: RateTemplateRow[], sidecarUnavailable?: boolean }>('/api/tcg/admin/templates', {
  key: 'tcg-admin-templates',
  immediate: false
})

watch(templateOpen, (open) => {
  if (open && !templateData.value && !templatesPending.value) {
    loadTemplates()
  }
})

const filteredTemplates = computed(() => {
  const rows = templateData.value?.templates ?? []
  const q = templateSearch.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(t => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
})

async function createFromTemplate(template: RateTemplateRow) {
  if (!template.plaatjesSetCode || creatingCode.value) return
  creatingCode.value = template.code
  try {
    const res = await call<{ setId: string, warnings: string[], cards: number, printings: number }>(
      '/api/tcg/admin/sets/create-from-template',
      { pricedexCode: template.code }
    )
    toast.add({
      title: `Set created from ${template.name}`,
      description: res.warnings.length > 0
        ? `${res.cards} cards, ${res.printings} printings · ${res.warnings.length} warning${res.warnings.length === 1 ? '' : 's'}`
        : `${res.cards} cards, ${res.printings} printings`,
      color: res.warnings.length > 0 ? 'warning' : 'success',
      icon: 'i-lucide-layers'
    })
    templateOpen.value = false
    await navigateTo(`/tcg-admin/${res.setId}`)
  } catch {
    // call() already toasted the error
  } finally {
    creatingCode.value = null
  }
}

// ── Blank set (advanced, demoted) ─────────────────────────────────
const createOpen = ref(false)
const creating = ref(false)
const form = reactive({ name: '', code: '', plaatjesSetCode: '' })

function openBlankSet() {
  templateOpen.value = false
  createOpen.value = true
}

async function createSet() {
  if (!form.name.trim() || !form.code.trim() || creating.value) return
  creating.value = true
  try {
    const created = await call<TcgAdminSet>('/api/tcg/admin/sets/create', {
      name: form.name.trim(),
      code: form.code.trim(),
      plaatjesSetCode: form.plaatjesSetCode.trim() || undefined
    }, 'Set created')
    createOpen.value = false
    form.name = ''
    form.code = ''
    form.plaatjesSetCode = ''
    await navigateTo(`/tcg-admin/${created.id}`)
  } finally {
    creating.value = false
  }
}

function soldPct(s: TcgAdminSet): number {
  if (!s.targetPackCount) return 0
  return Math.min(100, (s.packsSold / s.targetPackCount) * 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-5xl mx-auto w-full">
    <!-- Not an admin (or not signed in) -->
    <div v-if="!isAdmin" class="flex justify-center pt-16">
      <UAlert
        class="max-w-md"
        color="warning"
        icon="i-lucide-shield-alert"
        title="Admins only"
        :description="user ? 'This area is restricted to TCG administrators.' : 'Sign in with a TCG administrator account to access this area.'"
        variant="subtle"
      />
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-end justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">TCG Admin</p>
          <h1 class="text-2xl font-bold">Print runs</h1>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="New set from template"
          @click="templateOpen = true"
        />
      </div>

      <!-- Sets table -->
      <div class="border border-default rounded-lg overflow-hidden bg-elevated/50">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-left">
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Set</th>
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Code</th>
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider text-right">Target N</th>
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider w-44">Sold</th>
                <th class="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in sets"
                :key="s.id"
                class="border-b border-default last:border-b-0 cursor-pointer hover:bg-elevated transition-colors"
                @click="navigateTo(`/tcg-admin/${s.id}`)"
              >
                <td class="px-4 py-3 font-medium">{{ s.name }}</td>
                <td class="px-4 py-3 font-mono text-xs text-muted">{{ s.code }}</td>
                <td class="px-4 py-3">
                  <UBadge
                    :color="setStatusColor(s.status)"
                    :label="s.status"
                    size="sm"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ s.targetPackCount != null ? formatNumber(s.targetPackCount, false) : '—' }}
                </td>
                <td class="px-4 py-3">
                  <template v-if="s.targetPackCount">
                    <div class="flex items-center gap-2">
                      <UProgress
                        :model-value="soldPct(s)"
                        color="primary"
                        size="sm"
                        class="w-20"
                      />
                      <span class="text-xs text-muted tabular-nums whitespace-nowrap">
                        {{ formatNumber(s.packsSold, false) }} / {{ formatNumber(s.targetPackCount, false) }}
                      </span>
                    </div>
                  </template>
                  <span v-else class="text-xs text-muted">—</span>
                </td>
                <td class="px-4 py-3 text-right text-xs text-muted tabular-nums whitespace-nowrap">
                  {{ formatDate(s.createdAt) }}
                </td>
              </tr>
              <tr v-if="!pending && sets.length === 0">
                <td colspan="6" class="px-4 py-12 text-center text-muted">
                  <UIcon name="i-lucide-layers" class="size-6 mx-auto mb-2 opacity-60" />
                  <p class="text-sm">No sets yet. Create one to start authoring a print run.</p>
                </td>
              </tr>
              <tr v-if="pending && sets.length === 0">
                <td colspan="6" class="px-4 py-4">
                  <div class="space-y-2">
                    <USkeleton class="h-5 w-full" />
                    <USkeleton class="h-5 w-full" />
                    <USkeleton class="h-5 w-2/3" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- New set from template modal -->
      <UModal
        v-model:open="templateOpen"
        title="New set from template"
        description="Pick a scraped ThePriceDex rate template — the set is created fully authored: checklist, sheets and pack template."
        :ui="{ content: 'max-w-2xl' }"
      >
        <template #body>
          <div class="space-y-3">
            <UInput
              v-model="templateSearch"
              icon="i-lucide-search"
              placeholder="Search templates…"
              class="w-full"
              autofocus
            />

            <UAlert
              v-if="templateData?.sidecarUnavailable"
              color="warning"
              variant="subtle"
              icon="i-lucide-unplug"
              title="Card data sidecar unreachable"
              description="Checklist coverage could not be checked — every template is shown without card data. Start the pokemonplaatjes sidecar and reopen this dialog."
            />

            <UAlert
              v-if="templatesError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Failed to load templates"
              :description="templatesError.statusMessage ?? templatesError.message"
            />

            <div v-else-if="templatesPending && !templateData" class="space-y-2">
              <USkeleton class="h-9 w-full" />
              <USkeleton class="h-9 w-full" />
              <USkeleton class="h-9 w-2/3" />
            </div>

            <div v-else class="max-h-96 overflow-y-auto rounded-lg border border-default">
              <table class="w-full text-sm">
                <thead class="sticky top-0">
                  <tr class="border-b border-default bg-elevated text-left text-[11px] tracking-wider text-muted uppercase">
                    <th class="px-3 py-2 font-medium">Set</th>
                    <th class="px-3 py-2 font-medium">Code</th>
                    <th class="px-3 py-2 text-right font-medium">Cards/pack</th>
                    <th class="px-3 py-2 text-right font-medium">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="t in filteredTemplates"
                    :key="t.code"
                    :class="[
                      'border-b border-default last:border-b-0 transition-colors',
                      t.plaatjesSetCode
                        ? 'cursor-pointer hover:bg-elevated'
                        : 'opacity-50 cursor-not-allowed',
                      creatingCode && creatingCode !== t.code ? 'pointer-events-none' : ''
                    ]"
                    @click="createFromTemplate(t)"
                  >
                    <td class="px-3 py-2 font-medium">
                      <span class="inline-flex items-center gap-2">
                        {{ t.name }}
                        <UIcon
                          v-if="creatingCode === t.code"
                          name="i-lucide-loader-circle"
                          class="size-4 animate-spin text-muted"
                        />
                      </span>
                    </td>
                    <td class="px-3 py-2 font-mono text-xs text-muted">{{ t.code }}</td>
                    <td class="px-3 py-2 text-right font-mono tabular-nums">{{ t.cardsPerPack ?? '—' }}</td>
                    <td class="px-3 py-2 text-right">
                      <span v-if="t.plaatjesSetCode" class="font-mono text-xs tabular-nums text-muted">
                        {{ t.cards != null ? `${t.cards} cards` : t.plaatjesSetCode }}
                      </span>
                      <span v-else class="text-xs text-dimmed italic">no card data</span>
                    </td>
                  </tr>
                  <tr v-if="filteredTemplates.length === 0">
                    <td colspan="4" class="px-3 py-8 text-center text-sm text-muted">No templates match the search</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full items-center justify-between gap-2">
            <UButton
              color="neutral"
              label="blank set (advanced)"
              size="xs"
              variant="link"
              @click="openBlankSet"
            />
            <UButton
              color="neutral"
              label="Cancel"
              variant="ghost"
              @click="templateOpen = false"
            />
          </div>
        </template>
      </UModal>

      <!-- Blank set modal (advanced) -->
      <UModal v-model:open="createOpen" title="Blank set" description="Creates an empty draft set — import a checklist and design sheets before committing.">
        <template #body>
          <div class="space-y-4">
            <UFormField label="Name" required>
              <UInput
                v-model="form.name"
                autofocus
                class="w-full"
                placeholder="Stellar Crown"
              />
            </UFormField>
            <UFormField label="Code" required help="Short internal identifier, e.g. SCR">
              <UInput
                v-model="form.code"
                class="w-full font-mono"
                placeholder="SCR"
              />
            </UFormField>
            <UFormField label="Plaatjes set code" help="Set code in the pokemonplaatjes API, used for the checklist import">
              <UInput
                v-model="form.plaatjesSetCode"
                class="w-full font-mono"
                placeholder="sv7"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              label="Cancel"
              variant="ghost"
              @click="createOpen = false"
            />
            <UButton
              :disabled="!form.name.trim() || !form.code.trim()"
              :loading="creating"
              label="Create set"
              @click="createSet"
            />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
