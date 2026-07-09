<script setup lang="ts">
import {
  MOD_LABEL, MOD_RANGES, RARITY_COLOR, RARITY_STYLE, SLOT_LABEL, formatModValue,
  type HackRarity, type ItemMod, type ItemSlot
} from '#shared/utils/hack-config'
import { sleep } from '~/utils/sleep'
import type { VoiceHandle } from '~/composables/useAudio'

// Mission collect reveal — the user's ask: this should feel like a Black
// Market reveal (flash → stamp → rewards card), not a plain result dialog.
// Simpler than HackCrateOpening/HackRecruitOpening: the op already resolved
// server-side before this opens, so there's no pitch/buy stage, just the
// two-beat reveal.
const props = defineProps<{
  result: {
    success: boolean
    cash: number
    gems: number
    xpPerAgent: number
    item: { name: string, slot: ItemSlot, itemLevel: number, rarity: HackRarity, mods: ItemMod[] } | null
    inventoryFull: boolean
    levelUps: Array<{ agentId: string, agentName: string, newLevel: number }>
    templateName: string
    icon: string
  }
  voiceName: string
  voiceText: string
}>()
const open = defineModel<boolean>('open', { required: true })
const audio = useAudio('hack')

const stage = ref<'stamp' | 'reveal'>('stamp')
const barkCaption = ref('')
const barkDone = ref(false)
let barkHandle: VoiceHandle | null = null
const stampEl = ref<HTMLElement | null>(null)
const revealEl = ref<HTMLElement | null>(null)
const flashEl = ref<HTMLElement | null>(null)

watch(open, (v) => {
  if (v) {
    stage.value = 'stamp'
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
  stage.value = 'reveal'
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
        <!-- Stage 1: stamp + bark -->
        <template v-if="stage === 'stamp'">
          <div class="text-center pt-8 pb-6 px-5">
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
        </template>

        <!-- Stage 2: rewards reveal -->
        <template v-else>
          <div
            ref="revealEl"
            class="p-5"
          >
            <div class="hack-eyebrow mb-1 flex items-center gap-1.5">
              <UIcon
                :name="result.icon"
                class="size-3.5"
              />{{ result.templateName }}
            </div>
            <h2
              class="text-xl font-bold mb-4"
              :class="result.success ? 'text-success' : 'text-error'"
            >
              {{ result.success ? 'Mission Success' : 'Mission Failed' }}
            </h2>

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

            <HackFrame
              v-if="result.success && result.item"
              tight
              class="p-4 mb-4"
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
              <div class="space-y-2 mt-3">
                <div
                  v-for="m in sortedMods"
                  :key="m.type"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="text-sm">{{ MOD_LABEL[m.type] }}</span>
                  <div class="flex items-center gap-2.5 flex-1 max-w-[55%]">
                    <span class="mono text-xs shrink-0">{{ formatModValue(m.type, m.value) }}</span>
                    <HackRangeBar
                      class="flex-1"
                      :min="modRange(m.type).min"
                      :max="modRange(m.type).max"
                      :value="m.value"
                    />
                  </div>
                </div>
              </div>
            </HackFrame>

            <p
              v-if="!result.success"
              class="text-sm text-muted mb-4"
            >
              No cash, gems or gear recovered — but your agents still earned XP from the attempt.
            </p>

            <div class="flex items-center justify-between p-2.5 hack-frame-tight hack-frame-2 mb-2">
              <span class="text-sm text-muted flex items-center gap-2">
                <UIcon
                  name="i-lucide-sparkles"
                  class="size-4 text-violet-400"
                /> XP per agent
              </span>
              <span class="font-semibold text-sm text-violet-400">+{{ result.xpPerAgent }}</span>
            </div>

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
