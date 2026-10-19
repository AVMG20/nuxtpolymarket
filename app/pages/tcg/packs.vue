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

interface PackStack {
  key: string
  setId: string
  /** Sealed packs in pack-number order; the first one opens next. */
  packs: SealedPackSummary[]
  bundle?: TcgBundleSummary
}

// Sealed packs stack per bundle, then loose ones per set: a stack of identical
// boosters reads better than a grid of identical cards.
const stacks = computed<PackStack[]>(() => {
  const result: PackStack[] = []
  for (const bundle of bundles.value) {
    const bundled = packs.value.filter(p => p.bundleId === bundle.id)
    if (bundled.length) result.push({ key: bundle.id, setId: bundle.setId, packs: bundled, bundle })
  }
  const loose = new Map<string, PackStack>()
  for (const pack of packs.value) {
    if (pack.bundleId) continue
    let stack = loose.get(pack.setId)
    if (!stack) {
      stack = { key: pack.setId, setId: pack.setId, packs: [] }
      loose.set(pack.setId, stack)
      result.push(stack)
    }
    stack.packs.push(pack)
  }
  return result
})

const finishedBundles = computed(() => bundles.value.filter(b => b.sealedCount === 0))
const openedTotal = computed(() =>
  opened.value.reduce((sum, row) => sum + row.count, 0)
  + finishedBundles.value.reduce((sum, b) => sum + b.openedCount, 0))
const showHistory = ref(false)

function packRange(stack: PackStack) {
  const first = stack.packs[0]!.packIndex + 1
  const last = stack.packs[stack.packs.length - 1]!.packIndex + 1
  return first === last ? `#${first}` : `#${first}–#${last}`
}

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
    <div
      v-if="stacks.length"
      class="grid gap-3 sm:grid-cols-2"
    >
      <UCard
        v-for="stack in stacks"
        :key="stack.key"
      >
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <img
              v-if="packArt(stack.setId)"
              :src="packArt(stack.setId)!"
              :alt="`${setName(stack.setId)} booster pack`"
              class="h-20 w-auto drop-shadow"
              @error="hideBrokenArt"
            >
            <UBadge
              v-if="stack.packs.length > 1"
              size="sm"
              class="absolute -right-2 -top-2 tabular-nums"
            >
              ×{{ stack.packs.length }}
            </UBadge>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-highlighted">
              {{ setName(stack.setId) }}<template v-if="stack.bundle"> bundle</template>
            </p>
            <p class="truncate text-xs tabular-nums text-muted">
              <template v-if="stack.bundle">
                {{ stack.packs.length }} of {{ stack.packs.length + stack.bundle.openedCount }} left · week of {{ stack.bundle.weekKey }}
              </template>
              <template v-else>
                {{ stack.packs.length }} sealed · {{ packRange(stack) }}
              </template>
            </p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <UButton
              size="sm"
              icon="i-lucide-package-open"
              :loading="opening === stack.packs[0]!.id"
              :disabled="!!opening"
              @click="openPack(stack.packs[0]!)"
            >
              Open
            </UButton>
            <UButton
              v-if="!stack.bundle"
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-gavel"
              aria-label="Auction a pack"
              @click="auctionPackId = stack.packs[0]!.id"
            />
          </div>
        </div>
      </UCard>
    </div>
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
