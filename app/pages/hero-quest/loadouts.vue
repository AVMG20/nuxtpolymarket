<script setup lang="ts">
/**
 * Loadouts — saving and applying the whole swappable state in one action (`loadouts.md`).
 *
 * A Loadout is a snapshot of five things: fielded party, formation, equipped Skills, equipped
 * Artifacts, and equipped Gear (§1). Applying one sets all five at once, which is the entire
 * point — it bundles what would otherwise be four or five separate manual swaps.
 *
 * **Hero class is deliberately not captured.** Reaching a new node takes the token a prestige
 * grants (`open-items.md` #42), so the class is a progression choice rather than a swappable piece.
 *
 * **A preset never goes stale.** Nothing in this game is ever un-owned and slot counts only grow,
 * so a preset saved long ago under fewer slots stays valid and simply fills fewer of them.
 *
 * Slots start at 2 and reach 10 — the one track in the game priced in **Gems** rather than Void
 * Shards, because a Loadout slot adds no combat power at all. A player with 2 slots can manually
 * re-equip everything a 10-slot player can, just with more taps.
 */

const { initialized, loadouts, guild, training, digSite, forge, saveLoadout, applyLoadout } = useHeroQuest()

const busy = ref(false)
/** Which slot's rename field is open. */
const renaming = ref<number | null>(null)
const draftName = ref('')

/**
 * Names for the IDs a preset holds, so a saved slot reads as content rather than as ids.
 *
 * Falls back to the id when the roster has not loaded yet — a preset is never rejected for
 * naming something the page cannot resolve, which matches the server's own posture.
 */
function nameOf(kind: 'champion' | 'skill' | 'artifact' | 'gear', id: string): string {
    const rosters = {
        champion: guild.value?.roster,
        skill: training.value?.roster,
        artifact: digSite.value?.roster,
        gear: forge.value?.roster
    }
    return rosters[kind]?.find(entry => entry.id === id)?.name ?? id
}

function summaryOf(preset: NonNullable<typeof loadouts.value>['saved'][number]): string[] {
    const parts: string[] = []
    if (preset.partyChampionIds.length) {
        parts.push(`${preset.partyChampionIds.length} Champion${preset.partyChampionIds.length === 1 ? '' : 's'}`)
    }
    if (preset.equippedSkillIds.length) {
        parts.push(`${preset.equippedSkillIds.length} Skill${preset.equippedSkillIds.length === 1 ? '' : 's'}`)
    }
    if (preset.equippedArtifactIds.length) {
        parts.push(`${preset.equippedArtifactIds.length} Artifact${preset.equippedArtifactIds.length === 1 ? '' : 's'}`)
    }
    const gear = Object.keys(preset.equippedGear).length
    if (gear) parts.push(`${gear} Gear`)
    return parts
}

/** Every unlocked slot, saved or not — an empty one still needs a Save button. */
const slots = computed(() => {
    const saved = loadouts.value?.saved ?? []
    return Array.from({ length: loadouts.value?.slots ?? 0 }, (_, index) => ({
        slotIndex: index,
        preset: saved.find(entry => entry.slotIndex === index) ?? null
    }))
})

async function withBusy(action: () => Promise<unknown>) {
    busy.value = true
    try {
        await action()
    } finally {
        busy.value = false
    }
}

async function save(slotIndex: number, name?: string) {
    await withBusy(async () => {
        await saveLoadout(slotIndex, name)
        renaming.value = null
    })
}

async function apply(slotIndex: number) {
    await withBusy(() => applyLoadout(slotIndex))
}

function startRename(slotIndex: number, current: string) {
    renaming.value = slotIndex
    draftName.value = current
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
    <div
      v-if="!initialized || !loadouts"
      class="text-center py-16 text-muted"
    >
      Start a run first.
    </div>

    <template v-else>
      <div class="rounded-lg border border-default bg-elevated/40 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-highlighted">
              {{ loadouts.slots }} of {{ loadouts.maxSlots }} slots
            </p>
            <p class="text-xs text-muted">
              A loadout saves your party, formation, skills, artifacts and gear together.
            </p>
          </div>
          <p
            v-if="loadouts.nextSlotCostGems !== null"
            class="text-xs text-muted"
          >
            Next slot: {{ formatNumber(loadouts.nextSlotCostGems, false) }} gems — buy it in the
            <NuxtLink
              to="/hero-quest/prestige"
              class="text-primary"
            >prestige shop</NuxtLink>
          </p>
        </div>
      </div>

      <div class="space-y-2">
        <div
          v-for="slot in slots"
          :key="slot.slotIndex"
          class="rounded-lg border border-default bg-elevated/40 p-4 space-y-2"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div
                v-if="renaming === slot.slotIndex"
                class="flex items-center gap-2"
              >
                <UInput
                  v-model="draftName"
                  size="sm"
                  placeholder="Loadout name"
                  @keyup.enter="save(slot.slotIndex, draftName)"
                />
                <UButton
                  size="xs"
                  :disabled="busy"
                  @click="save(slot.slotIndex, draftName)"
                >
                  Save
                </UButton>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="renaming = null"
                >
                  Cancel
                </UButton>
              </div>
              <template v-else>
                <p class="text-sm font-medium text-highlighted">
                  {{ slot.preset?.name ?? `Slot ${slot.slotIndex + 1}` }}
                </p>
                <p class="text-xs text-muted">
                  <template v-if="slot.preset && summaryOf(slot.preset).length">
                    {{ summaryOf(slot.preset).join(' · ') }}
                  </template>
                  <template v-else-if="slot.preset">
                    Saved empty
                  </template>
                  <template v-else>
                    Nothing saved here yet
                  </template>
                </p>
              </template>
            </div>

            <div
              v-if="renaming !== slot.slotIndex"
              class="flex gap-2 shrink-0"
            >
              <UButton
                size="xs"
                variant="soft"
                icon="i-lucide-save"
                :disabled="busy"
                @click="startRename(slot.slotIndex, slot.preset?.name ?? `Loadout ${slot.slotIndex + 1}`)"
              >
                Save current
              </UButton>
              <UButton
                size="xs"
                color="primary"
                icon="i-lucide-check"
                :disabled="busy || !slot.preset"
                @click="apply(slot.slotIndex)"
              >
                Apply
              </UButton>
            </div>
          </div>

          <div
            v-if="slot.preset && summaryOf(slot.preset).length"
            class="flex flex-wrap gap-1 pt-1"
          >
            <UBadge
              v-for="id in slot.preset.partyChampionIds"
              :key="id"
              size="sm"
              color="neutral"
              variant="subtle"
            >
              {{ nameOf('champion', id) }}
            </UBadge>
            <UBadge
              v-for="id in slot.preset.equippedSkillIds"
              :key="id"
              size="sm"
              color="primary"
              variant="subtle"
            >
              {{ nameOf('skill', id) }}
            </UBadge>
            <UBadge
              v-for="id in slot.preset.equippedArtifactIds"
              :key="id"
              size="sm"
              color="warning"
              variant="subtle"
            >
              {{ nameOf('artifact', id) }}
            </UBadge>
            <UBadge
              v-for="id in Object.values(slot.preset.equippedGear)"
              :key="id"
              size="sm"
              color="success"
              variant="subtle"
            >
              {{ nameOf('gear', id) }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
