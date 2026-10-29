<script setup lang="ts">
import { RIFTBORN_BOSS_TIMES, RIFTBORN_CLASSES, riftbornClass } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassDef } from '#shared/utils/gamelogic/riftborn'
import { ELITE_AFFIXES } from './engine/affixes'
import { BOSS_DEFS, BOSS_ORDER } from './engine/bosses'
import type { WeaponDef } from './engine/core'
import { REGULAR_DEFS } from './engine/enemies'
import type { EnemyDef, Sfx } from './engine/types'
import { PASSIVE_DEFS, PASSIVES } from './engine/upgrades'
import { describeMods, WEAPON_DEFS, WEAPON_MAX_LEVEL } from './engine/weapons'
import RiftbornPortrait from './RiftbornPortrait.vue'
import { BOSS_LORE, ENEMY_LORE, ENEMY_LORE_FALLBACK, cachedThumb, findAbilities, onThumb, requestThumbs } from './riftborn-codex'
import { formatClock, hex } from './riftborn-ui'

const props = defineProps<{
  sfx: Sfx
  unlockedClasses: string[]
}>()

const emit = defineEmits<{
  hover: []
}>()

// ─── Data ────────────────────────────────────────────────────────────────

const weapons = Object.values(WEAPON_DEFS)

const classRows = RIFTBORN_CLASSES.map((c: RiftbornClassDef) => {
  const weapon = WEAPON_DEFS[c.startingWeapon]
  return {
    def: c,
    color: hex(c.color),
    weapon: weapon ? { name: weapon.name, icon: weapon.icon, color: hex(weapon.color) } : null,
    stats: [
      { label: 'HP', value: String(c.baseHp), pct: (c.baseHp - 60) / 90 },
      { label: 'SPD', value: String(c.baseSpeed), pct: (c.baseSpeed - 150) / 90 },
      { label: 'MGT', value: `${Math.round(c.might * 100)}%`, pct: (c.might - 0.85) / 0.35 },
      { label: 'ARM', value: String(c.armor), pct: (c.armor + 0.6) / 3 }
    ].map(s => ({ ...s, pct: Math.max(0.08, Math.min(1, s.pct)) })),
    search: `${c.name} ${c.title} ${c.description} ${c.ultimate} ${c.trait}`
  }
})

const weaponRows = weapons.map((w: WeaponDef) => {
  const cls = w.classWeapon ? riftbornClass(w.classWeapon) : undefined
  const passive = PASSIVE_DEFS[w.evo.passive]
  return {
    def: w,
    color: hex(w.color),
    evoColor: hex(w.evo.color),
    cls: cls ? { name: cls.name, color: hex(cls.color) } : null,
    passive: passive ? { name: passive.name, icon: passive.icon, color: hex(passive.color) } : null,
    chips: [
      { label: 'DMG', value: formatNumber(w.base.damage) },
      { label: 'CD', value: `${Math.round(w.base.cooldown * 100) / 100}s` },
      ...(w.base.amount > 1 ? [{ label: 'x', value: String(w.base.amount) }] : [])
    ],
    path: w.levels.map((m, i) => ({ level: i + 2, text: describeMods(w, m, 1, 0) || 'Stronger' })),
    search: `${w.name} ${w.description} ${w.evo.name} ${w.evo.description} ${passive?.name ?? ''}`
  }
})

const passiveRows = PASSIVES.map((p) => {
  const evolves = weapons.filter(w => w.evo.passive === p.id).map(w => ({ id: w.id, name: w.name, evo: w.evo.name, icon: w.evo.icon, color: hex(w.evo.color) }))
  return {
    def: p,
    color: hex(p.color),
    per: p.text(p.per),
    max: p.text(p.per * p.maxLevel),
    evolves,
    search: `${p.name} ${p.text(p.per)} ${evolves.map(e => `${e.name} ${e.evo}`).join(' ')}`
  }
})

const abilityModules = import.meta.glob('./engine/abilities*.ts', { eager: true })
const abilityRows = findAbilities(abilityModules as Record<string, unknown>).map(a => ({
  ...a,
  hexColor: hex(a.color),
  search: `${a.name} ${a.description}`
}))

const enemyRows = Object.values(REGULAR_DEFS).map((d: EnemyDef) => {
  const lore = ENEMY_LORE[d.id] ?? ENEMY_LORE_FALLBACK
  return {
    def: d,
    lore,
    glow: d.glow !== undefined ? hex(d.glow) : '#b28cff',
    chips: [
      { label: 'HP', value: formatNumber(d.hp) },
      { label: 'SPD', value: formatNumber(d.speed) },
      { label: 'DMG', value: formatNumber(d.damage) },
      { label: 'XP', value: formatNumber(d.xp) }
    ],
    search: `${d.name} ${lore.tag} ${lore.text}`
  }
})

const affixRows = Object.values(ELITE_AFFIXES).map(a => ({ id: a.id, name: a.name, color: hex(a.color) }))

const bossRows = BOSS_ORDER.flatMap((id, i) => {
  const d = BOSS_DEFS[id]
  if (!d) return []
  const lore = BOSS_LORE[id]
  const parts = (lore?.parts ?? []).flatMap((pid) => {
    const p = BOSS_DEFS[pid]
    return p ? [p] : []
  })
  const time = RIFTBORN_BOSS_TIMES[i]
  return [{
    def: d,
    lore,
    time: time !== undefined ? formatClock(time) : null,
    glow: d.glow !== undefined ? hex(d.glow) : '#ff3fa4',
    parts: parts.filter((p, j) => parts.findIndex(o => o.name === p.name) === j && p.name !== d.name),
    chips: [
      { label: 'HP', value: formatNumber(d.hp) },
      { label: 'DMG', value: formatNumber(d.damage) },
      { label: 'XP', value: formatNumber(d.xp) }
    ],
    search: `${d.name} ${lore?.title ?? ''} ${lore?.text ?? ''}`
  }]
})

// ─── Sections and search ────────────────────────────────────────────────

type Section = 'classes' | 'weapons' | 'passives' | 'abilities' | 'enemies' | 'bosses'
const section = ref<Section>('classes')
const query = ref('')

const sections = computed(() => [
  { id: 'classes' as const, label: 'Classes', icon: 'i-lucide-users', count: classRows.length },
  { id: 'weapons' as const, label: 'Weapons', icon: 'i-lucide-sword', count: weaponRows.length },
  { id: 'passives' as const, label: 'Passives', icon: 'i-lucide-gem', count: passiveRows.length },
  { id: 'abilities' as const, label: 'Abilities', icon: 'i-lucide-sparkles', count: abilityRows.length },
  { id: 'enemies' as const, label: 'Enemies', icon: 'i-lucide-skull', count: enemyRows.length },
  { id: 'bosses' as const, label: 'Bosses', icon: 'i-lucide-crown', count: bossRows.length }
])

function openSection(id: Section) {
  if (section.value === id) return
  props.sfx.play('uiClick')
  section.value = id
  openId.value = null
}

const needle = computed(() => query.value.trim().toLowerCase())
function match<T extends { search: string }>(rows: T[]): T[] {
  const q = needle.value
  return q ? rows.filter(r => r.search.toLowerCase().includes(q)) : rows
}
const shownClasses = computed(() => match(classRows))
const shownWeapons = computed(() => match(weaponRows))
const shownPassives = computed(() => match(passiveRows))
const shownAbilities = computed(() => match(abilityRows))
const shownEnemies = computed(() => match(enemyRows))
const shownBosses = computed(() => match(bossRows))
const shownCount = computed(() => ({
  classes: shownClasses.value.length,
  weapons: shownWeapons.value.length,
  passives: shownPassives.value.length,
  abilities: shownAbilities.value.length,
  enemies: shownEnemies.value.length,
  bosses: shownBosses.value.length
})[section.value])

const isUnlocked = (id: string) => props.unlockedClasses.includes(id)

/* Weapon cards expand to show their level path */
const openId = ref<string | null>(null)
function toggle(id: string) {
  props.sfx.play('uiClick', { volume: 0.6 })
  openId.value = openId.value === id ? null : id
}

// ─── Thumbnails ──────────────────────────────────────────────────────────

const thumbs = ref<Record<string, string | null>>({})
let unsubscribe: (() => void) | null = null

function thumbOf(id: string): string | null | undefined {
  return thumbs.value[id]
}

function wantThumbs(which: Section) {
  if (which === 'enemies') requestThumbs(enemyRows.map(r => r.def))
  else if (which === 'bosses') requestThumbs(bossRows.flatMap(r => [r.def, ...r.parts]))
}

onMounted(() => {
  const seed: Record<string, string | null> = {}
  for (const d of [...Object.values(REGULAR_DEFS), ...Object.values(BOSS_DEFS)]) {
    const url = cachedThumb(d.id)
    if (url !== undefined) seed[d.id] = url
  }
  thumbs.value = seed
  unsubscribe = onThumb((id, url) => {
    thumbs.value = { ...thumbs.value, [id]: url }
  })
  wantThumbs(section.value)
})
onBeforeUnmount(() => unsubscribe?.())
watch(section, wantThumbs)
</script>

<template>
  <section class="rb-codex">
    <header class="rb-codex-head">
      <div>
        <h2 class="rb-h2">Codex</h2>
      </div>
      <label class="rb-codex-search">
        <UIcon name="i-lucide-search" class="size-4 shrink-0 opacity-60" />
        <input v-model="query" type="search" placeholder="Search" aria-label="Search the codex">
        <button v-if="query" type="button" class="rb-codex-clear" aria-label="Clear search" @click="query = ''">
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </label>
    </header>

    <nav class="rb-codex-pills" aria-label="Codex sections">
      <button
        v-for="s in sections"
        :key="s.id"
        type="button"
        class="rb-codex-pill"
        :class="{ active: section === s.id }"
        :aria-pressed="section === s.id"
        @click="openSection(s.id)"
        @mouseenter="emit('hover')"
      >
        <UIcon :name="s.icon" class="size-3.5" />
        <span>{{ s.label }}</span>
        <span class="rb-codex-count">{{ s.count }}</span>
      </button>
    </nav>

    <p v-if="needle && shownCount === 0" class="rb-codex-empty">
      <UIcon name="i-lucide-search-x" class="size-5" />
      No match for “{{ query.trim() }}”
    </p>

    <!-- classes -->
    <div v-if="section === 'classes'" :key="section" class="rb-codex-grid wide">
      <article
        v-for="(c, i) in shownClasses"
        :key="c.def.id"
        class="rb-entry rb-class-entry"
        :class="{ locked: !isUnlocked(c.def.id) }"
        :style="{ '--ec': c.color, 'animationDelay': `${i * 0.04}s` }"
        @mouseenter="emit('hover')"
      >
        <div class="rb-class-art">
          <RiftbornPortrait :class-id="c.def.id" :color="c.color" :locked="!isUnlocked(c.def.id)" />
          <span v-if="!isUnlocked(c.def.id)" class="rb-entry-lock"><UIcon name="i-lucide-lock" class="size-3" /> Sealed</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="rb-entry-kicker">{{ c.def.title }}</div>
          <h3 class="rb-entry-name">{{ c.def.name }}</h3>
          <p class="rb-entry-text">{{ c.def.description }}</p>
          <div class="rb-class-stats">
            <div v-for="s in c.stats" :key="s.label" class="rb-class-stat">
              <span>{{ s.label }}</span>
              <div class="rb-class-track"><div :style="{ width: `${s.pct * 100}%` }" /></div>
              <b>{{ s.value }}</b>
            </div>
          </div>
          <dl class="rb-class-facts">
            <div v-if="c.weapon">
              <dt>Weapon</dt>
              <dd><UIcon :name="c.weapon.icon" class="size-3.5 shrink-0" :style="{ color: c.weapon.color }" /> {{ c.weapon.name }}</dd>
            </div>
            <div>
              <dt>Ultimate</dt>
              <dd><UIcon name="i-lucide-zap" class="size-3.5 shrink-0" :style="{ color: c.color }" /> {{ c.def.ultimate }}</dd>
            </div>
            <div class="full">
              <dd class="rb-class-ult">{{ c.def.ultimateDescription }}</dd>
            </div>
            <div class="full">
              <dt>Trait</dt>
              <dd>{{ c.def.trait }}</dd>
            </div>
          </dl>
        </div>
      </article>
    </div>

    <!-- weapons -->
    <div v-else-if="section === 'weapons'" :key="section" class="rb-codex-grid">
      <article
        v-for="(w, i) in shownWeapons"
        :key="w.def.id"
        class="rb-entry rb-weapon"
        :class="{ open: openId === w.def.id }"
        :style="{ '--ec': w.color, '--evc': w.evoColor, 'animationDelay': `${i * 0.03}s` }"
        role="button"
        tabindex="0"
        :aria-expanded="openId === w.def.id"
        @click="toggle(w.def.id)"
        @keydown.enter.prevent="toggle(w.def.id)"
        @keydown.space.prevent="toggle(w.def.id)"
        @mouseenter="emit('hover')"
      >
        <div class="rb-entry-top">
          <span class="rb-glyph"><UIcon :name="w.def.icon" class="size-6" /></span>
          <div class="min-w-0 flex-1">
            <h3 class="rb-entry-name">{{ w.def.name }}</h3>
            <div class="rb-chips">
              <span v-for="ch in w.chips" :key="ch.label" class="rb-chip"><small>{{ ch.label }}</small>{{ ch.value }}</span>
            </div>
          </div>
          <span v-if="w.cls" class="rb-class-badge" :style="{ '--bc': w.cls.color }">{{ w.cls.name }}</span>
        </div>
        <p class="rb-entry-text">{{ w.def.description }}</p>

        <div class="rb-recipe">
          <span class="rb-recipe-part">
            <span class="rb-recipe-icon" :style="{ color: w.color }"><UIcon :name="w.def.icon" class="size-4" /></span>
            <span>Lv {{ WEAPON_MAX_LEVEL }}</span>
          </span>
          <UIcon name="i-lucide-plus" class="size-3 shrink-0 opacity-60" />
          <span v-if="w.passive" class="rb-recipe-part">
            <span class="rb-recipe-icon" :style="{ color: w.passive.color }"><UIcon :name="w.passive.icon" class="size-4" /></span>
            <span class="truncate">{{ w.passive.name }}</span>
          </span>
          <UIcon name="i-lucide-arrow-right" class="size-3.5 shrink-0 rb-recipe-arrow" />
          <span class="rb-recipe-part evo">
            <span class="rb-recipe-icon"><UIcon :name="w.def.evo.icon" class="size-4" /></span>
            <span class="truncate">{{ w.def.evo.name }}</span>
          </span>
        </div>

        <div v-if="openId === w.def.id" class="rb-weapon-more" @click.stop>
          <div class="rb-evo">
            <div class="rb-evo-flames" aria-hidden="true" />
            <div class="rb-evo-kicker"><UIcon name="i-lucide-flame" class="size-3" /> Evolution</div>
            <div class="rb-evo-name">{{ w.def.evo.name }}</div>
            <p class="rb-evo-text">{{ w.def.evo.description }}</p>
          </div>
          <ol class="rb-path">
            <li v-for="p in w.path" :key="p.level">
              <b>Lv {{ p.level }}</b><span>{{ p.text }}</span>
            </li>
          </ol>
        </div>
        <span class="rb-more-hint">
          <UIcon :name="openId === w.def.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
          {{ openId === w.def.id ? 'Less' : 'Level path' }}
        </span>
      </article>
    </div>

    <!-- passives -->
    <div v-else-if="section === 'passives'" :key="section" class="rb-codex-grid">
      <article
        v-for="(p, i) in shownPassives"
        :key="p.def.id"
        class="rb-entry"
        :style="{ '--ec': p.color, 'animationDelay': `${i * 0.03}s` }"
        @mouseenter="emit('hover')"
      >
        <div class="rb-entry-top">
          <span class="rb-glyph"><UIcon :name="p.def.icon" class="size-6" /></span>
          <div class="min-w-0 flex-1">
            <h3 class="rb-entry-name">{{ p.def.name }}</h3>
            <div class="rb-pips">
              <i v-for="n in p.def.maxLevel" :key="n" />
              <span>Max Lv {{ p.def.maxLevel }}</span>
            </div>
          </div>
        </div>
        <dl class="rb-passive-lines">
          <div><dt>Per level</dt><dd>{{ p.per }}</dd></div>
          <div v-if="p.def.maxLevel > 1"><dt>At max</dt><dd>{{ p.max }}</dd></div>
        </dl>
        <div v-if="p.evolves.length" class="rb-evolves">
          <span class="rb-evolves-label"><UIcon name="i-lucide-flame" class="size-3" /> Evolves</span>
          <span v-for="e in p.evolves" :key="e.id" class="rb-evolves-item" :style="{ '--evc': e.color }">
            {{ e.name }}
            <UIcon name="i-lucide-arrow-right" class="size-3 opacity-60" />
            <UIcon :name="e.icon" class="size-3.5 rb-evolves-icon" />
            <b>{{ e.evo }}</b>
          </span>
        </div>
      </article>
    </div>

    <!-- abilities -->
    <div v-else-if="section === 'abilities'" :key="section">
      <div class="rb-ability-intro">
        <div class="rb-ability-keys">
          <span v-for="(k, i) in ['Q', 'F', 'R']" :key="k" class="rb-ability-key">
            <kbd>{{ k }}</kbd>
            <small>{{ ['Start', 'Lv 8', 'Lv 18'][i] }}</small>
          </span>
        </div>
        <p>
          Drafted on level up. Cast with <kbd>Q</kbd> <kbd>F</kbd> <kbd>R</kbd> or tap.
        </p>
      </div>
      <div v-if="abilityRows.length" class="rb-codex-grid mt-3">
        <article
          v-for="(a, i) in shownAbilities"
          :key="a.id"
          class="rb-entry rb-ability"
          :style="{ '--ec': a.hexColor, 'animationDelay': `${i * 0.04}s` }"
          @mouseenter="emit('hover')"
        >
          <div class="rb-entry-top">
            <span class="rb-glyph hex"><UIcon :name="a.icon" class="size-6" /></span>
            <div class="min-w-0 flex-1">
              <h3 class="rb-entry-name">{{ a.name }}</h3>
              <div class="rb-chips">
                <span v-if="a.cooldown !== null" class="rb-chip"><small>CD</small>{{ Math.round(a.cooldown * 10) / 10 }}s</span>
                <span v-if="a.maxLevel !== null" class="rb-chip"><small>Max</small>Lv {{ a.maxLevel }}</span>
              </div>
            </div>
            <kbd v-if="a.key" class="rb-ability-badge">{{ a.key }}</kbd>
          </div>
          <p v-if="a.description" class="rb-entry-text">{{ a.description }}</p>
          <p v-if="a.mastery" class="rb-entry-text rb-mastery"><UIcon name="i-lucide-crown" class="size-3.5 shrink-0" />{{ a.mastery }}</p>
        </article>
      </div>
      <div v-else class="rb-codex-soon">
        <UIcon name="i-lucide-sparkles" class="size-6" />
        <p>Find abilities on level-up cards and in chests.</p>
      </div>
    </div>

    <!-- enemies -->
    <div v-else-if="section === 'enemies'" :key="section">
      <div class="rb-codex-grid">
        <article
          v-for="(e, i) in shownEnemies"
          :key="e.def.id"
          class="rb-entry rb-foe"
          :style="{ '--ec': e.glow, 'animationDelay': `${i * 0.025}s` }"
          @mouseenter="emit('hover')"
        >
          <div class="rb-foe-art">
            <img v-if="thumbOf(e.def.id)" :src="thumbOf(e.def.id)!" :alt="e.def.name" class="rb-foe-img" draggable="false">
            <UIcon v-else-if="thumbOf(e.def.id) === null" name="i-lucide-skull" class="size-7 opacity-50" />
            <span v-else class="rb-shimmer" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="rb-entry-name">{{ e.def.name }}</h3>
              <span class="rb-tag">{{ e.lore.tag }}</span>
            </div>
            <p class="rb-entry-text">{{ e.lore.text }}</p>
            <div class="rb-chips">
              <span v-for="ch in e.chips" :key="ch.label" class="rb-chip"><small>{{ ch.label }}</small>{{ ch.value }}</span>
            </div>
          </div>
        </article>
      </div>
      <div v-if="affixRows.length && !needle" class="rb-affixes">
        <h3 class="rb-affixes-title"><UIcon name="i-lucide-badge-alert" class="size-4" /> Elite affixes</h3>
        <p class="rb-entry-text">1 affix from 2:00, 2 from 7:00, 3 from 12:00.</p>
        <div class="rb-affix-list">
          <span v-for="a in affixRows" :key="a.id" class="rb-affix" :style="{ '--ac': a.color }">{{ a.name }}</span>
        </div>
      </div>
    </div>

    <!-- bosses -->
    <div v-else :key="section" class="rb-bosses">
      <article
        v-for="(b, i) in shownBosses"
        :key="b.def.id"
        class="rb-entry rb-boss"
        :class="{ final: b.def.final }"
        :style="{ '--ec': b.glow, 'animationDelay': `${i * 0.06}s` }"
        @mouseenter="emit('hover')"
      >
        <div class="rb-boss-art">
          <div class="rb-boss-halo" />
          <img v-if="thumbOf(b.def.id)" :src="thumbOf(b.def.id)!" :alt="b.def.name" class="rb-foe-img" draggable="false">
          <UIcon v-else-if="thumbOf(b.def.id) === null" name="i-lucide-crown" class="size-10 opacity-50" />
          <span v-else class="rb-shimmer" />
          <span v-if="b.time" class="rb-boss-time"><UIcon name="i-lucide-hourglass" class="size-3" /> {{ b.time }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="rb-entry-kicker">{{ b.def.final ? 'Final boss' : `Boss ${i + 1}` }}<template v-if="b.lore"> · {{ b.lore.title }}</template></div>
          <h3 class="rb-boss-name">{{ b.def.name }}</h3>
          <p v-if="b.lore" class="rb-entry-text">{{ b.lore.text }}</p>
          <div class="rb-chips">
            <span v-for="ch in b.chips" :key="ch.label" class="rb-chip"><small>{{ ch.label }}</small>{{ ch.value }}</span>
          </div>
          <div v-if="b.parts.length" class="rb-parts">
            <span v-for="p in b.parts" :key="p.id" class="rb-part">
              <span class="rb-part-art">
                <img v-if="thumbOf(p.id)" :src="thumbOf(p.id)!" :alt="p.name" draggable="false">
                <span v-else class="rb-shimmer" />
              </span>
              {{ p.name }}
              <small>{{ formatNumber(p.hp) }} HP</small>
            </span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.rb-codex {
  border-radius: 22px;
  padding: 18px;
  background: linear-gradient(180deg, rgba(20, 14, 38, 0.88), rgba(10, 7, 20, 0.88));
  box-shadow: inset 0 0 0 1px rgba(160, 130, 255, 0.14);
  min-width: 0;
}
.rb-codex-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.rb-h2 {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
}
.rb-codex-sub {
  margin-top: 6px;
  font-size: 12.5px;
  color: rgba(220, 212, 240, 0.6);
}
.rb-codex-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 280px);
  padding: 8px 10px;
  border-radius: 12px;
  color: rgba(240, 236, 250, 0.9);
  background: rgba(6, 4, 14, 0.7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  transition: box-shadow 0.2s ease;
}
.rb-codex-search:focus-within {
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.55), 0 0 18px -6px #8ef6ff;
}
.rb-codex-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: #fff;
}
.rb-codex-search input::placeholder {
  color: rgba(220, 212, 240, 0.4);
}
.rb-codex-search input::-webkit-search-cancel-button {
  display: none;
}
.rb-codex-clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.rb-codex-pills {
  display: flex;
  gap: 6px;
  margin: 16px 0 14px;
  padding-bottom: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.rb-codex-pills::-webkit-scrollbar {
  display: none;
}
.rb-codex-pill {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.65);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}
.rb-codex-pill:hover {
  color: #fff;
}
.rb-codex-pill.active {
  color: #0b0716;
  background: linear-gradient(135deg, #fff, #8ef6ff 60%, #b28cff);
  box-shadow: 0 0 18px -4px #8ef6ff;
}
.rb-codex-count {
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  letter-spacing: 0.04em;
  background: rgba(255, 255, 255, 0.08);
}
.rb-codex-pill.active .rb-codex-count {
  background: rgba(11, 7, 22, 0.18);
}
.rb-codex-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 26px 0;
  font-size: 13px;
  color: rgba(220, 212, 240, 0.55);
}

.rb-codex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
}
.rb-codex-grid.wide {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
}

/* entry */
.rb-entry {
  --ec: #b28cff;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border-radius: 16px;
  background:
    radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, var(--ec) 12%, transparent), transparent 60%),
    rgba(14, 10, 28, 0.9);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.3), box-shadow 0.25s ease;
  animation: rb-entry-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
  outline: none;
}
.rb-entry:hover,
.rb-entry:focus-visible {
  transform: translateY(-3px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 50%, transparent), 0 16px 34px -20px color-mix(in srgb, var(--ec) 80%, transparent);
}
@keyframes rb-entry-in {
  from { opacity: 0; transform: translateY(12px); }
}
.rb-entry-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.rb-glyph {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  color: var(--ec);
  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--ec) 30%, #0a0614), #0a0614 85%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 45%, transparent), 0 0 18px -6px var(--ec);
}
.rb-glyph :deep(svg),
.rb-glyph .iconify {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ec) 80%, transparent));
}
.rb-glyph.hex {
  border-radius: 0;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.rb-entry-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ec) 75%, #fff);
}
.rb-entry-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.2;
  color: #fff;
}
.rb-mastery {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  color: color-mix(in srgb, var(--ec, #ffc54d) 60%, #fff);
}
.rb-entry-text {
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(220, 212, 240, 0.72);
}
.rb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.rb-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 7px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}
.rb-chip small {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: rgba(220, 212, 240, 0.5);
}
.rb-tag {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ec) 70%, #fff);
  background: color-mix(in srgb, var(--ec) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 35%, transparent);
}

/* classes */
.rb-class-entry {
  flex-direction: row;
  align-items: flex-start;
  gap: 14px;
}
.rb-class-art {
  position: relative;
  flex-shrink: 0;
  width: 96px;
  height: 96px;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ec) 45%, transparent), 0 0 24px -8px var(--ec);
}
.rb-entry-lock {
  position: absolute;
  left: 50%;
  bottom: 6px;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(6, 4, 14, 0.85);
}
.rb-class-entry.locked .rb-entry-kicker {
  color: rgba(220, 212, 240, 0.5);
}
.rb-class-stats {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}
.rb-class-stat {
  display: grid;
  grid-template-columns: 28px 1fr 34px;
  align-items: center;
  gap: 8px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  color: rgba(220, 212, 240, 0.55);
}
.rb-class-stat b {
  text-align: right;
  color: rgba(255, 255, 255, 0.85);
}
.rb-class-track {
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.07);
}
.rb-class-track div {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--ec) 45%, transparent), var(--ec));
}
.rb-class-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.rb-class-facts .full {
  grid-column: 1 / -1;
}
.rb-class-facts dt {
  margin-bottom: 3px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.5);
}
.rb-class-facts dd {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(240, 236, 250, 0.9);
}
.rb-class-facts .rb-class-ult {
  margin-top: -4px;
  color: rgba(220, 212, 240, 0.65);
}
@media (max-width: 480px) {
  .rb-class-entry { flex-direction: column; }
  .rb-class-art { width: 100%; height: auto; aspect-ratio: 16 / 9; }
}

/* weapons */
.rb-weapon {
  cursor: pointer;
}
.rb-class-badge {
  --bc: #fff;
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--bc);
  background: color-mix(in srgb, var(--bc) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bc) 40%, transparent);
}
.rb-recipe {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 11px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03), color-mix(in srgb, var(--evc) 14%, transparent));
  box-shadow: inset 0 0 0 1px rgba(255, 138, 43, 0.18);
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  color: rgba(240, 236, 250, 0.85);
}
.rb-recipe-part {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.rb-recipe-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(6, 4, 14, 0.8);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.rb-recipe-arrow {
  color: #ff8a2b;
  filter: drop-shadow(0 0 4px #ff8a2b);
}
.rb-recipe-part.evo {
  flex: 1;
  color: #ffe08a;
  text-shadow: 0 0 10px rgba(255, 138, 43, 0.7);
}
.rb-recipe-part.evo .rb-recipe-icon {
  color: #2a1000;
  background: linear-gradient(160deg, #ffe08a, #ff8a2b 60%, #d0341a);
  box-shadow: 0 0 12px rgba(255, 138, 43, 0.75);
  animation: rb-evo-glow 1.6s ease-in-out infinite alternate;
}
@keyframes rb-evo-glow {
  to { box-shadow: 0 0 20px rgba(255, 160, 60, 1); }
}
.rb-weapon-more {
  display: grid;
  gap: 10px;
  cursor: default;
  animation: rb-entry-in 0.3s ease-out;
}
.rb-evo {
  position: relative;
  overflow: hidden;
  padding: 12px;
  border-radius: 12px;
  background: linear-gradient(160deg, rgba(255, 138, 43, 0.22), rgba(120, 20, 10, 0.25) 60%, rgba(14, 10, 28, 0.9));
  box-shadow: inset 0 0 0 1px rgba(255, 160, 60, 0.45), 0 0 24px -10px #ff8a2b;
}
.rb-evo-flames {
  position: absolute;
  inset: auto -10% -30% -10%;
  height: 80%;
  background:
    radial-gradient(30% 60% at 20% 100%, rgba(255, 120, 30, 0.45), transparent 70%),
    radial-gradient(25% 70% at 55% 100%, rgba(255, 200, 80, 0.35), transparent 70%),
    radial-gradient(30% 55% at 85% 100%, rgba(255, 70, 30, 0.4), transparent 70%);
  filter: blur(6px);
  animation: rb-flames 1.4s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes rb-flames {
  to { transform: translateY(-8%) scaleY(1.12); opacity: 0.75; }
}
.rb-evo-kicker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ffb35c;
}
.rb-evo-name {
  position: relative;
  margin-top: 4px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 0 14px #ff8a2b, 0 0 28px rgba(255, 60, 20, 0.6);
}
.rb-evo-text {
  position: relative;
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(255, 236, 214, 0.88);
}
.rb-path {
  display: grid;
  gap: 4px;
}
.rb-path li {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 8px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(220, 212, 240, 0.75);
}
.rb-path b {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  color: var(--ec);
}
.rb-more-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.45);
  transition: color 0.2s ease;
}
.rb-weapon:hover .rb-more-hint {
  color: #fff;
}

/* passives */
.rb-pips {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 6px;
}
.rb-pips i {
  width: 10px;
  height: 4px;
  border-radius: 2px;
  background: var(--ec);
  box-shadow: 0 0 5px var(--ec);
  opacity: 0.8;
}
.rb-pips span {
  margin-left: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.5);
}
.rb-passive-lines {
  display: grid;
  gap: 4px;
}
.rb-passive-lines div {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.35;
}
.rb-passive-lines dt {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.7;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.5);
}
.rb-passive-lines dd {
  color: rgba(240, 236, 250, 0.9);
}
.rb-evolves {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.rb-evolves-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ff9b3d;
}
.rb-evolves-item {
  --evc: #ffc54d;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  color: rgba(240, 236, 250, 0.8);
  background: rgba(255, 138, 43, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 138, 43, 0.25);
}
.rb-evolves-item b {
  color: #ffe08a;
}
.rb-evolves-icon {
  color: var(--evc);
}

/* abilities */
.rb-ability-intro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(120deg, rgba(142, 246, 255, 0.1), rgba(14, 10, 28, 0.9) 60%);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.2);
}
.rb-ability-intro p {
  flex: 1;
  min-width: min(100%, 240px);
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(220, 212, 240, 0.75);
}
.rb-ability-intro p kbd,
.rb-ability-key kbd,
.rb-ability-badge {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}
.rb-ability-keys {
  display: flex;
  gap: 8px;
}
.rb-ability-key {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.rb-ability-key kbd {
  width: 38px;
  height: 38px;
  font-size: 15px;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  border-radius: 0;
  background: linear-gradient(160deg, rgba(142, 246, 255, 0.35), rgba(107, 92, 255, 0.25));
}
.rb-ability-key small {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-ability-badge {
  flex-shrink: 0;
  color: var(--ec);
}
.rb-codex-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 30px 16px;
  border-radius: 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(220, 212, 240, 0.6);
  background: rgba(14, 10, 28, 0.6);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}
.rb-codex-soon .iconify,
.rb-codex-soon :deep(svg) {
  color: #8ef6ff;
  animation: rb-soon 2.4s ease-in-out infinite;
}
@keyframes rb-soon {
  50% { transform: scale(1.15) rotate(12deg); opacity: 0.6; }
}

/* enemies */
.rb-foe {
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}
.rb-foe-art {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 14px;
  overflow: hidden;
  color: var(--ec);
  background: radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--ec) 26%, transparent), rgba(6, 4, 14, 0.9) 70%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 30%, transparent);
}
.rb-foe-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
  animation: rb-thumb-in 0.4s ease-out;
  transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.4);
}
.rb-entry:hover .rb-foe-img {
  transform: scale(1.12);
}
@keyframes rb-thumb-in {
  from { opacity: 0; transform: scale(0.7); }
}
.rb-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.08) 50%, transparent 70%);
  background-size: 200% 100%;
  animation: rb-shimmer 1.2s linear infinite;
}
@keyframes rb-shimmer {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}
.rb-affixes {
  margin-top: 14px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(14, 10, 28, 0.85);
  box-shadow: inset 0 0 0 1px rgba(255, 197, 77, 0.2);
}
.rb-affixes-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 800;
  color: #ffd56a;
}
.rb-affix-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.rb-affix {
  --ac: #fff;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--ac);
  background: color-mix(in srgb, var(--ac) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ac) 40%, transparent), 0 0 12px -4px var(--ac);
}

/* bosses */
.rb-bosses {
  display: grid;
  gap: 12px;
}
.rb-boss {
  flex-direction: row;
  align-items: center;
  gap: 18px;
  padding: 16px;
}
.rb-boss.final {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 45%, transparent), 0 0 40px -16px var(--ec);
}
.rb-boss-art {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 140px;
  height: 140px;
  border-radius: 18px;
  overflow: hidden;
  color: var(--ec);
  background: radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--ec) 22%, transparent), rgba(6, 4, 14, 0.95) 72%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 35%, transparent);
}
.rb-boss-halo {
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--ec) 40%, transparent), transparent 40%, color-mix(in srgb, var(--ec) 25%, transparent), transparent 80%);
  mask: radial-gradient(circle, transparent 52%, #000 56%, #000 66%, transparent 72%);
  animation: rb-halo-spin 9s linear infinite;
}
@keyframes rb-halo-spin {
  to { transform: rotate(360deg); }
}
.rb-boss-art .rb-foe-img {
  position: relative;
}
.rb-boss-time {
  position: absolute;
  left: 8px;
  top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: rgba(6, 4, 14, 0.85);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ec) 40%, transparent);
}
.rb-boss-name {
  margin-top: 4px;
  margin-bottom: 6px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(18px, 3vw, 24px);
  font-weight: 900;
  line-height: 1.05;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 0 22px color-mix(in srgb, var(--ec) 70%, transparent);
}
.rb-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.rb-part {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 3px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(240, 236, 250, 0.85);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.rb-part small {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  color: rgba(220, 212, 240, 0.5);
}
.rb-part-art {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(6, 4, 14, 0.9);
}
.rb-part-art img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
@media (max-width: 560px) {
  .rb-codex { padding: 14px; }
  .rb-boss { flex-direction: column; align-items: stretch; text-align: left; }
  .rb-boss-art { width: 100%; height: 150px; }
  .rb-foe-art { width: 60px; height: 60px; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-codex * { animation: none !important; transition: none !important; }
}
</style>
