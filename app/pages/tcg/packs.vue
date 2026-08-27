<script setup lang="ts">
import type { OpenedPackResult, SealedPackSummary } from '#shared/types/tcg'
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

const loosePacks = computed(() => packs.value.filter(p => !p.bundleId))
const looseSealed = computed(() => loosePacks.value.filter(p => p.state === 'sealed'))
const looseOpened = computed(() => loosePacks.value.filter(p => p.state === 'opened'))

const expandedBundle = ref<string | null>(null)
function bundlePacks(bundleId: string) {
  return packs.value.filter(p => p.bundleId === bundleId)
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
    toast.add({ title: 'Pack auction started — find it on the Market tab', color: 'success' })
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
    <!-- Bundles -->
    <template v-if="bundles.length">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">
        Bundles
      </h2>
      <UCard
        v-for="bundle in bundles"
        :key="bundle.id"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-gift"
              class="size-5 text-primary"
            />
            <div>
              <p class="font-medium text-highlighted">
                {{ setName(bundle.setId) }} bundle
              </p>
              <p class="text-xs text-muted">
                Week of {{ bundle.weekKey }} · {{ bundle.sealedCount }} sealed · {{ bundle.openedCount }} opened
              </p>
            </div>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            :icon="expandedBundle === bundle.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            @click="expandedBundle = expandedBundle === bundle.id ? null : bundle.id"
          >
            {{ expandedBundle === bundle.id ? 'Hide packs' : 'Show packs' }}
          </UButton>
        </div>

        <div
          v-if="expandedBundle === bundle.id"
          class="mt-3 grid gap-2 border-t border-default pt-3 sm:grid-cols-2 md:grid-cols-3"
        >
          <div
            v-for="pack in bundlePacks(bundle.id)"
            :key="pack.id"
            class="flex items-center justify-between gap-2 rounded-md bg-elevated px-3 py-2"
          >
            <span class="text-sm tabular-nums text-highlighted">Pack #{{ pack.packIndex + 1 }}</span>
            <UButton
              v-if="pack.state === 'sealed'"
              size="xs"
              icon="i-lucide-package-open"
              :loading="opening === pack.id"
              :disabled="!!opening"
              @click="openPack(pack)"
            >
              Open
            </UButton>
            <UBadge
              v-else
              color="neutral"
              variant="subtle"
              size="sm"
            >
              Opened
            </UBadge>
          </div>
        </div>
      </UCard>
    </template>

    <!-- Loose sealed packs -->
    <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">
      Sealed packs
    </h2>
    <div
      v-if="looseSealed.length"
      class="grid gap-3 sm:grid-cols-2 md:grid-cols-3"
    >
      <UCard
        v-for="pack in looseSealed"
        :key="pack.id"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <img
              v-if="packArt(pack.setId)"
              :src="packArt(pack.setId)!"
              :alt="`${setName(pack.setId)} booster pack`"
              class="h-16 w-auto shrink-0 drop-shadow"
              @error="hideBrokenArt"
            >
            <div>
              <p class="text-sm font-medium text-highlighted">
                {{ setName(pack.setId) }}
              </p>
              <p class="text-xs tabular-nums text-muted">
                Pack #{{ pack.packIndex + 1 }}
              </p>
            </div>
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
              size="sm"
              color="neutral"
              variant="subtle"
              icon="i-lucide-gavel"
              @click="auctionPackId = pack.id"
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

    <!-- Opened packs (compact) -->
    <template v-if="looseOpened.length">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">
        Opened packs
      </h2>
      <UCard>
        <ul class="divide-y divide-default">
          <li
            v-for="pack in looseOpened"
            :key="pack.id"
            class="flex items-center justify-between gap-2 py-1.5 text-sm"
          >
            <span class="text-muted">{{ setName(pack.setId) }} · Pack #{{ pack.packIndex + 1 }}</span>
            <UBadge
              v-if="pack.isGod"
              color="warning"
              variant="subtle"
              size="sm"
              icon="i-lucide-sparkles"
            >
              God pack
            </UBadge>
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
              v-model.number="auctionStart"
              type="number"
              :min="1"
            >
              <template #leading>
                <UIcon
                  name="i-lucide-coins"
                  class="size-3.5 text-yellow-400"
                />
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
