<script setup lang="ts">
import {
  AGENT_TRAIT_LABEL, AGENT_TRAIT_RANGES, CLASS_LABEL, RARITY_LABEL, RARITY_STAMP_SFX, RARITY_STYLE, formatTraitValue,
  type AgentPullTier, type AgentTrait, type HackRarity
} from '#shared/utils/hack-config'
import { AGENT_PULL_CONTACT, agentBioLine } from '~/utils/hack-content'
import {
  AGENT_PULL_CONFIRM_TEXT, AGENT_PULL_CONFIRM_VOICE, AGENT_PULL_INTRO_TEXT, AGENT_PULL_INTRO_VOICE, pickRarityBark
} from '~/utils/hack-voice-lines'
import { sleep } from '~/utils/sleep'
import type { VoiceHandle } from '~/composables/useAudio'

// Agent recruitment reveal — deliberately a separate component from
// HackCrateOpening (PLAN.md §10.7): a recruit is a *person* someone else
// vets and delivers, not an object you scan open. Vetting radar instead of a
// scan sweep, Accept/Reject instead of Send-to-Loadout.
const props = defineProps<{ tier: AgentPullTier, disabled?: boolean, disabledReason?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ recruited: [] }>()

interface PulledAgent {
  id: string
  name: string
  class: string
  rarity: HackRarity
  level: number
  traits: AgentTrait[]
}

const stage = ref<'pitch' | 'vetting' | 'reveal'>('pitch')
const quickOpen = useHackQuickOpen('recruit')
const recruiting = ref(false)
const rejecting = ref(false)
const result = ref<PulledAgent | null>(null)
const toast = useToast()
const audio = useAudio('hack')

const contact = computed(() => AGENT_PULL_CONTACT[props.tier.id])
const introVoice = computed(() => AGENT_PULL_INTRO_VOICE[props.tier.id] ?? '')
const introText = computed(() => AGENT_PULL_INTRO_TEXT[props.tier.id] ?? '')

// The contact pitch is a one-shot per tier per session — cool to hear once,
// grating if it replays every single time you revisit the same contact.
// Marks itself seen as a side effect, so this runs once on mount/tier-change,
// never from a template expression.
const introIsFirstTime = ref(false)
watch(() => props.tier.id, (id) => {
  introIsFirstTime.value = audio.firstTimeThisSession(`market-recruit-intro-${id}`)
}, { immediate: true })

const vetLabels = ['VETTING CANDIDATE…', 'CROSS-CHECKING REFERENCES…', 'CONFIRMING AVAILABILITY…']
const vetLabelIdx = ref(0)
let vetTimer: ReturnType<typeof setInterval> | null = null
let pingTimer: ReturnType<typeof setTimeout> | null = null

const barkCaption = ref('')
const barkDone = ref(false)
let barkHandle: VoiceHandle | null = null
const revealEl = ref<HTMLElement | null>(null)
const stampEl = ref<HTMLElement | null>(null)
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
    if (vetTimer) clearInterval(vetTimer)
    if (pingTimer) clearTimeout(pingTimer)
  }
})

// Quick recruit toggled mid-pitch. HackRelayCaption's own autoplay watcher
// only re-fires on a voiceName/text change, not on the autoplay/instant props
// flipping, so turning Quick recruit back off wouldn't otherwise restart the
// line — drive both directions explicitly here instead. Respects the same
// first-time-this-session gate as the initial render.
watch(quickOpen, (v) => {
  if (v) { pitchCaptionRef.value?.stop(); return }
  if (introIsFirstTime.value) pitchCaptionRef.value?.play()
  else pitchCaptionRef.value?.showInstant()
})

async function startRecruitment() {
  pitchCaptionRef.value?.stop()
  // The pitch has now been shown (played or instant) — if recruitment fails and
  // we fall back to the pitch stage below, it shouldn't replay.
  introIsFirstTime.value = false
  recruiting.value = true
  try {
    if (!quickOpen.value) {
      stage.value = 'vetting'
      vetLabelIdx.value = 0
      vetTimer = setInterval(() => {
        vetLabelIdx.value = (vetLabelIdx.value + 1) % vetLabels.length
      }, 700)
      audio.playSfx('radar-ping')
      // The vetting window is sized to let the longest confirm VO finish
      // (~4.4s). One 2.6s ping leaves dead air, so fire a second mid-sweep.
      pingTimer = setTimeout(() => audio.playSfx('radar-ping'), 2300)
      audio.playVoice(AGENT_PULL_CONFIRM_VOICE[props.tier.id] ?? '', {
        text: AGENT_PULL_CONFIRM_TEXT[props.tier.id] ?? '', delayMs: 100
      })
    }
    const [res] = await Promise.all([
      $fetch('/api/hack/recruit', { method: 'POST', body: { tierId: props.tier.id } }),
      quickOpen.value ? Promise.resolve() : sleep(4600)
    ])
    if (vetTimer) {
      clearInterval(vetTimer)
      vetTimer = null
    }
    if (pingTimer) {
      clearTimeout(pingTimer)
      pingTimer = null
    }
    result.value = res.agent as unknown as PulledAgent
    audio.playSfx('purchase')
    emit('recruited')
    if (!quickOpen.value) await flash()
    stage.value = 'reveal'
    await nextTick()
    playReveal()
  } catch (e: any) {
    if (vetTimer) {
      clearInterval(vetTimer)
      vetTimer = null
    }
    if (pingTimer) {
      clearTimeout(pingTimer)
      pingTimer = null
    }
    toast.add({ title: e.data?.statusMessage ?? 'Recruitment failed', color: 'error' })
    stage.value = 'pitch'
  } finally {
    recruiting.value = false
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
  audio.playSfx(RARITY_STAMP_SFX[rarity])
  barkHandle?.cancel()
  barkDone.value = false
  const playAudio = audio.barkThrottle({ rare: rarity === 'elite' || rarity === 'phantom', quickOpen: quickOpen.value })
  const bark = pickRarityBark(rarity, 'agent')
  barkHandle = audio.playVoice(bark.voice, {
    captionsRef: barkCaption, text: bark.text, delayMs: 50,
    skipAudio: !playAudio, onEnd: () => { barkDone.value = true }
  })
  const { gsap } = await import('gsap')
  if (stampEl.value) gsap.fromTo(stampEl.value, { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(1.7)' })
  if (revealEl.value) gsap.fromTo(revealEl.value, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, delay: 0.15 })
}

function recruitAnother() {
  stage.value = 'pitch'
  result.value = null
  barkHandle?.cancel()
}

async function reject() {
  if (!result.value) return
  rejecting.value = true
  try {
    await $fetch('/api/hack/agents/fire', { method: 'POST', body: { agentId: result.value.id } })
    toast.add({ title: `${result.value.name} rejected`, color: 'neutral' })
    open.value = false
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed to reject', color: 'error' })
  } finally {
    rejecting.value = false
  }
}

function traitRange(type: AgentTrait['type']) {
  return AGENT_TRAIT_RANGES[type]
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-2xl bg-transparent shadow-none ring-0 rounded-none' }"
  >
    <template #content>
      <div
        ref="flashEl"
        class="hack-glitch-flash"
      />
      <div class="hack-shell hack-frame hack-frame-accent overflow-hidden">
        <!-- Stage 1: the pitch -->
        <template v-if="stage === 'pitch'">
          <div class="hack-contact-portrait">
            <img
              :src="contact?.portrait"
              :alt="`Contact: ${contact?.handle}`"
            >
          </div>
          <div class="p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="hack-eyebrow">
                  {{ tier.name }}
                </div>
                <h2 class="text-xl font-bold mt-1.5">
                  contact: {{ contact?.handle }}
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
                Quick recruit (skip animation)
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
                  :loading="recruiting"
                  :disabled="disabled"
                  label="Start Recruitment"
                  @click="audio.playSfx('click'); startRecruitment()"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Stage 2a: vetting sequence — distinct from the crate scan -->
        <template v-else-if="stage === 'vetting'">
          <div class="text-center py-14 px-5">
            <div class="hack-vet-figure">
              <div class="hack-vet-ring r1" />
              <div class="hack-vet-ring r2" />
              <div class="hack-vet-ring r3" />
              <UIcon
                name="i-lucide-user"
                class="size-16 text-muted opacity-25 relative"
              />
            </div>
            <div class="mono text-primary tracking-widest text-sm">
              {{ vetLabels[vetLabelIdx] }}
            </div>
            <div class="mono text-xs text-muted mt-2">
              {{ contact?.handle }} is running background &amp; skill verification
            </div>
          </div>
        </template>

        <!-- Stage 2b: rarity stamp + recruit reveal -->
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
            ref="revealEl"
            class="p-6"
          >
            <div class="flex items-center gap-4 mb-5">
              <HackAgentAvatar
                class="size-24 rounded-lg shrink-0"
                :name="result.name"
                :rarity="result.rarity"
              />
              <div class="min-w-0">
                <span
                  class="hack-card-title-lg text-lg"
                  :class="RARITY_STYLE[result.rarity].text"
                >{{ result.name }}</span>
                <p class="text-sm text-muted mt-0.5">
                  {{ CLASS_LABEL[result.class as keyof typeof CLASS_LABEL] }} · Level {{ result.level }}
                </p>
                <p class="text-xs text-dimmed mt-1.5 max-w-sm">
                  {{ agentBioLine({ class: result.class as any, rarity: result.rarity, traits: result.traits }) }}
                </p>
              </div>
            </div>

            <p class="hack-eyebrow mb-2">
              Rolled traits <span class="normal-case tracking-normal opacity-70">— bar shows where this roll landed vs. the max possible</span>
            </p>
            <div
              v-for="t in result.traits"
              :key="t.type"
              class="hack-trait-row"
            >
              <div class="flex items-center justify-between mb-2">
                <span><b>{{ formatTraitValue(t.type, t.value) }}</b> <span class="hack-mod-chip-label">{{ AGENT_TRAIT_LABEL[t.type] }}</span></span>
                <span class="text-dimmed mono text-xs">range {{ traitRange(t.type).min }} – {{ traitRange(t.type).max }}</span>
              </div>
              <HackRangeBar
                :min="traitRange(t.type).min"
                :max="traitRange(t.type).max"
                :value="t.value"
              />
            </div>

            <div class="flex items-center justify-between mt-5">
              <UButton
                color="error"
                variant="outline"
                :loading="rejecting"
                label="Reject Recruit"
                @click="reject"
              />
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  :loading="recruiting"
                  :label="`Recruit Another ($${formatNumber(tier.cost, true)})`"
                  @click="recruitAnother"
                />
                <UButton
                  label="Accept Recruit"
                  @click="open = false"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
