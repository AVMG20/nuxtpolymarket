<script setup lang="ts">
import type { SectionSpot } from '#shared/utils/nitro-rush/custom'
import type { BranchEnding, JoinInlet } from '#shared/utils/nitro-rush/custom-forks'

/** The course's lines, main road first, each branch with how it ends; picking one builds on it, and a branch picks the join it heads for. */
const props = defineProps<{
    /** How each branch ends, branch 1 first. */
    endings: readonly BranchEnding[]
    /** The line being built on. */
    line: number
    joins: readonly JoinInlet[]
    /** Per join, whether the line being built on may head into it. */
    joinable: readonly boolean[]
}>()
const emit = defineEmits<{ select: [line: number], remove: [line: number], join: [to: SectionSpot | null] }>()

const lineName = (l: number) => l ? `Branch ${l}` : 'Main road'

/** Each join by its line and its place among that line's joins. */
const joinNames = computed(() => props.joins.map((j) => {
    const same = props.joins.filter(o => o.spot.branch === j.spot.branch)
    return `${lineName(j.spot.branch)}${same.length > 1 ? ` join ${same.indexOf(j) + 1}` : ''}`
}))
const nameOf = (to: SectionSpot) => joinNames.value[props.joins.findIndex(j => j.spot.branch === to.branch && j.spot.at === to.at)]?.toLowerCase() ?? 'its join'

function endText(e: BranchEnding) {
    if (e.kind === 'joins') return `joins ${nameOf(e.to)}`
    if (e.kind === 'short') return `${Math.round(e.metres)} m from ${nameOf(e.to)}`
    if (e.kind === 'askew') return `misses ${nameOf(e.to)}`
    return e.kind === 'finish' ? 'finish' : 'open'
}

const done = (e: BranchEnding) => e.kind === 'joins' || e.kind === 'finish'

const chosen = computed(() => props.joins.findIndex(j => j.branch === props.line))
/** The joins the active branch could head into, and the one it heads for now. */
const choices = computed(() => props.joins.flatMap((j, i) => i === chosen.value || props.joinable[i] ? [{ value: i, label: `${joinNames.value[i]}${j.branch && j.branch !== props.line ? ` (taken by branch ${j.branch})` : ''}` }] : []))

function onChoose(e: Event) {
    const i = Number((e.target as HTMLSelectElement).value)
    emit('join', i >= 0 ? props.joins[i]!.spot : null)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-bold tracking-wider text-white/60">ROADS</span>
    <ol class="flex flex-col gap-1">
      <li v-for="l in endings.length + 1" :key="l" class="nr-piece-row flex items-center gap-1">
        <button class="nr-piece min-w-0 flex-1" :class="{ 'is-active': line === l - 1 }" @click="emit('select', l - 1)">
          <UIcon :name="l === 1 ? 'i-lucide-route' : 'i-lucide-git-branch'" class="size-4 shrink-0" />
          <span class="truncate">{{ lineName(l - 1) }}</span>
          <span v-if="l > 1" class="nr-piece-tag" :class="{ 'is-done': done(endings[l - 2]!) }">{{ endText(endings[l - 2]!) }}</span>
        </button>
        <button v-if="l > 1 && line === l - 1" class="nr-piece-tool is-danger" aria-label="Remove branch" title="Remove branch, its split and its branches" @click="emit('remove', l - 1)">
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </li>
    </ol>
    <label v-if="line && choices.length" class="flex items-center gap-2 text-[11px] font-semibold text-white/60">
      <span class="shrink-0">JOINS</span>
      <select class="nr-select min-w-0 flex-1" :value="chosen" @change="onChoose">
        <option :value="-1">None</option>
        <option v-for="c in choices" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </label>
  </div>
</template>
