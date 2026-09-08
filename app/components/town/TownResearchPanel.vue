<script setup lang="ts">
import TownCoin from '~/components/town/TownCoin.vue'
import TownAsset from '~/components/town/TownAsset.vue'
import { TOWN_RESEARCH_BRANCH_DEFS } from '#shared/utils/gamelogic/town-research'

interface Project {
    id: string
    branch: string
    step: number
    name: string
    description: string
    durationMs: number
    coins: number
    resources: Record<string, number>
    done: boolean
    unlocked: boolean
}

const props = defineProps<{
    board: { active: { researchId: string, completesAt: number } | null, done: string[], projects: Project[] } | null
    inventory: Record<string, number>
    balance: number
    now: number
    busy: boolean
}>()

const emit = defineEmits<{
    start: [id: string]
    close: []
}>()

const projects = computed(() => props.board?.projects ?? [])
const active = computed(() => props.board?.active ?? null)
const activeDef = computed(() => projects.value.find(p => p.id === active.value?.researchId) ?? null)
const activeRemaining = computed(() => active.value ? Math.max(0, active.value.completesAt - props.now) : 0)
const doneCount = computed(() => projects.value.filter(p => p.done).length)

/** Rows of the tree: one branch each, its six steps left to right. */
const rows = computed(() => TOWN_RESEARCH_BRANCH_DEFS.map(branch => ({
    ...branch,
    steps: projects.value.filter(p => p.branch === branch.id).sort((a, b) => a.step - b.step)
})))

function affordable(p: Project) {
    if (props.balance < p.coins) return false
    return Object.entries(p.resources).every(([id, q]) => (props.inventory[id] ?? 0) >= q)
}

/** Only the next unfinished step of a branch is ever startable. */
function startable(p: Project) {
    return !p.done && p.unlocked && !active.value
}

const picked = ref<string | null>(null)
const pickedDef = computed(() => projects.value.find(p => p.id === picked.value) ?? null)

// The running project has its own bar at the top; showing it again below would
// be the same thing twice with a dead button under it.
watch(active, (a) => { if (a && picked.value === a.researchId) picked.value = null })

function pick(p: Project) {
    picked.value = picked.value === p.id ? null : p.id
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="g-window-head">
            <h2>🔬 Research <span class="text-sm font-semibold opacity-50">{{ doneCount }}/{{ projects.length }}</span></h2>
            <button class="g-icon g-icon-sm" @click="emit('close')">✕</button>
        </div>

        <div v-if="activeDef" class="active-bar">
            <span class="text-lg">🔬</span>
            <div class="min-w-0 flex-1">
                <b class="text-sm">{{ activeDef.name }}</b>
                <div class="g-progress mt-1"><i :style="{ width: `${Math.round(100 * (1 - activeRemaining / activeDef.durationMs))}%` }" /></div>
            </div>
            <b class="shrink-0 tabular-nums text-sm">{{ formatTownDuration(activeRemaining) }}</b>
        </div>

        <div class="g-window-body">
            <div v-for="row in rows" :key="row.id" class="branch">
                <div class="branch-head">
                    <span class="branch-emoji">{{ row.emoji }}</span>
                    <div class="min-w-0">
                        <b class="text-sm">{{ row.name }}</b>
                        <div class="text-[11px] opacity-55">{{ row.description }}</div>
                    </div>
                </div>
                <div class="branch-line">
                    <template v-for="(p, i) in row.steps" :key="p.id">
                        <span v-if="i > 0" class="link" :class="row.steps[i - 1]!.done ? 'is-done' : ''" />
                        <button
                            class="node"
                            :class="[p.done ? 'is-done' : '', p.id === active?.researchId ? 'is-active' : '', !p.unlocked ? 'is-locked' : '', picked === p.id ? 'is-picked' : '']"
                            @click="pick(p)"
                        >
                            <span v-if="p.done">✓</span>
                            <span v-else-if="p.id === active?.researchId" class="g-spinner g-spinner-xs" />
                            <span v-else-if="!p.unlocked">🔒</span>
                            <span v-else>{{ p.step }}</span>
                        </button>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="pickedDef" class="pick-bar">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <b class="text-sm">{{ pickedDef.name }}</b>
                    <span class="g-tag">⏱ {{ formatTownDuration(pickedDef.durationMs) }}</span>
                </div>
                <p class="text-[11px] opacity-65">{{ pickedDef.description }}</p>
                <div v-if="!pickedDef.done" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold tabular-nums">
                    <span :class="balance >= pickedDef.coins ? '' : 'bad'"><TownCoin /> {{ formatNumber(pickedDef.coins) }}</span>
                    <span v-for="[id, q] in Object.entries(pickedDef.resources)" :key="id" :class="(inventory[id] ?? 0) >= q ? '' : 'bad'"><TownAsset :id="id" /> {{ formatNumber(q) }}</span>
                </div>
            </div>
            <div v-if="pickedDef.done" class="shrink-0 text-xs font-bold text-emerald-300">✓ Done</div>
            <button
                v-else
                class="g-btn g-btn-primary shrink-0"
                :disabled="busy || !startable(pickedDef) || !affordable(pickedDef)"
                :data-tip="active ? 'Only one project runs at a time.' : !pickedDef.unlocked ? 'Finish the project before it first.' : !affordable(pickedDef) ? 'You are short on what is marked red.' : undefined"
                @click="emit('start', pickedDef.id)"
            >
                🔬 Research
            </button>
        </div>
        <div v-else class="pick-hint">{{ active ? 'One project runs at a time. Pick another to see what it costs.' : 'Pick a project to see what it costs.' }}</div>
    </div>
</template>

<style scoped>
.active-bar { display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--g-line); background: rgba(122, 162, 247, 0.12); }

.branch + .branch { margin-top: 14px; }
.branch-head { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
.branch-emoji { width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; background: rgba(255, 255, 255, 0.07); }

.branch-line { display: flex; align-items: center; padding-left: 39px; }
.link { flex: 1; height: 2px; background: rgba(255, 255, 255, 0.12); }
.link.is-done { background: rgba(79, 211, 106, 0.55); }

.node {
    width: 32px; height: 32px; flex-shrink: 0; border-radius: 10px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800;
    background: rgba(255, 255, 255, 0.06); border: 1px solid var(--g-line);
    transition: transform 0.1s ease, border-color 0.15s ease;
}
.node:hover { transform: translateY(-1px); border-color: rgba(255, 255, 255, 0.35); }
.node.is-locked { opacity: 0.4; }
.node.is-done { background: rgba(79, 211, 106, 0.2); border-color: rgba(79, 211, 106, 0.55); color: #9af0a8; }
.node.is-active { background: rgba(122, 162, 247, 0.22); border-color: rgba(122, 162, 247, 0.7); }
.node.is-picked { box-shadow: 0 0 0 2px var(--g-gold); }

.pick-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--g-line); }
.pick-hint { padding: 10px 16px; border-top: 1px solid var(--g-line); font-size: 12px; opacity: 0.5; text-align: center; }
.bad { color: #ff8a8a; }
</style>
