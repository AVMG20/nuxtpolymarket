<script setup lang="ts">
import type { OpenedPackResult, SealedPackSummary, TcgBundleSummary } from '#shared/types/tcg'
import { wrapUrl } from '~/utils/tcg/wrap'

const toast = useToast()
const { setById, refreshState, refreshSets } = useTcg()

const apiBase = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
  ?? 'http://127.0.0.1:8080'

function packArt(setId: string): string | null {
  return wrapUrl(apiBase, setById(setId)?.plaatjesSetCode)
}

function hideBrokenArt(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none'
}
const { fetchSession } = useAuth()

const { data, pending, refresh } = useApiState('/api/tcg/packs', 'tcg-packs')

const packs = computed(() => data.value?.packs ?? [])
const bundles = computed(() => data.value?.bundles ?? [])
const opened = computed(() => data.value?.opened ?? [])

interface PackGroup {
  key: string
  /** Sealed packs in pack-number order. */
  packs: SealedPackSummary[]
  bundle?: TcgBundleSummary
}

// Every sealed pack gets its own card so players pick which one to open:
// bundles still being opened first, each under its own heading, then loose packs.
const groups = computed<PackGroup[]>(() => {
  const result: PackGroup[] = []
  for (const bundle of bundles.value) {
    const bundled = packs.value.filter(p => p.bundleId === bundle.id)
    if (bundled.length) result.push({ key: bundle.id, packs: bundled, bundle })
  }
  const loose = packs.value.filter(p => !p.bundleId)
    .sort((a, b) => setName(a.setId).localeCompare(setName(b.setId)) || a.packIndex - b.packIndex)
  if (loose.length) result.push({ key: 'loose', packs: loose })
  return result
})

const finishedBundles = computed(() => bundles.value.filter(b => b.sealedCount === 0))
const openedTotal = computed(() =>
  opened.value.reduce((sum, row) => sum + row.count, 0)
  + finishedBundles.value.reduce((sum, b) => sum + b.openedCount, 0))
const showHistory = ref(false)

function setName(setId: string) {
  return setById(setId)?.name ?? 'Unknown set'
}

// ── Opening ─────────────────────────────────────────────────────────────────
const opening = ref<string | null>(null)
const openResult = ref<OpenedPackResult | null>(null)
const openSetCode = ref<string | null>(null)

async function openPack(pack: Pick<SealedPackSummary, 'id' | 'setId'>) {
  if (opening.value || openResult.value) return
  opening.value = pack.id
  try {
    const result = await apiFetch<OpenedPackResult>('/api/tcg/open-pack', {
      method: 'POST',
      body: { packId: pack.id }
    })
    openSetCode.value = setById(pack.setId)?.plaatjesSetCode ?? null
    openResult.value = result
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not open pack'), color: 'error' })
  } finally {
    opening.value = null
  }
}

// Auction a sealed pack (§7.1) — high-value sealed product is auctionable.
const auctionPackId = ref<string | null>(null)
const auctionStart = ref(100)
const auctionStartText = useAmountInput(auctionStart)
const auctionDurationMs = ref(3_600_000)
const auctionDurations = [
  { label: '1 hour', value: 3_600_000 },
  { label: '6 hours', value: 21_600_000 },
  { label: '24 hours', value: 86_400_000 }
]
const auctionSubmitting = ref(false)
async function startPackAuction() {
  if (!auctionPackId.value || auctionSubmitting.value) return
  auctionSubmitting.value = true
  try {
    await apiFetch('/api/tcg/auctions/create', {
      method: 'POST',
      body: { packId: auctionPackId.value, startPrice: Number(auctionStart.value), durationMs: auctionDurationMs.value }
    })
    auctionPackId.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not start auction'), color: 'error' })
  } finally {
    auctionSubmitting.value = false
  }
}

async function onCeremonyClose() {
  openResult.value = null
  openSetCode.value = null
  // The pack is opened and copies are minted — pull the pack list and the
  // set/collection-adjacent state back in sync.
  await Promise.all([refresh(), refreshState(), refreshSets(), fetchSession()])
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-4 p-4">
    <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">
      Sealed packs
    </h2>
    <template v-if="groups.length">
      <div
        v-for="group in groups"
        :key="group.key"
        class="space-y-2"
      >
        <p
          v-if="group.bundle"
          class="flex items-center gap-1.5 text-sm"
        >
          <UIcon
            name="i-lucide-gift"
            class="size-4 text-primary"
          />
          <span class="font-medium text-highlighted">{{ setName(group.bundle.setId) }} bundle</span>
          <span class="text-xs tabular-nums text-muted">
            · {{ group.packs.length }} of {{ group.packs.length + group.bundle.openedCount }} left · week of {{ group.bundle.weekKey }}
          </span>
        </p>
        <p
          v-else-if="groups.length > 1"
          class="text-sm font-medium text-highlighted"
        >
          Loose packs
        </p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <UCard
            v-for="pack in group.packs"
            :key="pack.id"
            :ui="{ body: 'p-3 sm:p-3' }"
          >
            <div class="flex flex-col items-center gap-2 text-center">
              <img
                v-if="packArt(pack.setId)"
                :src="packArt(pack.setId)!"
                :alt="`${setName(pack.setId)} booster pack`"
                class="h-24 w-auto drop-shadow"
                @error="hideBrokenArt"
              >
              <div class="w-full min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ setName(pack.setId) }}
                </p>
                <p class="text-xs tabular-nums text-muted">
                  Pack #{{ pack.packIndex + 1 }}
                </p>
              </div>
              <div class="flex gap-1.5">
                <UButton
                  size="sm"
                  icon="i-lucide-package-open"
                  :loading="opening === pack.id"
                  :disabled="!!opening"
                  @click="openPack(pack)"
                >
                  Open
                </UButton>
                <UButton
                  v-if="!group.bundle"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-gavel"
                  aria-label="Auction this pack"
                  @click="auctionPackId = pack.id"
                />
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
    <UCard v-else>
      <p class="text-sm text-muted">
        {{ pending ? 'Loading…' : 'No sealed packs — grab some in the shop.' }}
      </p>
    </UCard>

    <!-- History: opened loose packs per set and fully opened bundles -->
    <template v-if="openedTotal">
      <UButton
        variant="link"
        color="neutral"
        class="px-0"
        :trailing-icon="showHistory ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="showHistory = !showHistory"
      >
        {{ formatNumber(openedTotal, false) }} packs opened
      </UButton>
      <UCard v-if="showHistory">
        <ul class="divide-y divide-default">
          <li
            v-for="row in opened"
            :key="row.setId"
            class="flex items-center justify-between gap-2 py-1.5 text-sm"
          >
            <span class="text-highlighted">{{ setName(row.setId) }}</span>
            <span class="flex items-center gap-2">
              <UBadge
                v-if="row.godCount"
                color="warning"
                variant="subtle"
                size="sm"
                icon="i-lucide-sparkles"
              >
                {{ row.godCount > 1 ? `${row.godCount} god packs` : 'God pack' }}
              </UBadge>
              <span class="tabular-nums text-muted">{{ formatNumber(row.count, false) }} packs</span>
            </span>
          </li>
          <li
            v-for="bundle in finishedBundles"
            :key="bundle.id"
            class="flex items-center justify-between gap-2 py-1.5 text-sm"
          >
            <span class="flex items-center gap-1.5 text-highlighted">
              <UIcon
                name="i-lucide-gift"
                class="size-3.5 text-muted"
              />
              {{ setName(bundle.setId) }} bundle
              <span class="text-xs text-muted">· week of {{ bundle.weekKey }}</span>
            </span>
            <span class="tabular-nums text-muted">{{ bundle.openedCount }} packs</span>
          </li>
        </ul>
      </UCard>
    </template>

    <UModal
      :open="auctionPackId !== null"
      title="Auction this sealed pack"
      description="The pack stays sealed and cannot be opened while the auction runs. Bids are binding; the winner takes the pack, you receive 95% of the hammer price."
      @update:open="value => { if (!value) auctionPackId = null }"
    >
      <template #body>
        <div class="flex items-end gap-3">
          <UFormField
            label="Starting price"
            class="flex-1"
          >
            <UInput
              v-model="auctionStartText"
              autocomplete="off"
            >
              <template #leading>
                <UIcon
                  name="i-lucide-coins"
                  class="size-3.5 text-yellow-400"
                />
              </template>
              <template v-if="amountPreview(auctionStartText)" #trailing>
                <span class="text-xs tabular-nums text-muted">{{ amountPreview(auctionStartText) }}</span>
              </template>
            </UInput>
          </UFormField>
          <UFormField
            label="Duration"
            class="flex-1"
          >
            <USelect
              v-model="auctionDurationMs"
              :items="auctionDurations"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="auctionPackId = null"
          />
          <UButton
            :loading="auctionSubmitting"
            label="Start auction"
            @click="startPackAuction"
          />
        </div>
      </template>
    </UModal>

    <TcgPackOpen
      v-if="openResult"
      :result="openResult"
      :plaatjes-set-code="openSetCode"
      @close="onCeremonyClose"
    />
  </div>
</template>
