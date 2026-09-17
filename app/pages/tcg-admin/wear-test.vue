<script setup lang="ts">
import type { TcgWearSpec } from '#shared/types/tcg'
import { TCG_CENTERING } from '#shared/utils/tcg/condition'

// Dev harness: every wear effect at controllable severity on one card, so the
// visual language can be tuned by eye instead of by pack-opening lottery.
// One slider per defect channel; 0 removes the defect entirely.
// Admin-only; not linked from anywhere.
const { user } = useAuth()

const centering = ref(0.8)
const centeringAngle = ref(-30)
const corners = ref(0.8)
const edges = ref(0.8)
const scratch = ref(0.8)
const printLine = ref(0.8)
const dimple = ref(0.8)
const gloss = ref(0.8)

const sliders = [
  { label: 'Centering', model: centering },
  { label: 'Corners', model: corners },
  { label: 'Edges', model: edges },
  { label: 'Scratch', model: scratch },
  { label: 'Print line', model: printLine },
  { label: 'Dimple', model: dimple },
  { label: 'Gloss loss', model: gloss }
]

const spec = computed<TcgWearSpec>(() => ({
  centering: {
    // The slider IS the centering severity a real copy rolls: mapped through
    // the same curve and ceiling the server uses, so 1.00 = the worst
    // factory cut deriveWearSpec can ever emit.
    dx: TCG_CENTERING.maxOffset * Math.pow(centering.value, TCG_CENTERING.curve)
      * Math.cos(centeringAngle.value * Math.PI / 180),
    dy: TCG_CENTERING.maxOffset * Math.pow(centering.value, TCG_CENTERING.curve)
      * Math.sin(centeringAngle.value * Math.PI / 180)
  },
  corners: corners.value > 0
    ? [
        { corner: 'tl', severity: corners.value, seed: 11 },
        { corner: 'br', severity: corners.value * 0.6, seed: 22 }
      ]
    : [],
  edges: edges.value > 0
    ? [
        { edge: 'top', severity: edges.value * 0.8, seed: 33 },
        { edge: 'left', severity: edges.value * 0.5, seed: 44 }
      ]
    : [],
  surface: [
    ...scratch.value > 0
      ? [{ x: 0.4, y: 0.62, angle: 2.1, type: 'scratch' as const, severity: scratch.value, seed: 55 }]
      : [],
    ...printLine.value > 0
      ? [{ x: 0.5, y: 0.4, angle: 0.1, type: 'print_line' as const, severity: printLine.value * 0.8, seed: 66 }]
      : [],
    ...dimple.value > 0
      ? [{ x: 0.72, y: 0.75, angle: 0, type: 'dimple' as const, severity: dimple.value, seed: 77 }]
      : [],
    ...gloss.value > 0
      ? [{ x: 0.3, y: 0.2, angle: 0, type: 'gloss_loss' as const, severity: gloss.value, seed: 88 }]
      : []
  ]
}))

// Remount on any change: the spec watch in TcgCard handles live updates, but
// a fresh mount per tweak keeps the harness dead simple and glitch-free.
const specKey = computed(() => JSON.stringify(spec.value))
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 p-6">
    <template v-if="user?.isPokemonAdmin">
      <div class="flex items-start gap-6">
        <div class="w-64 shrink-0 space-y-3 rounded-lg bg-elevated p-4">
          <div
            v-for="s in sliders"
            :key="s.label"
            class="space-y-1"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">{{ s.label }}</span>
              <span class="font-mono text-xs tabular-nums">{{ s.model.value.toFixed(2) }}</span>
            </div>
            <USlider
              v-model="s.model.value"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <template v-if="s.label === 'Centering'">
              <div class="flex items-center justify-between pt-1">
                <span class="text-sm text-muted">↳ direction</span>
                <span class="font-mono text-xs tabular-nums">{{ centeringAngle }}°</span>
              </div>
              <USlider
                v-model="centeringAngle"
                :min="-180"
                :max="180"
                :step="15"
              />
            </template>
          </div>
        </div>
        <div class="flex flex-1 justify-center rounded-lg bg-elevated p-6">
          <ClientOnly>
            <TcgCard
              :key="specKey"
              bundle="sv8-5_en_077"
              asset-number="077"
              mask-kind="wp"
              foil-effect="NonFoil"
              :wear="spec"
              :height="640"
            />
          </ClientOnly>
        </div>
      </div>
      <p class="text-xs text-muted">
        Corners: tl at full + br at 60% of slider · Edges: top at 80% + left at 50% · centering slider = real severity through the server's curve and ceiling (1.00 = worst possible roll) + direction angle (0° = print shifts right, 90° = up) · 0 removes a defect
      </p>
    </template>
    <UAlert
      v-else
      title="Admins only"
      color="warning"
    />
  </div>
</template>
