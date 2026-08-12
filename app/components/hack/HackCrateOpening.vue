<script setup lang="ts">
import {
  MOD_LABEL, MOD_RANGES, RARITY_COLOR, RARITY_LABEL, RARITY_STAMP_SFX, RARITY_STYLE, SLOT_ICON, formatModValue, sortModsByPriority,
  type HackItemDef, type HackRarity, type ItemPullTier, type ItemMod
} from '#shared/utils/hack-config'
import { ITEM_PULL_SELLER } from '~/utils/hack-content'
import { ITEM_PULL_CONFIRM_TEXT, ITEM_PULL_CONFIRM_VOICE, ITEM_PULL_INTRO_TEXT, ITEM_PULL_INTRO_VOICE, pickRarityBark } from '~/utils/hack-voice-lines'
import { sleep } from '~/utils/sleep'
import type { VoiceHandle } from '~/composables/useAudio'

// Gear-only reveal cinematic — deliberately a separate component from
// HackRecruitOpening (PLAN.md §10.7): scan/decrypt visual vs. vetting radar,
// Send-to-Loadout vs. Accept/Reject. Sharing one component branching on a
// `kind` prop would mean permanent conditional branching for no reuse benefit.
const props = defineProps<{ tier: ItemPullTier, disabled?: boolean, disabledReason?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pulled: [] }>()

type PulledItem = HackItemDef & { id: string }

const stage = ref<'pitch' | 'scan' | 'reveal'>('pitch')
const quickOpen = useHackQuickOpen('crate')
const buying = ref(false)
const result = ref<{ item: PulledItem, rarity: HackRarity } | null>(null)
const toast = useToast()
const audio = useAudio('hack')

const seller = computed(() => ITEM_PULL_SELLER[props.tier.id])
const introVoice = computed(() => ITEM_PULL_INTRO_VOICE[props.tier.id] ?? '')
const introText = computed(() => ITEM_PULL_INTRO_TEXT[props.tier.id] ?? '')

// The seller pitch is a one-shot per tier per session — cool to hear once,
// grating if it replays every single time you revisit the same dead drop.
// Marks itself seen as a side effect, so this runs once on mount/tier-change,
// never from a template expression.
const introIsFirstTime = ref(false)
watch(() => props.tier.id, (id) => {
  introIsFirstTime.value = audio.firstTimeThisSession(`market-crate-intro-${id}`)
}, { immediate: true })

const barkCaption = ref('')
const barkDone = ref(false)
let barkHandle: VoiceHandle | null = null
const stampEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
const flashEl = ref<HTMLElement | null>(null)
const pitchCaptionRef = ref<{ play: () => void, stop: () => void, showInstant: () => void } | null>(null)

watch(open, (v) => {
  if (v) {
    stage.value = 'pitch'
    result.value = null
    barkCaption.value = ''
    barkDone.value = false
  } else {
    barkHandle?.cancel()
    pitchCaptionRef.value?.stop()
  }
})

// Quick Open toggled mid-pitch. HackRelayCaption's own autoplay watcher only
// re-fires on a voiceName/text change, not on the autoplay/instant props
// flipping, so turning Quick Open back off wouldn't otherwise restart the
// line — drive both directions explicitly here instead. Respects the same
// first-time-this-session gate as the initial render.
watch(quickOpen, (v) => {
  if (v) { pitchCaptionRef.value?.stop(); return }
  if (introIsFirstTime.value) pitchCaptionRef.value?.play()
  else pitchCaptionRef.value?.showInstant()
})

async function buyAndOpen() {
  pitchCaptionRef.value?.stop()
  // The pitch has now been shown (played or instant) — if the pull fails and
  // we fall back to the pitch stage below, it shouldn't replay.
  introIsFirstTime.value = false
  buying.value = true
  try {
    if (!quickOpen.value) {
      stage.value = 'scan'
      audio.playVoice(ITEM_PULL_CONFIRM_VOICE[props.tier.id] ?? '', {
        text: ITEM_PULL_CONFIRM_TEXT[props.tier.id] ?? '', delayMs: 100
      })
    }
    const [res] = await Promise.all([
      $fetch('/api/hack/items/pull', { method: 'POST', body: { tierId: props.tier.id } }),
      // Sized to let the longest confirm VO finish (~4.1s) before the reveal
      // cuts it off. Quick open skips this entirely.
      quickOpen.value ? Promise.resolve() : sleep(4300)
    ])
    result.value = { item: res.item as PulledItem, rarity: res.rarity as HackRarity }
    audio.playSfx('purchase')
    emit('pulled')
    if (!quickOpen.value) await flash()
    stage.value = 'reveal'
    await nextTick()
    playReveal()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Pull failed', color: 'error' })
    stage.value = 'pitch'
  } finally {
    buying.value = false
  }
}

async function flash() {
  if (!flashEl.value) return
  const { gsap } = await import('gsap')
  await gsap.timeline()
    .to(flashEl.value, { opacity: 0.9, duration: 0.08 })
    .to(flashEl.value, { opacity: 0, duration: 0.17 })
}

async function playReveal() {
  const rarity = result.value!.rarity
  if (stampEl.value) {
    const { gsap } = await import('gsap')
    gsap.fromTo(stampEl.value, { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(1.7)' })
  }
  audio.playSfx(RARITY_STAMP_SFX[rarity])
  barkHandle?.cancel()
  barkDone.value = false
  const playAudio = audio.barkThrottle({ rare: rarity === 'elite' || rarity === 'phantom', quickOpen: quickOpen.value })
  const bark = pickRarityBark(rarity, 'item')
  barkHandle = audio.playVoice(bark.voice, {
    captionsRef: barkCaption, text: bark.text, delayMs: 50,
    skipAudio: !playAudio, onEnd: () => { barkDone.value = true }
  })
  await sleep(500)
  if (cardEl.value) {
    const { gsap } = await import('gsap')
    gsap.fromTo(cardEl.value, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 })
  }
}

function openAnother() {
  stage.value = 'pitch'
  result.value = null
  barkHandle?.cancel()
}

const sortedMods = computed(() => {
  if (!result.value) return [] as ItemMod[]
  return sortModsByPriority(result.value.item.mods)
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
      <div class="hack-shell hack-frame hack-frame-accent overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-4rem)]">
        <div class="overflow-y-auto min-h-0">
        <!-- Stage 1: the pitch -->
        <template v-if="stage === 'pitch'">
          <div class="hack-contact-portrait aspect-auto! h-[clamp(10rem,42vh,32rem)]">
            <img
              class="object-top"
              :src="seller?.portrait"
              :alt="`Seller: ${seller?.handle}`"
            >
          </div>
          <div class="p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="hack-eyebrow">
                  {{ tier.name }}
                </div>
                <h2 class="text-xl font-bold mt-1.5">
                  seller: {{ seller?.handle }}
                </h2>
              </div>
              <div class="mono text-yellow-400 font-bold text-lg shrink-0">
                ${{ formatNumber(tier.cost, true) }}
              </div>
            </div>

            <HackRelayCaption
              ref="pitchCaptionRef"
              :key="introVoice"
              class="mt-3.5 block"
              :voice-name="introVoice"
              :text="introText"
              :autoplay="!quickOpen && introIsFirstTime"
              :instant="!quickOpen && !introIsFirstTime"
            />

            <hr class="border-default my-4">
            <p class="hack-eyebrow mb-2">
              Odds
            </p>
            <HackOddsBar :weights="tier.weights" />

            <p
              v-if="disabled && disabledReason"
              class="text-sm text-warning mt-4"
            >
              {{ disabledReason }}
            </p>
            <div class="flex items-center justify-between mt-5">
              <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                Quick open (skip animation)
                <USwitch v-model="quickOpen" />
              </label>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  label="Cancel"
                  @click="open = false"
                />
                <UButton
                  :loading="buying"
                  :disabled="disabled"
                  label="Buy & Open"
                  @click="audio.playSfx('click'); buyAndOpen()"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Stage 2a: scan sequence -->
        <template v-else-if="stage === 'scan'">
          <div class="text-center py-14 px-5">
            <div class="hack-scan-frame">
              <div class="box">
                <UIcon
                  name="i-lucide-package"
                  class="size-12 text-muted opacity-40"
                />
              </div>
              <div class="hack-scan-sweep" />
            </div>
            <div class="mono text-primary tracking-widest text-sm">
              SCANNING CONTENTS…
            </div>
          </div>
        </template>

        <!-- Stage 2b: rarity stamp + reveal -->
        <template v-else-if="stage === 'reveal' && result">
          <div class="text-center pt-8 px-5">
            <div
              ref="stampEl"
              class="hack-stamp"
              :class="RARITY_STYLE[result.rarity].text"
            >
              {{ RARITY_LABEL[result.rarity] }}
            </div>
            <p class="hack-captions mt-3 text-center">
              {{ barkCaption }}<span
                v-if="!barkDone"
                class="hack-cursor"
              />
            </p>
          </div>

          <div
            ref="cardEl"
            class="p-5"
          >
            <HackFrame
              tight
              class="p-4"
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="SLOT_ICON[result.item.slot]"
                    class="size-5 shrink-0"
                    :class="RARITY_STYLE[result.rarity].text"
                  />
                  <span
                    class="hack-card-title-lg"
                    :class="RARITY_STYLE[result.rarity].text"
                  >{{ result.item.name }}</span>
                </div>
                <UBadge
                  size="sm"
                  :color="RARITY_COLOR[result.rarity]"
                  variant="subtle"
                  :label="`${result.item.slot} · Lv.${result.item.itemLevel}`"
                  class="capitalize"
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

            <div class="flex items-center justify-between mt-4">
              <UButton
                color="neutral"
                variant="outline"
                to="/hack/items"
                label="View in Inventory"
              />
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  label="Done"
                  @click="open = false"
                />
                <UButton
                  :loading="buying"
                  :label="`Open Another ($${formatNumber(tier.cost, true)})`"
                  @click="openAnother"
                />
              </div>
            </div>
          </div>
        </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
