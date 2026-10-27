<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { ARTIFACT_TYPES, gemCraftCost, getArtifact, getPlant, type ArtifactType } from '#shared/utils/xeno'
import { ARTIFACT_FAMILIES, artifactEffectLines, artifactEffectSummary, roman, type ArtifactFamily } from '~/lib/xeno-ui'

const { inventory, buyArtifact, deleteArtifacts, freeArtifacts, gridSlots, breederSlots, unlockedTypeIds } = useXeno()
const { user } = useAuth()
const sound = useXenoSound()
const fx = useXenoFx()

const gems = computed(() => Number(user.value?.gems ?? 0))
const gemCraft = ref(false)
function toggleGem() {
  gemCraft.value = !gemCraft.value
  sound.play('select')
}

/** The craft endpoint takes 1-50 per request (server/api/xeno/artifacts/buy.post.ts). */
const MAX_PER_CRAFT = 50

// Owned plant counts by type (any speed / yield counts for crafting).
const ownedByType = computed(() => {
  const m = new Map<string, number>()
  for (const i of inventory.value as any[]) m.set(i.typeId, (m.get(i.typeId) ?? 0) + i.quantity)
  return m
})
const owned = (id: string) => ownedByType.value.get(id) ?? 0
const known = computed(() => new Set(unlockedTypeIds.value))

function maxCraftable(art: ArtifactType): number {
  let max = Math.min(...art.cost.map(c => Math.floor(owned(c.plantTypeId) / c.quantity)))
  if (gemCraft.value) max = Math.min(max, Math.floor(gems.value / gemCraftCost(art)))
  return Number.isFinite(max) ? Math.max(0, max) : 0
}

/** What's short for one craft of `count`, e.g. "3 more Sprout · 40 more gems". */
function missingText(art: ArtifactType, count = 1): string {
  const short: string[] = []
  for (const c of art.cost) {
    const need = c.quantity * count - owned(c.plantTypeId)
    if (need > 0) short.push(`${formatNumber(need, false)} more ${known.value.has(c.plantTypeId) ? (getPlant(c.plantTypeId)?.name ?? c.plantTypeId) : 'undiscovered plant'}`)
  }
  if (gemCraft.value) {
    const need = gemCraftCost(art) * count - gems.value
    if (need > 0) short.push(`${formatNumber(need, false)} more gems`)
  }
  return short.length ? `Need ${short.join(' · ')}` : ''
}

// ── How many to craft (per artifact, clamped to what you can afford and the server cap) ──
const qtyText = ref<Record<string, string>>({})
function craftLimit(art: ArtifactType): number {
  return Math.min(MAX_PER_CRAFT, maxCraftable(art))
}
function craftCount(art: ArtifactType): number {
  const n = Math.floor(Number(qtyText.value[art.id] ?? 1) || 1)
  return Math.max(1, Math.min(n, Math.max(1, craftLimit(art))))
}
function setCount(art: ArtifactType, n: number) {
  qtyText.value[art.id] = String(Math.max(1, Math.min(Math.floor(n) || 1, Math.max(1, craftLimit(art)))))
  sound.play('select')
}
function onCountInput(art: ArtifactType, e: Event) {
  qtyText.value[art.id] = (e.target as HTMLInputElement).value
}
function onCountCommit(art: ArtifactType, e: Event) {
  const el = e.target as HTMLInputElement
  qtyText.value[art.id] = String(craftCount(art))
  el.value = qtyText.value[art.id]!
}
// When crafting or selling lowers what you can make, pull the chosen counts down with it.
watch([ownedByType, gems, gemCraft], () => {
  for (const id of Object.keys(qtyText.value)) {
    const art = getArtifact(id)
    if (art && Number(qtyText.value[id]) > Math.max(1, craftLimit(art))) qtyText.value[id] = String(Math.max(1, craftLimit(art)))
  }
})

// ── Families and the level switch ────────────────────────────────────────────
function familyLevels(f: ArtifactFamily): ArtifactType[] {
  return ARTIFACT_TYPES.filter(a => f.matches(a.id)).sort((a, b) => a.level - b.level)
}
const families = ARTIFACT_FAMILIES.map(f => ({ ...f, levels: familyLevels(f) }))
const groups = [
  { label: 'For planters', domain: 'grid' as const },
  { label: 'For pods', domain: 'breeder' as const }
].map(g => ({ ...g, families: families.filter(f => f.domain === g.domain) }))

// Each family shows the level the player picked, or else the highest level whose
// ingredients they have discovered (which follows the state once it loads).
const pickedRung = ref<Record<string, number>>({})
const defaultRung = computed(() => {
  const m: Record<string, number> = {}
  for (const f of families) {
    const reachable = f.levels.filter(a => a.cost.every(c => known.value.has(c.plantTypeId)))
    m[f.key] = reachable.at(-1)?.level ?? 1
  }
  return m
})
function current(f: { key: string, levels: ArtifactType[] }): ArtifactType {
  const level = pickedRung.value[f.key] ?? defaultRung.value[f.key]
  return f.levels.find(a => a.level === level) ?? f.levels[0]!
}
function pickRung(key: string, level: number) {
  pickedRung.value[key] = level
  sound.play('select')
}

// ── Everything you own, free or fitted ───────────────────────────────────────
const allOwned = computed(() => {
  const rows: { id: string, typeId: string, chargesRemaining: number, gemCrafted: boolean, fitted: boolean }[] = []
  for (const a of freeArtifacts.value as any[]) rows.push({ ...a, gemCrafted: !!a.gemCrafted, fitted: false })
  for (const s of [...gridSlots.value, ...breederSlots.value] as any[]) if (s.artifact) rows.push({ ...s.artifact, gemCrafted: !!s.artifact.gemCrafted, fitted: true })
  return rows
})
const ownedByArtifact = computed(() => {
  const m = new Map<string, number>()
  for (const a of allOwned.value) m.set(a.typeId, (m.get(a.typeId) ?? 0) + 1)
  return m
})

/** One row per artifact type and gem-craft, with how many copies are fitted. */
type OwnedRow = { key: string, typeId: string, gemCrafted: boolean, count: number, charges: number, freeIds: string[], fitted: number }
const ownedList = computed<OwnedRow[]>(() => {
  const rows = new Map<string, OwnedRow>()
  for (const a of allOwned.value) {
    const key = `${a.typeId}:${a.gemCrafted ? 1 : 0}`
    let row = rows.get(key)
    if (!row) rows.set(key, row = { key, typeId: a.typeId, gemCrafted: a.gemCrafted, count: 0, charges: 0, freeIds: [], fitted: 0 })
    row.count++
    row.charges += a.chargesRemaining
    if (a.fitted) row.fitted++
    else row.freeIds.push(a.id)
  }
  const level = (r: OwnedRow) => getArtifact(r.typeId)?.level ?? 0
  return [...rows.values()].sort((a, b) =>
    artifactFamilyIndex(a.typeId) - artifactFamilyIndex(b.typeId) || level(b) - level(a) || Number(b.gemCrafted) - Number(a.gemCrafted))
})
function artifactFamilyIndex(typeId: string): number {
  return ARTIFACT_FAMILIES.findIndex(f => f.matches(typeId))
}

// Owned is a side column on wide screens; below that it folds away under the cards.
const wide = useMediaQuery('(min-width: 1280px)')
const ownedOpen = ref(false)

// ── Craft ────────────────────────────────────────────────────────────────────
const buying = ref<Record<string, boolean>>({})
async function doCraft(art: ArtifactType, count: number, e: MouseEvent) {
  if (count < 1 || count > craftLimit(art)) return
  const key = art.id
  if (buying.value[key]) return
  buying.value[key] = true
  try {
    await buyArtifact(art.id, gemCraft.value, count)
    sound.play('craft')
    fx.burst(e.clientX, e.clientY, { count: 8, spread: 44, color: gemCraft.value ? 'var(--xg-sky)' : undefined })
    fx.float(e.clientX, e.clientY - 10, count, { emoji: art.emoji })
  } catch { sound.play('error') } finally { delete buying.value[key] }
}

// ── Delete (first press arms, second deletes; no refund) ─────────────────────
const deleteKey = ref<string | null>(null)
const deleting = ref<Record<string, boolean>>({})
let deleteTimer: ReturnType<typeof setTimeout> | null = null
async function onDelete(row: { key: string, freeIds: string[] }) {
  if (deleteKey.value !== row.key) {
    deleteKey.value = row.key
    if (deleteTimer) clearTimeout(deleteTimer)
    deleteTimer = setTimeout(() => { deleteKey.value = null }, 3000)
    return
  }
  if (deleteTimer) clearTimeout(deleteTimer)
  deleteKey.value = null
  deleting.value[row.key] = true
  try {
    await deleteArtifacts(row.freeIds)
    sound.play('remove')
  } catch { sound.play('error') } finally { delete deleting.value[row.key] }
}
onUnmounted(() => { if (deleteTimer) clearTimeout(deleteTimer) })

const maxCharges = (typeId: string) => getArtifact(typeId)?.maxCharges ?? 1
const tooltipUi = { content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }
</script>

<template>
  <div class="mx-auto max-w-[1440px] px-4 md:px-6 pt-5 md:pt-6 flex flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="max-w-2xl">
        <p class="xg-label">Artifacts</p>
        <h1 class="xg-h text-2xl md:text-3xl mt-1">Crafting</h1>
        <p class="text-[13px] text-(--xg-muted) mt-1">Six families, five levels each. Planter artifacts speed up growing or add plants per harvest; pod artifacts speed up breeding, add plants or raise the mutation chance. Each use costs one charge.</p>
      </div>
      <button type="button" class="xg-btn sm !pl-2.5" :aria-pressed="gemCraft" @click="toggleGem">
        <span class="xg-sw sky" :class="gemCraft ? 'on' : ''" aria-hidden="true" />
        <span class="xg-gem" />Gem-craft: +1 level on every effect
      </button>
    </div>

    <div class="grid gap-6 items-start xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <section class="min-w-0 flex flex-col gap-3">
        <template v-for="g in groups" :key="g.domain">
          <p class="xg-label mt-1">{{ g.label }}</p>
          <!-- Each card spans five rows of a subgrid, so header, levels, effects,
               needs and footer line up across a row whatever wraps. -->
          <div class="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]">
            <article v-for="f in g.families" :key="f.key" class="xg-pane p-4 grid grid-rows-subgrid row-span-5 gap-y-3 min-w-0">
              <div class="flex items-start gap-3">
                <XenoArtifactGlyph :type-id="current(f).id" :gem-crafted="gemCraft" :size="46" />
                <div class="min-w-0">
                  <b class="xg-h text-[15.5px] leading-tight block line-clamp-2">{{ current(f).name }}</b>
                  <p class="text-[11.5px] leading-snug text-(--xg-faint) mt-0.5 line-clamp-2">{{ current(f).maxCharges }} charges · {{ f.description }}</p>
                </div>
              </div>

              <div class="xg-seg" role="group" :aria-label="`${f.name} level`">
                <button
                  v-for="a in f.levels"
                  :key="a.id"
                  type="button"
                  class="relative !min-h-8 !px-1 text-[13px]"
                  :class="a.level === current(f).level ? 'on' : ''"
                  :aria-pressed="a.level === current(f).level"
                  :aria-label="`Level ${a.level}${ownedByArtifact.get(a.id) ? `, ${ownedByArtifact.get(a.id)} owned` : ''}`"
                  @click="pickRung(f.key, a.level)"
                >
                  {{ roman(a.level) }}
                  <span
                    v-if="ownedByArtifact.get(a.id)"
                    class="absolute -top-2 -right-1 min-w-4 h-4 px-1 rounded-full bg-(--xg-ink) text-(--xg-bg) text-[10px] leading-4 font-extrabold"
                  >{{ ownedByArtifact.get(a.id) }}</span>
                </button>
              </div>

              <div class="flex flex-col gap-1 self-start">
                <div v-for="x in artifactEffectLines(current(f), gemCraft)" :key="x.label" class="flex justify-between gap-2 text-[13px]">
                  <span class="text-(--xg-muted)">{{ x.label }}</span>
                  <b class="xg-num" :class="gemCraft ? 'text-(--xg-sky)' : ''">{{ x.value }}</b>
                </div>
              </div>

              <!-- Needs for the chosen count -->
              <div class="xg-well px-2.5 py-2 flex flex-col justify-start gap-1.5">
                <UTooltip
                  v-for="c in current(f).cost"
                  :key="c.plantTypeId"
                  :disabled="!getPlant(c.plantTypeId)"
                  :delay-duration="350"
                  :content="{ side: 'bottom', align: 'start', sideOffset: 6 }"
                  :ui="tooltipUi"
                >
                  <template #content>
                    <XenoPlantTooltipContent v-if="getPlant(c.plantTypeId)" v-bind="getPlant(c.plantTypeId)!" :quantity="owned(c.plantTypeId)" />
                  </template>
                  <div class="flex items-center gap-2 text-[12.5px] cursor-default min-w-0">
                    <XenoPlantIcon :id="c.plantTypeId" :size="26" stage="ready" :silhouette="!known.has(c.plantTypeId)" />
                    <span class="flex-1 min-w-0 truncate">{{ getPlant(c.plantTypeId)?.name ?? c.plantTypeId }}</span>
                    <span
                      v-if="owned(c.plantTypeId) < c.quantity * craftCount(current(f))"
                      class="xg-num shrink-0 inline-flex items-center gap-1.5 text-(--xg-muted)"
                      :title="`${formatNumber(c.quantity * craftCount(current(f)) - owned(c.plantTypeId), false)} short`"
                    >
                      <span class="size-1.5 rounded-full bg-(--xg-sun)" aria-hidden="true" />
                      <span><b class="text-(--xg-ink)">{{ formatNumber(owned(c.plantTypeId)) }}</b>/{{ formatNumber(c.quantity * craftCount(current(f))) }}</span>
                    </span>
                    <b v-else class="xg-num shrink-0 inline-flex items-center gap-1 text-(--xg-accent-text)">
                      <UIcon name="i-lucide-check" class="size-3.5" />{{ formatNumber(owned(c.plantTypeId)) }}/{{ formatNumber(c.quantity * craftCount(current(f))) }}
                    </b>
                  </div>
                </UTooltip>
                <div v-if="gemCraft" class="flex items-center gap-2 text-[12.5px]">
                  <span class="size-[26px] flex items-center justify-center"><span class="xg-gem" /></span>
                  <span class="flex-1">Gems</span>
                  <span v-if="gems < gemCraftCost(current(f)) * craftCount(current(f))" class="xg-num shrink-0 inline-flex items-center gap-1.5 text-(--xg-muted)">
                    <span class="size-1.5 rounded-full bg-(--xg-sun)" aria-hidden="true" />
                    <span><b class="text-(--xg-ink)">{{ formatNumber(gems) }}</b>/{{ formatNumber(gemCraftCost(current(f)) * craftCount(current(f))) }}</span>
                  </span>
                  <b v-else class="xg-num shrink-0 inline-flex items-center gap-1 text-(--xg-sky)">
                    <UIcon name="i-lucide-check" class="size-3.5" />{{ formatNumber(gems) }}/{{ formatNumber(gemCraftCost(current(f)) * craftCount(current(f))) }}
                  </b>
                </div>
              </div>

              <!-- Count + craft. Wraps to two rows on narrow cards; never spills out. -->
              <div class="flex flex-wrap items-center content-end gap-1.5">
                <div class="xg-stepper" role="group" :aria-label="`How many ${current(f).name} to craft`">
                  <button type="button" aria-label="One fewer" :disabled="craftCount(current(f)) <= 1" @click="setCount(current(f), craftCount(current(f)) - 1)">
                    <UIcon name="i-lucide-minus" class="size-3.5" />
                  </button>
                  <input
                    :value="qtyText[current(f).id] ?? '1'"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    :max="Math.max(1, craftLimit(current(f)))"
                    class="xg-num"
                    :aria-label="`Craft count, 1 to ${Math.max(1, craftLimit(current(f)))}`"
                    @input="onCountInput(current(f), $event)"
                    @change="onCountCommit(current(f), $event)"
                    @blur="onCountCommit(current(f), $event)"
                  >
                  <button type="button" aria-label="One more" :disabled="craftCount(current(f)) >= craftLimit(current(f))" @click="setCount(current(f), craftCount(current(f)) + 1)">
                    <UIcon name="i-lucide-plus" class="size-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  class="xg-filter !h-[30px] !px-2.5"
                  :disabled="craftLimit(current(f)) < 2"
                  :class="craftLimit(current(f)) > 1 && craftCount(current(f)) === craftLimit(current(f)) ? 'on' : ''"
                  :title="`Craft as many as you can (${Math.max(1, craftLimit(current(f)))})`"
                  @click="setCount(current(f), craftLimit(current(f)))"
                >Max</button>
                <UTooltip
                  :text="missingText(current(f), craftCount(current(f)))"
                  :disabled="!!craftLimit(current(f))"
                  :delay-duration="150"
                >
                  <span class="flex-[1_1_112px] min-w-0 flex">
                    <XenoButton
                      size="sm"
                      block
                      :variant="craftLimit(current(f)) ? (gemCraft ? 'sky' : 'go') : 'default'"
                      :disabled="!craftLimit(current(f))"
                      :loading="buying[current(f).id]"
                      :aria-label="craftLimit(current(f)) ? `Craft ${craftCount(current(f))} ${current(f).name}` : missingText(current(f))"
                      @click="(e: MouseEvent) => doCraft(current(f), craftCount(current(f)), e)"
                    >
                      <template v-if="!craftLimit(current(f))">Missing</template>
                      <template v-else>
                        Craft ×{{ craftCount(current(f)) }}<template v-if="gemCraft">
                          · <span class="xg-gem" />{{ formatNumber(gemCraftCost(current(f)) * craftCount(current(f))) }}
                        </template>
                      </template>
                    </XenoButton>
                  </span>
                </UTooltip>
              </div>
            </article>
          </div>
        </template>
      </section>

      <!-- Owned -->
      <aside class="xg-pane xg-pane-r min-w-0 p-4 flex flex-col gap-2" aria-label="Owned artifacts">
        <button
          type="button"
          class="flex justify-between items-center gap-2 text-left xl:pointer-events-none"
          :aria-expanded="wide || ownedOpen"
          :tabindex="wide ? -1 : 0"
          @click="ownedOpen = !ownedOpen"
        >
          <span class="xg-label">Owned</span>
          <span class="flex items-center gap-1.5 text-xs text-(--xg-faint)">
            {{ allOwned.length }} artifact{{ allOwned.length === 1 ? '' : 's' }} · {{ ownedList.length }} kind{{ ownedList.length === 1 ? '' : 's' }}
            <UIcon name="i-lucide-chevron-down" class="size-4 xl:hidden transition-transform" :class="ownedOpen ? 'rotate-180' : ''" />
          </span>
        </button>
        <template v-if="wide || ownedOpen">
          <p v-if="!ownedList.length" class="xg-well text-center text-sm text-(--xg-muted) py-8 px-3">Nothing crafted yet.</p>
          <div v-else class="-mx-1 px-1 max-h-[min(60svh,520px)] xl:max-h-[calc(100svh-15rem)] overflow-y-auto flex flex-col gap-0.5">
            <div v-for="o in ownedList" :key="o.key" class="xg-item hoverable !px-1.5 !py-1.5 !gap-2.5">
              <XenoArtifactGlyph :type-id="o.typeId" :gem-crafted="o.gemCrafted" :size="34" />
              <span class="flex-1 min-w-0">
                <b class="text-[13px] block truncate">
                  {{ getArtifact(o.typeId)?.name }}<span class="xg-num text-(--xg-muted)"> ×{{ o.count }}</span>
                </b>
                <span class="block text-[11.5px] text-(--xg-faint) truncate">
                  <template v-if="o.fitted"><b class="text-(--xg-accent-text)">{{ formatNumber(o.fitted, false) }} fitted</b><template v-if="o.freeIds.length"> · {{ formatNumber(o.freeIds.length, false) }} free</template></template>
                  <template v-else>{{ artifactEffectSummary(o.typeId, o.gemCrafted) }}</template>
                </span>
              </span>
              <span class="w-12 shrink-0" :title="`${o.charges} of ${o.count * maxCharges(o.typeId)} charges left`">
                <span class="xg-num text-[11px] block text-right">{{ formatNumber(o.charges) }}/{{ formatNumber(o.count * maxCharges(o.typeId)) }}</span>
                <span class="xg-meter !h-1 mt-1"><span :style="{ width: `${(o.charges / (o.count * maxCharges(o.typeId))) * 100}%`, background: 'var(--xg-ink)' }" /></span>
              </span>
              <button
                v-if="o.freeIds.length"
                type="button"
                class="xg-btn xs shrink-0"
                :class="deleteKey === o.key ? 'danger' : 'ghost ico'"
                :aria-label="deleteKey === o.key ? `Confirm: delete ${o.freeIds.length} unfitted, no refund` : `Delete unfitted ${getArtifact(o.typeId)?.name}`"
                :title="deleteKey === o.key ? 'Press again to delete (no refund)' : `Delete the ${o.freeIds.length} unfitted`"
                :disabled="deleting[o.key]"
                @click="onDelete(o)"
              >
                <UIcon :name="deleting[o.key] ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'" class="size-3.5" :class="deleting[o.key] ? 'animate-spin' : ''" />
                <span v-if="deleteKey === o.key">Delete {{ o.freeIds.length }}</span>
              </button>
              <span v-else class="size-[30px] shrink-0" aria-hidden="true" />
            </div>
          </div>
          <p class="text-xs text-(--xg-faint) pt-1 border-t border-(--xg-edge)">Fit or swap artifacts by holding one in the Garden or the Nursery. Delete only removes unfitted copies, with no refund.</p>
        </template>
      </aside>
    </div>
  </div>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" />
</template>
