<script setup lang="ts">
import type { TcgSetDetailPayload } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'

const props = defineProps<{ detail: TcgSetDetailPayload, advanced?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()

const { call } = useTcgAdmin()
const toast = useToast()

const committed = computed(() => props.detail.set.status === 'committed')
const hasChecklist = computed(() => props.detail.cards.length > 0)

const templateCode = computed(() => props.detail.set.templateCode)
const isTemplateCreated = computed(() => templateCode.value != null)

const scrapedAtLabel = computed(() => {
  const iso = props.detail.set.publishedRates?.scrapedAt
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
})

const showReimport = computed(() => !isTemplateCreated.value || props.advanced === true)

const plaatjesSetCode = ref(props.detail.set.plaatjesSetCode ?? '')
watch(() => props.detail.set.plaatjesSetCode, (code) => {
  if (code && !plaatjesSetCode.value) plaatjesSetCode.value = code
})

const importing = ref(false)
const reimportOpen = ref(false)

async function runImport() {
  if (!plaatjesSetCode.value.trim() || importing.value) return
  importing.value = true
  try {
    const result = await call('/api/tcg/admin/sets/import-checklist', {
      setId: props.detail.set.id,
      plaatjesSetCode: plaatjesSetCode.value.trim()
    }) as { cards: number, printings: number }
    toast.add({
      title: 'Checklist imported',
      description: `${result.cards} cards, ${result.printings} printings`,
      color: 'success',
      icon: 'i-lucide-list-checks'
    })
    reimportOpen.value = false
    emit('refresh')
  } catch {
    // call() already toasted the error
  } finally {
    importing.value = false
  }
}

// ── Printings grouped per card ────────────────────────────────────
const printingsByCard = computed(() => {
  const map = new Map<string, TcgSetDetailPayload['printings']>()
  for (const printing of props.detail.printings) {
    const list = map.get(printing.cardId)
    if (list) list.push(printing)
    else map.set(printing.cardId, [printing])
  }
  return map
})

/**
 * Thumbnail source for a card: prefer the suffix-free base printing's bundle,
 * then any bundle; a bundle-less (legacy) printing falls back to its scan
 * folder + asset number.
 */
function thumbProps(card: TcgSetDetailPayload['cards'][number]): { bundle?: string, legacySet?: string, assetNumber?: string } | null {
  const printings = printingsByCard.value.get(card.id) ?? []
  const base = printings.find(p => p.plaatjesCardId === card.plaatjesBaseId && p.bundle)
  const bundle = base?.bundle ?? printings.find(p => p.bundle)?.bundle
  if (bundle) return { bundle }
  const legacy = printings.find(p => !p.bundle && p.assetNumber)
  if (!legacy) return null
  const legacySet = legacySetOf(legacy.plaatjesCardId)
  return legacySet ? { legacySet, assetNumber: legacy.assetNumber! } : null
}

const FINISH_COLOR: Record<string, 'neutral' | 'info' | 'secondary'> = {
  nonholo: 'neutral',
  holo: 'info',
  reverse: 'secondary'
}

function printingLabel(printing: TcgSetDetailPayload['printings'][number]): string {
  return printing.pattern ? `${printing.finish} · ${printing.pattern}` : printing.finish
}
</script>

<template>
  <div>
    <!-- Empty state: nothing imported yet -->
    <div v-if="!hasChecklist" class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-default py-16">
      <UIcon name="i-lucide-list-checks" class="size-8 text-dimmed" />
      <div class="text-center">
        <p class="font-medium">No checklist imported</p>
        <p class="mt-1 text-sm text-muted">Pull the card list from the pokemonplaatjes sidecar to start authoring.</p>
      </div>
      <div v-if="showReimport" class="flex items-end gap-2">
        <UFormField label="Plaatjes set code" size="sm">
          <UInput
            v-model="plaatjesSetCode"
            placeholder="e.g. sv8pt5"
            :disabled="committed || importing"
            class="font-mono"
            @keydown.enter="runImport"
          />
        </UFormField>
        <UButton
          label="Import checklist"
          icon="i-lucide-download"
          :loading="importing"
          :disabled="committed || !plaatjesSetCode.trim()"
          @click="runImport"
        />
      </div>
      <p v-if="committed" class="text-xs text-warning">This set is committed — the checklist can no longer change.</p>
    </div>

    <!-- Imported checklist -->
    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p v-if="isTemplateCreated" class="text-sm text-muted">
          Imported from pokemonplaatjes
          <template v-if="detail.set.plaatjesSetCode">
            (<span class="font-mono text-highlighted">{{ detail.set.plaatjesSetCode }}</span>)
          </template>
          · rates from ThePriceDex
          (<span class="font-mono text-highlighted">{{ templateCode }}</span><template v-if="scrapedAtLabel">, scraped {{ scrapedAtLabel }}</template>)
          · <span class="font-medium text-highlighted tabular-nums">{{ detail.cards.length }}</span> cards,
          <span class="font-medium text-highlighted tabular-nums">{{ detail.printings.length }}</span> printings
        </p>
        <p v-else class="text-sm text-muted">
          <span class="font-medium text-highlighted tabular-nums">{{ detail.cards.length }}</span> cards ·
          <span class="font-medium text-highlighted tabular-nums">{{ detail.printings.length }}</span> printings
          <template v-if="detail.set.plaatjesSetCode">
            · from <span class="font-mono text-highlighted">{{ detail.set.plaatjesSetCode }}</span>
          </template>
        </p>
        <UTooltip v-if="showReimport" :text="committed ? 'Committed sets are frozen' : 'Wipes and re-imports the checklist'" :disabled="!committed">
          <UButton
            label="Re-import"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="subtle"
            size="sm"
            :disabled="committed"
            @click="reimportOpen = true"
          />
        </UTooltip>
      </div>

      <div class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full min-w-[40rem] text-sm">
          <thead>
            <tr class="border-b border-default bg-elevated/50 text-left text-xs uppercase tracking-wider text-muted">
              <th class="px-3 py-2 font-medium" />
              <th class="px-3 py-2 font-medium">#</th>
              <th class="px-3 py-2 font-medium">Name</th>
              <th class="px-3 py-2 font-medium">Rarity</th>
              <th class="px-3 py-2 font-medium">Printings</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="card in detail.cards"
              :key="card.id"
              class="border-b border-default last:border-b-0 hover:bg-elevated/50"
            >
              <td class="w-12 px-3 py-1.5">
                <TcgCardThumb v-if="thumbProps(card)" v-bind="thumbProps(card)!" class="w-9" />
                <div v-else class="aspect-[0.718] w-9 rounded bg-elevated" />
              </td>
              <td class="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted tabular-nums">
                {{ card.number }}<span v-if="card.setTotal" class="text-dimmed">/{{ card.setTotal }}</span>
              </td>
              <td class="px-3 py-1.5 font-medium text-highlighted">{{ card.name }}</td>
              <td class="whitespace-nowrap px-3 py-1.5">
                <UBadge v-if="card.rarity" color="neutral" variant="subtle" size="sm">{{ card.rarity }}</UBadge>
                <span v-else class="text-dimmed">—</span>
              </td>
              <td class="px-3 py-1.5">
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="printing in printingsByCard.get(card.id) ?? []"
                    :key="printing.id"
                    :color="FINISH_COLOR[printing.finish] ?? 'neutral'"
                    variant="subtle"
                    size="sm"
                    class="font-mono"
                  >
                    {{ printingLabel(printing) }}
                  </UBadge>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Re-import confirmation -->
    <UModal v-model:open="reimportOpen" title="Re-import checklist" description="This wipes every imported card and printing for this set and re-imports from the sidecar.">
      <template #body>
        <div class="space-y-4">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Destructive action"
            description="Sheet layouts referencing removed printings will need re-authoring."
          />
          <UFormField label="Plaatjes set code">
            <UInput
              v-model="plaatjesSetCode"
              placeholder="e.g. sv8pt5"
              :disabled="importing"
              class="w-full font-mono"
              @keydown.enter="runImport"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" :disabled="importing" @click="reimportOpen = false" />
          <UButton
            label="Wipe and re-import"
            color="warning"
            icon="i-lucide-refresh-cw"
            :loading="importing"
            :disabled="!plaatjesSetCode.trim()"
            @click="runImport"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
