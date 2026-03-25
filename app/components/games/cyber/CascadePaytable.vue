<script setup lang="ts">
import { SYMBOL_CONFIG } from '#shared/utils/gamelogic/cyber-cascade'

const props = defineProps<{ bet: number }>()

const symbols = [
  { id: 'CYBER_SKULL', label: 'Cyber Skull', icon: 'i-lucide-skull', color: 'text-fuchsia-500', accentColor: 'text-fuchsia-500' },
  { id: 'NEON_7', label: 'Neon Bolt', icon: 'i-lucide-zap', color: 'text-cyan-400', accentColor: 'text-cyan-500' },
  { id: 'PLASMA_ORB', label: 'Plasma Orb', icon: 'i-lucide-disc-3', color: 'text-amber-400', accentColor: 'text-amber-500' },
  { id: 'DATA_CUBE', label: 'Data Cube', icon: 'i-lucide-box', color: 'text-blue-500', accentColor: 'text-blue-500' },
  { id: 'CHIP', label: 'Bio Chip', icon: 'i-lucide-cpu', color: 'text-emerald-500', accentColor: 'text-emerald-500' },
] as const

const getWin = (baseId: keyof typeof SYMBOL_CONFIG) =>
  (SYMBOL_CONFIG[baseId] * props.bet).toFixed(2)
</script>

<template>
  <div class="p-6 text-slate-300 font-mono text-sm space-y-8 bg-black/50">
    <!-- Symbol Values -->
    <section>
      <h3 class="text-cyan-500 font-bold mb-4 uppercase tracking-widest border-b border-cyan-900 pb-2">
        Symbol Payouts
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="sym in symbols"
          :key="sym.id"
          class="flex items-center gap-4 bg-black border border-white/5 p-3"
        >
          <UIcon :name="sym.icon" class="size-8 shrink-0" :class="sym.color" />
          <div>
            <div class="font-bold text-white">{{ sym.label }}</div>
            <div class="text-xs text-slate-500">
              Match 5+: <span :class="sym.accentColor">${{ getWin(sym.id) }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="space-y-4">
      <h3 class="text-cyan-500 font-bold mb-4 uppercase tracking-widest border-b border-cyan-900 pb-2">
        System Protocols
      </h3>

      <div class="flex flex-col md:flex-row gap-4">
        <div class="bg-cyan-950/20 border border-cyan-800 p-4 flex-1">
          <h4 class="text-cyan-400 font-bold mb-2">Base Protocol</h4>
          <p class="text-slate-500 text-xs leading-relaxed">
            Connect <strong class="text-white">5 or more</strong> matching symbols horizontally or vertically.
            <br /><br />
            Winning symbols vanish, new ones drop in. Wilds walk horizontally when part of a win.
          </p>
        </div>
        <div class="bg-yellow-950/20 border border-yellow-800 p-4 flex-1">
          <h4 class="text-yellow-500 font-bold mb-2">Wilds &amp; Merges</h4>
          <p class="text-slate-500 text-xs leading-relaxed">
            Wilds carry multipliers <strong class="text-white">(2x–10x)</strong>. If two Wilds collide, they
            <strong class="text-white">MERGE</strong>, taking the highest multiplier. Wild mults add per
            cluster, capped at <strong class="text-white">10x</strong>.
          </p>
        </div>
      </div>

      <div class="bg-fuchsia-950/20 border border-fuchsia-800 p-4">
        <h4 class="text-fuchsia-500 font-bold mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-radiation" class="size-4 text-red-500" />
          Neon Overdrive
        </h4>
        <p class="text-slate-400 text-xs leading-relaxed mb-2">
          Triggered by <span class="text-red-400 font-bold">3 Scatter</span> symbols anywhere on the grid.
          Awards <strong class="text-white">8 free spins</strong>.
        </p>
        <ul class="list-disc list-inside text-slate-500 text-xs space-y-1">
          <li>Wilds <strong class="text-white">persist</strong> between spins.</li>
          <li>Wilds walk after every spin sequence.</li>
          <li>Wilds leave <strong class="text-white">sticky multiplier trails</strong> on every cell they traverse (up to 64x).</li>
          <li>No new Wilds or Scatters spawn during free spins.</li>
        </ul>
      </div>
    </section>
  </div>
</template>
