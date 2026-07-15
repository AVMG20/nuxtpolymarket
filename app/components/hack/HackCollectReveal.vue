<script setup lang="ts">
import {
  MOD_LABEL, MOD_RANGES, RARITY_COLOR, RARITY_STYLE, RARITY_LABEL, SLOT_LABEL, AGENT_TRAIT_LABEL, ARTIFACT_VALUE, formatModValue, formatArtifactAdd,
  type HackRarity, type ItemMod, type ItemSlot, type AgentTraitType
} from '#shared/utils/hack-config'
import { sleep } from '~/utils/sleep'
import type { VoiceHandle } from '~/composables/useAudio'

// Mission collect reveal — one continuous card: flash + stamp scale-in at the
// top, the RELAY bark caption below it, then the rewards fade in underneath
// (no stage swap — the stamp stays put and the loot appears below it). The op
// already resolved server-side before this opens, so there's no pitch/buy
// stage.
const props = defineProps<{
  result: {
    success: boolean
    cash: number
    gems: number
    xpPerAgent: number
    item: { name: string, slot: ItemSlot, itemLevel: number, rarity: HackRarity, mods: ItemMod[] } | null
    inventoryFull: boolean
    artifacts: Array<{ type: string, rarity: string, count: number }>
    levelUps: Array<{ agentId: string, agentName: string, newLevel: number }>
    templateName: string
    icon: string
  }
  voiceName: string
  voiceText: string
}>()
const open = defineModel<boolean>('open', { required: true })
const audio = useAudio('hack')

const showRewards = ref(false)
const barkCaption = ref('')
const barkDone = ref(false)
let barkHandle: VoiceHandle | null = null
const stampEl = ref<HTMLElement | null>(null)
const revealEl = ref<HTMLElement | null>(null)
const flashEl = ref<HTMLElement | null>(null)

watch(open, (v) => {
  if (v) {
    showRewards.value = false
    barkCaption.value = ''
    barkDone.value = false
    void playSequence()
  } else {
    barkHandle?.cancel()
  }
}, { immediate: true })

async function playSequence() {
  await nextTick()
  if (flashEl.value) {
    const { gsap } = await import('gsap')
    await gsap.timeline()
      .to(flashEl.value, { opacity: 0.9, duration: 0.08 })
      .to(flashEl.value, { opacity: 0, duration: 0.17 })
  }
  if (stampEl.value) {
    const { gsap } = await import('gsap')
    gsap.fromTo(stampEl.value, { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(1.7)' })
  }
  barkHandle?.cancel()
  barkDone.value = false
  barkHandle = audio.playVoice(props.voiceName, {
    captionsRef: barkCaption, text: props.voiceText, delayMs: 50,
    onEnd: () => { barkDone.value = true }
  })
  await sleep(700)
  showRewards.value = true
  await nextTick()
  if (revealEl.value) {
    const { gsap } = await import('gsap')
    gsap.fromTo(revealEl.value, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 })
  }
}

const sortedMods = computed(() => {
  if (!props.result.item) return [] as ItemMod[]
  return [...props.result.item.mods].sort((a, b) => Number(b.type === 'power_flat') - Number(a.type === 'power_flat'))
})
function modRange(type: ItemMod['type']) {
  return MOD_RANGES[type]
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-xl bg-transparent shadow-none ring-0 rounded-none' }"
  >
    <template #content>
      <div
        ref="flashEl"
        class="hack-glitch-flash"
      />
      <div
        class="hack-shell hack-frame overflow-hidden"
        :class="result.success && 'hack-frame-accent'"
      >
        <!-- Stamp + bark: always shown at the top -->
        <div class="text-center pt-8 pb-5 px-5">
          <div class="hack-eyebrow mb-3 flex items-center justify-center gap-1.5">
            <UIcon
              :name="result.icon"
              class="size-3.5"
            />{{ result.templateName }}
          </div>
          <div
            ref="stampEl"
            class="hack-stamp"
            :class="result.success ? 'text-success' : 'text-error'"
          >
            {{ result.success ? 'SUCCESS' : 'FAILED' }}
          </div>
          <p class="hack-captions mt-3 text-center">
            {{ barkCaption }}<span
              v-if="!barkDone"
              class="hack-cursor"
            />
          </p>
        </div>

        <!-- Rewards: fade in below the stamp -->
        <template v-if="showRewards">
          <div
            ref="revealEl"
            class="px-5 pb-5"
          >
            <div
              v-if="result.success"
              class="grid grid-cols-2 gap-2 mb-4"
            >
              <div class="flex items-center gap-2 p-2.5 hack-frame-tight hack-frame-2">
                <UIcon
                  name="i-lucide-banknote"
                  class="size-4 text-yellow-400 shrink-0"
                />
                <div class="min-w-0">
                  <p class="text-[10px] text-muted leading-none mb-0.5">
                    Cash
                  </p>
                  <p class="font-bold text-sm text-yellow-400">
                    +${{ formatNumber(result.cash, true) }}
                  </p>
                </div>
              </div>
              <div
                v-if="result.gems > 0"
                class="flex items-center gap-2 p-2.5 hack-frame-tight hack-frame-2"
              >
                <UIcon
                  name="i-lucide-gem"
                  class="size-4 text-cyan-400 shrink-0"
                />
                <div class="min-w-0">
                  <p class="text-[10px] text-muted leading-none mb-0.5">
                    Gems
                  </p>
                  <p class="font-bold text-sm text-cyan-400">
                    +{{ result.gems }}
                  </p>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-between p-2.5 hack-frame-tight hack-frame-2 mb-2">
              <span class="text-sm text-muted flex items-center gap-2">
                <UIcon
                  name="i-lucide-sparkles"
                  class="size-4 text-violet-400"
                /> XP per agent
              </span>
              <span class="font-semibold text-sm text-violet-400">+{{ result.xpPerAgent }}</span>
            </div>

            <HackFrame
              v-if="result.success && result.item"
              tight
              class="p-4 mb-4 mt-4"
            >
              <div class="flex items-center justify-between mb-2">
                <span
                  class="hack-card-title-lg"
                  :class="RARITY_STYLE[result.item.rarity].text"
                >{{ result.item.name }}</span>
                <UBadge
                  size="sm"
                  :color="RARITY_COLOR[result.item.rarity]"
                  variant="subtle"
                  :label="`${SLOT_LABEL[result.item.slot]} · Lv.${result.item.itemLevel}`"
                />
              </div>
              <!-- Grid so the value column and bar column share a width across
                   every row — the range bars all render the exact same size. -->
              <div class="grid grid-cols-[1fr_auto_8rem] items-center gap-x-2.5 gap-y-2 mt-3">
                <template
                  v-for="m in sortedMods"
                  :key="m.type"
                >
                  <span class="text-sm">{{ MOD_LABEL[m.type] }}</span>
                  <span class="mono text-xs text-right">{{ formatModValue(m.type, m.value) }}</span>
                  <HackRangeBar
                    :min="modRange(m.type).min"
                    :max="modRange(m.type).max"
                    :value="m.value"
                  />
                </template>
              </div>
            </HackFrame>

            <p
              v-if="!result.success"
              class="text-sm text-muted mb-4"
            >
              No cash, gems or gear recovered — but your agents still earned XP from the attempt.
            </p>

            <HackFrame
              v-if="result.success && result.artifacts.length"
              tight
              class="p-4 mb-4"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="hack-card-title-lg">
                  Artifact drops <span :class="RARITY_STYLE.phantom.text">· {{ result.artifacts.reduce((s, a) => s + a.count, 0) }} recovered</span>
                </span>
                <span class="font-mono text-[10px] text-primary uppercase tracking-wider">Drop confirmed</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div
                  v-for="art in result.artifacts"
                  :key="`${art.type}-${art.rarity}`"
                  class="flex items-center gap-3 p-2.5 border"
                  :class="RARITY_STYLE[art.rarity as HackRarity].border"
                >
                  <div
                    class="size-9 shrink-0 flex items-center justify-center border"
                    :class="[RARITY_STYLE[art.rarity as HackRarity].bg, RARITY_STYLE[art.rarity as HackRarity].text]"
                  >
                    <UIcon
                      name="i-lucide-zap"
                      class="size-4"
                    />
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-sm">
                      {{ AGENT_TRAIT_LABEL[art.type as AgentTraitType] }} Artifact
                    </p>
                    <p class="text-xs text-muted font-mono">
                      {{ RARITY_LABEL[art.rarity as HackRarity] }} · adds {{ formatArtifactAdd(art.type as AgentTraitType, ARTIFACT_VALUE[art.type as AgentTraitType][art.rarity as HackRarity]).replace('+', '') }}
                    </p>
                  </div>
                  <span class="font-mono text-sm font-bold ml-auto">×{{ art.count }}</span>
                </div>
              </div>
              <p class="text-[11px] text-muted font-mono mt-3">
                Added to the stacked Artifact inventory by trait + rarity.
              </p>
            </HackFrame>

            <div
              v-if="result.levelUps.length"
              class="p-3 hack-frame-tight hack-frame-2 space-y-1 mb-2"
            >
              <p class="text-sm font-semibold text-success flex items-center gap-2">
                <UIcon
                  name="i-lucide-trending-up"
                  class="size-4"
                />
                {{ result.levelUps.length }} level up{{ result.levelUps.length > 1 ? 's' : '' }}!
              </p>
              <p
                v-for="lu in result.levelUps"
                :key="lu.agentId"
                class="text-sm text-muted"
              >
                {{ lu.agentName }} reached <span class="font-medium text-default">Lv {{ lu.newLevel }}</span>
              </p>
            </div>

            <p
              v-if="result.inventoryFull"
              class="text-sm text-warning flex items-center gap-2 mb-2"
            >
              <UIcon
                name="i-lucide-triangle-alert"
                class="size-4 shrink-0"
              />
              Inventory was full — the dropped item was lost. Clear space before your next op.
            </p>

            <UButton
              block
              class="mt-4"
              label="Continue"
              @click="open = false"
            />
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
