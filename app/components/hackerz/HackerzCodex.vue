<script setup lang="ts">
import type { CodexEntry, CodexSection } from '~/utils/hackerz-codex'

/**
 * The Hackerz database, opened from the uplink or the Mainframe: the threat
 * database (every hostile and how it gets in) and the hardening tools (every
 * piece of the defence, explained).
 */

const props = defineProps<{
  /** The entries opened so far: bought, met on the board, or known from the start. */
  known: ReadonlySet<string>
}>()
const emit = defineEmits<{ close: [] }>()

type Mode = 'threats' | 'hardening'
const mode = ref<Mode>('threats')

/** The Database starts incomplete: only what has been opened shows, and empty sections drop out. */
function opened(all: CodexSection[]) {
  return all
    .map(section => ({ ...section, entries: section.entries.filter(entry => props.known.has(entry.id)) }))
    .filter(section => section.entries.length > 0)
}
const allThreats = hackerzThreatCodex()
const allHardening = hackerzHardeningCodex()
const threats = computed(() => opened(allThreats))
const hardening = computed(() => opened(allHardening))
const sections = computed<CodexSection[]>(() => mode.value === 'threats' ? threats.value : hardening.value)
/** Records decrypted out of the whole database, for the header. */
const decrypted = computed(() => [...threats.value, ...hardening.value].reduce((sum, s) => sum + s.entries.length, 0))
const total = [...allThreats, ...allHardening].reduce((sum, s) => sum + s.entries.length, 0)
const selectedId = ref(threats.value[0]?.entries[0]?.id ?? '')
const selected = computed<CodexEntry | null>(() => {
  for (const section of sections.value) {
    const hit = section.entries.find(entry => entry.id === selectedId.value)
    if (hit) return hit
  }
  return sections.value[0]?.entries[0] ?? null
})

function switchMode(next: Mode) {
  mode.value = next
  selectedId.value = (next === 'threats' ? threats : hardening).value[0]?.entries[0]?.id ?? ''
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="hz-console hz-console--solid absolute inset-0 z-20 flex flex-col">
    <div class="relative z-10 flex items-center justify-between gap-3 border-b border-cyan-400/15 px-4 py-2.5">
      <div class="flex items-baseline gap-3 min-w-0">
        <span class="hz-title text-lg">DATABASE</span>
        <span class="hidden sm:inline truncate font-mono text-[11px] text-lime-300/60">
          root@firewall:~# cat /var/db/{{ mode === 'threats' ? 'threats.db' : 'hardening.db' }}
        </span>
        <span class="shrink-0 font-mono text-[11px] text-cyan-300/50" title="Buy or meet things to decrypt their records">
          {{ decrypted }}/{{ total }} decrypted
        </span>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" class="hz-tab" :class="{ 'hz-tab--on': mode === 'threats' }" @click="switchMode('threats')">
          <UIcon name="i-lucide-biohazard" class="size-3.5" /> Threat DB
        </button>
        <button type="button" class="hz-tab" :class="{ 'hz-tab--on': mode === 'hardening' }" @click="switchMode('hardening')">
          <UIcon name="i-lucide-shield-check" class="size-3.5" /> Hardening
        </button>
        <button type="button" class="hz-tab" aria-label="Close the database" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
    </div>

    <div class="relative z-10 flex min-h-0 flex-1 flex-col sm:flex-row">
      <!-- Index -->
      <nav class="max-h-40 sm:max-h-none sm:w-60 shrink-0 overflow-y-auto border-b sm:border-b-0 sm:border-r border-cyan-400/10 p-2">
        <div v-for="section in sections" :key="section.id" class="mb-3">
          <div class="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300/45">
            // {{ section.title }}
          </div>
          <button
            v-for="entry in section.entries"
            :key="entry.id"
            type="button"
            class="hz-index"
            :class="{ 'hz-index--on': selected?.id === entry.id }"
            :style="{ '--accent': entry.color }"
            @click="selectedId = entry.id"
          >
            <UIcon :name="entry.icon" class="size-3.5 shrink-0" :style="{ color: entry.color }" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
        </div>
      </nav>

      <!-- Entry -->
      <article v-if="selected" class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div class="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
          <div class="min-w-0 lg:max-w-2xl lg:flex-1">
            <div class="flex items-start gap-4">
          <div class="hz-badge" :style="{ '--accent': selected.color }">
            <UIcon :name="selected.icon" class="size-7" :style="{ color: selected.color }" />
          </div>
          <div class="min-w-0">
            <div class="font-mono text-[11px] uppercase tracking-[0.2em]" :style="{ color: selected.color }">
              {{ selected.kicker }}
            </div>
            <h2 class="hz-title mt-0.5 text-2xl" :style="{ '--glow': selected.color }">
              {{ selected.name }}
            </h2>
          </div>
        </div>

        <p class="mt-4 max-w-2xl text-sm leading-relaxed text-white/75">
          {{ selected.summary }}
        </p>

        <div v-if="selected.stats.length" class="mt-4 grid max-w-2xl grid-cols-2 gap-1.5 sm:grid-cols-3">
          <div v-for="stat in selected.stats" :key="stat.label + stat.value" class="hz-stat">
            <div class="font-mono text-[10px] uppercase tracking-widest text-white/40">
              {{ stat.label }}
            </div>
            <div class="font-mono text-sm text-white">
              {{ stat.value }}
            </div>
          </div>
        </div>

        <ul v-if="selected.notes.length" class="mt-4 max-w-2xl space-y-1.5">
          <li v-for="note in selected.notes" :key="note" class="flex gap-2 text-[13px] leading-snug text-white/65">
            <span class="font-mono text-cyan-300/70">&gt;</span>
            <span>{{ note }}</span>
          </li>
        </ul>

        <!-- A deployable at work: a sandbox board playing out its script, on a loop. -->
        <HackerzDeployableDemo
          v-if="selected.demo"
          :key="selected.demo"
          class="mt-5 max-w-2xl"
          :id="selected.demo"
        />

        <div v-if="selected.tip" class="hz-tip mt-5 max-w-2xl">
          <span class="font-mono text-[10px] uppercase tracking-[0.25em] text-lime-300/80">{{ selected.demo ? 'tactic' : 'counter' }}</span>
          <p class="mt-0.5 text-[13px] text-lime-100/85">
            {{ selected.tip }}
          </p>
        </div>
          </div>

          <!-- The entry on a turntable: drag to turn it, click for its next animation. -->
          <HackerzModelViewer
            v-if="selected.model"
            class="w-full shrink-0 lg:w-72"
            :spec="selected.model"
          />
        </div>
      </article>
    </div>
  </div>
</template>

<style>
@import '~/assets/css/hackerz.css';
</style>
