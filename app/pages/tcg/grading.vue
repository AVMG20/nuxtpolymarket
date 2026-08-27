<script setup lang="ts">
import type { TcgSubmissionSummary, TcgGradePayload } from '#shared/types/tcg'
import type { TcgServiceKey } from '~/utils/tcg/slab'
import { buildSlabInfo } from '~/utils/tcg/slab-info'
import { SERVICES } from '#shared/utils/tcg/grading-model'
import { legacySetOf } from '#shared/utils/tcg/legacy'

/* The grader's front desk: what's away, what's back, and the reveal.
 * Submitting happens where the card is — the collection lightbox — this page
 * is the queue and the ceremony. The grade is decided the moment you collect.
 */
const { fetchSession } = useAuth()
const toast = useToast()

const { data: submissions, refresh } = useAsyncData('tcg-submissions', () => apiFetch<TcgSubmissionSummary[]>('/api/tcg/grading/submissions'))

// 1s ticker for the countdowns.
const now = ref(Date.now())
let ticker = 0
onMounted(() => {
  ticker = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => clearInterval(ticker))

const pending = computed(() =>
  (submissions.value ?? []).filter(s => s.state === 'pending' && new Date(s.returnsAt).getTime() > now.value))
const ready = computed(() =>
  (submissions.value ?? []).filter(s => s.state === 'pending' && new Date(s.returnsAt).getTime() <= now.value))
const history = computed(() =>
  (submissions.value ?? []).filter(s => s.state !== 'pending'))

function countdown(iso: string): string {
  const ms = Math.max(0, new Date(iso).getTime() - now.value)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

const serviceName = (key: string) =>
  (SERVICES as Record<string, { name: string }>)[key]?.name ?? key

/* ---- the reveal -------------------------------------------------------- */

const collecting = ref<string | null>(null)
const reveal = ref<{ submission: TcgSubmissionSummary, grade: TcgGradePayload } | null>(null)

async function collect(submission: TcgSubmissionSummary) {
  if (collecting.value) return
  collecting.value = submission.id
  try {
    const res = await apiFetch<import('nitropack/types').InternalApi['/api/tcg/grading/collect']['post']>('/api/tcg/grading/collect', {
      method: 'POST',
      body: { submissionId: submission.id }
    })
    reveal.value = {
      submission,
      grade: {
        service: res.result.service,
        grade: res.result.grade,
        score: res.result.score,
        designation: res.result.designation,
        subGrades: res.result.subGrades,
        flaws: res.result.flaws,
        certNumber: res.certNumber,
        gradedAt: new Date().toISOString()
      }
    }
    await Promise.all([refresh(), fetchSession()])
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not collect'), color: 'error' })
  } finally {
    collecting.value = null
  }
}

// The slab sizes to the viewport: the ceremony fills the screen.
const revealHeight = ref(560)
watch(reveal, (value) => {
  if (value) revealHeight.value = Math.max(420, Math.min(760, Math.round(window.innerHeight * 0.72)))
})

const revealInfo = computed(() => reveal.value
  ? buildSlabInfo({
      name: reveal.value.submission.card.name,
      rarity: reveal.value.submission.card.rarity,
      number: reveal.value.submission.card.number,
      setTotal: reveal.value.submission.card.setTotal,
      setName: reveal.value.submission.card.setName,
      setCode: reveal.value.submission.card.setCode,
      releaseDate: reveal.value.submission.card.releaseDate
    }, reveal.value.grade)
  : null)

function historyGradeLabel(s: TcgSubmissionSummary): string {
  if (!s.grade) return '—'
  const base = `${s.grade.service} ${s.grade.grade}`
  return s.grade.designation ? `${base} · ${s.grade.designation}` : base
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-6 p-4">
    <section v-if="ready.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Back from the grader</h2>
      <div class="space-y-2">
        <div
          v-for="s in ready"
          :key="s.id"
          class="flex items-center justify-between gap-3 rounded-lg bg-elevated p-3"
        >
          <div class="min-w-0">
            <div class="truncate font-medium text-highlighted">{{ s.card.name }}</div>
            <div class="truncate text-xs text-muted">
              {{ serviceName(s.service) }} · {{ s.serial }}
              <template v-if="s.predictedGrade"> · you called {{ s.predictedGrade }}</template>
            </div>
          </div>
          <UButton
            :loading="collecting === s.id"
            color="primary"
            icon="i-lucide-package-open"
            label="Open return"
            @click="collect(s)"
          />
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">At the grader</h2>
      <div
        v-if="pending.length"
        class="space-y-2"
      >
        <div
          v-for="s in pending"
          :key="s.id"
          class="flex items-center justify-between gap-3 rounded-lg bg-elevated p-3"
        >
          <div class="min-w-0">
            <div class="truncate font-medium text-highlighted">{{ s.card.name }}</div>
            <div class="truncate text-xs text-muted">
              {{ serviceName(s.service) }} · {{ formatNumber(s.fee) }} coins
            </div>
          </div>
          <span class="flex items-center gap-1.5 font-mono text-sm tabular-nums text-muted">
            <UIcon
              name="i-lucide-clock"
              class="size-4"
            />
            {{ countdown(s.returnsAt) }}
          </span>
        </div>
      </div>
      <p
        v-else
        class="rounded-lg bg-elevated p-4 text-sm text-muted"
      >
        Nothing at the grader. Open a card in your collection and send it in from there.
      </p>
    </section>

    <section v-if="history.length">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Graded</h2>
      <div class="space-y-1.5">
        <div
          v-for="s in history"
          :key="s.id"
          class="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2 text-sm"
        >
          <div class="min-w-0 truncate">
            <span class="font-medium text-highlighted">{{ s.card.name }}</span>
            <span class="ml-2 text-xs text-muted">{{ s.grade?.certNumber }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span
              v-if="s.predictedGrade"
              class="text-xs text-muted"
            >called {{ s.predictedGrade }}</span>
            <UBadge
              color="primary"
              variant="subtle"
            >
              {{ historyGradeLabel(s) }}
            </UBadge>
          </div>
        </div>
      </div>
    </section>

    <!-- The reveal: the slab itself, turnable, grade and all, over a
         full-screen black — the ceremony owns the room. -->
    <UModal
      :open="!!reveal"
      fullscreen
      :ui="{ content: 'bg-black' }"
      @update:open="(v: boolean) => { if (!v) reveal = null }"
    >
      <template #content>
        <div
          v-if="reveal && revealInfo"
          class="relative flex h-full w-full flex-col items-center justify-center gap-4 bg-black"
        >
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="lg"
            aria-label="Close"
            class="absolute right-4 top-4"
            @click="reveal = null"
          />
          <ClientOnly>
            <TcgSlab
              :service="reveal.grade.service as TcgServiceKey"
              :info="revealInfo"
              :bundle="reveal.submission.render.bundle ?? ''"
              :asset-number="String(reveal.submission.render.assetNumber ?? '')"
              :mask-kind="reveal.submission.render.maskKind ?? 'wp'"
              :foil-effect="reveal.submission.render.foilEffect"
              :pattern="reveal.submission.render.pattern"
              :legacy-set="reveal.submission.render.bundle ? null : legacySetOf(reveal.submission.render.plaatjesCardId)"
              :holo="reveal.submission.render.finish === 'holo'"
              :height="revealHeight"
            />
          </ClientOnly>
          <div class="text-center">
            <div class="text-lg font-semibold text-neutral-100">
              {{ reveal.grade.designation ?? '' }} {{ revealInfo.grade }}
            </div>
            <div class="font-mono text-xs text-neutral-500">{{ reveal.grade.certNumber }}</div>
            <div
              v-if="reveal.submission.predictedGrade"
              class="mt-1 text-xs text-neutral-400"
            >
              You called {{ reveal.submission.predictedGrade }} — the grader says {{ revealInfo.grade }}.
            </div>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
