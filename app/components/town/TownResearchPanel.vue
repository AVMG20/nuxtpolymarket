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
            <h2>Research <span class="g-tag">{{ doneCount }}/{{ projects.length }}</span></h2>
            <button class="g-icon g-icon-sm" @click="emit('close')"><UIcon name="i-lucide-x" /></button>
        </div>

        <div v-if="activeDef" class="active-wrap">
            <div class="g-sec active-bar">
                <UIcon name="i-lucide-flask-conical" class="active-icon" />
                <div class="min-w-0 flex-1">
                    <b class="active-name">{{ activeDef.name }}</b>
                    <div class="g-progress mt-1"><i :style="{ width: `${Math.round(100 * (1 - activeRemaining / activeDef.durationMs))}%` }" /></div>
                </div>
                <b class="active-time">{{ formatTownDuration(activeRemaining) }}</b>
            </div>
        </div>

        <div class="g-window-body">
            <div v-for="row in rows" :key="row.id" class="branch">
                <div class="branch-head">
                    <span class="branch-emoji">{{ row.emoji }}</span>
                    <div class="min-w-0">
                        <b class="branch-name">{{ row.name }}</b>
                        <div class="branch-desc">{{ row.description }}</div>
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
                            <UIcon v-if="p.done" name="i-lucide-check" class="node-icon" />
                            <span v-else-if="p.id === active?.researchId" class="g-spinner" />
                            <UIcon v-else-if="!p.unlocked" name="i-lucide-lock" class="node-icon" />
                            <span v-else>{{ p.step }}</span>
                        </button>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="pickedDef" class="pick-bar">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <b class="pick-name">{{ pickedDef.name }}</b>
                    <span class="g-tag"><UIcon name="i-lucide-clock" /> {{ formatTownDuration(pickedDef.durationMs) }}</span>
                </div>
                <p class="pick-desc">{{ pickedDef.description }}</p>
                <div v-if="!pickedDef.done" class="pick-cost">
                    <span :class="balance >= pickedDef.coins ? 'is-gold' : 'is-short'"><TownCoin /> {{ formatNumber(pickedDef.coins) }}</span>
                    <span v-for="[id, q] in Object.entries(pickedDef.resources)" :key="id" :class="(inventory[id] ?? 0) >= q ? '' : 'is-short'"><TownAsset :id="id" /> {{ formatNumber(q) }}</span>
                </div>
            </div>
            <span v-if="pickedDef.done" class="g-tag g-tag-green shrink-0"><UIcon name="i-lucide-check" /> Done</span>
            <button
                v-else
                class="g-btn g-btn-primary shrink-0"
                :disabled="busy || !startable(pickedDef) || !affordable(pickedDef)"
                :data-tip="active ? 'One project runs at a time.' : !pickedDef.unlocked ? 'Finish the project before it first.' : !affordable(pickedDef) ? 'Short on what is marked red.' : undefined"
                @click="emit('start', pickedDef.id)"
            >
                <UIcon name="i-lucide-flask-conical" /> Research
            </button>
        </div>
        <div v-else class="pick-hint">Pick a project to see its cost.</div>
    </div>
</template>

<style scoped>
.active-wrap { padding: 10px 16px 0; }
.active-bar { display: flex; align-items: center; gap: 10px; }
.active-icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--g-accent); }
.active-name { font-size: 13px; font-weight: 600; }
.active-time { flex-shrink: 0; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }

.branch + .branch { margin-top: 14px; }
.branch-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
.branch-emoji {
    width: 32px; height: 32px; flex-shrink: 0;
    border-radius: var(--g-radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 16px; line-height: 1;
    background: var(--g-fill);
}
.branch-name { font-size: 13px; font-weight: 600; }
.branch-desc { font-size: 11px; color: var(--g-muted); }

.branch-line { display: flex; align-items: center; padding-left: 41px; }
.link { flex: 1; height: 2px; background: var(--g-line); }
.link.is-done { background: var(--g-green); }

.node {
    width: 30px; height: 30px; flex-shrink: 0;
    border-radius: var(--g-radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
    color: var(--g-text-2);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    transition: transform 0.1s ease, border-color 0.15s ease;
}
.node:hover { transform: translateY(-1px); border-color: var(--g-line-2); }
.node-icon { width: 14px; height: 14px; }
.node .g-spinner { width: 14px; height: 14px; border-width: 2px; }
.node.is-locked { opacity: 0.4; }
.node.is-done {
    background: var(--g-green-bg);
    border-color: color-mix(in srgb, var(--g-green) 45%, transparent);
    color: var(--g-green);
}
.node.is-active {
    background: color-mix(in srgb, var(--g-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--g-accent) 50%, transparent);
}
.node.is-picked { box-shadow: 0 0 0 2px color-mix(in srgb, var(--g-accent) 55%, transparent); }

.pick-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--g-line); }
.pick-name { font-size: 13px; font-weight: 600; }
.pick-desc { margin-top: 2px; font-size: 11px; color: var(--g-text-2); }
.pick-cost {
    margin-top: 5px;
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px;
    font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.pick-cost > span { display: inline-flex; align-items: center; gap: 4px; }
.pick-cost .is-gold { color: var(--g-gold); }
.pick-cost .is-short { color: var(--g-red); }
.pick-hint { padding: 10px 16px; border-top: 1px solid var(--g-line); font-size: 12px; color: var(--g-muted); text-align: center; }
</style>
