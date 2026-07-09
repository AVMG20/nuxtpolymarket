// HackOps redesign — shared shell + interaction stubs for the standalone
// mockups. This is prototype glue, not production code: it exists so the
// mockups are click-through-able without a real backend. None of this
// ships as-is — see PLAN.md §8 for the real composable design (useAudio).

const HACKOPS_TABS = [
  { id: 'ops', label: 'Ops', href: 'ops-select.html', ic: '&#9635;' },
  { id: 'market', label: 'Black Market', href: 'black-market.html', ic: '&#9670;' },
  { id: 'agents', label: 'Agents', href: 'agents-roster.html', ic: '&#9679;' },
  { id: 'loadout', label: 'Loadout', href: 'loadout.html', ic: '&#9632;' },
  { id: 'items', label: 'Items', href: 'items.html', ic: '&#9633;' },
  { id: 'history', label: 'History', href: 'history.html', ic: '&#8801;' },
  { id: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html', ic: '&#9650;' },
]

const MOCK_STATE = {
  callsign: 'HANDLER-07',
  power: 1840,
  agentsActive: 4,
  agentsCap: 5,
  cash: 812450,
  gems: 236,
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K'
  return String(n)
}

// Minimal inline SVGs, deliberately drawn in Lucide's own stroke style
// (24x24 viewbox, 2px stroke, round caps/joins, currentColor) so swapping
// these for real `i-lucide-zap` / `i-lucide-gem` / `i-lucide-dollar-sign`
// in the real Nuxt Icon-based app later is a drop-in, not a redesign.
const ICON_SVG = {
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  // Slot-type icons — real app uses `i-lucide-usb` / `i-lucide-terminal` /
  // `i-lucide-cpu` per the user's pasted markup from the actual project.
  usb: '<path d="M6 3v11a3 3 0 0 0 3 3h1"/><path d="M18 3v11a3 3 0 0 1-3 3h-1"/><path d="M10 17v4"/><path d="M14 17v4"/><circle cx="6" cy="3" r="1.5"/><rect x="16.5" y="1.5" width="3" height="3" rx="0.5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M20 9h2"/><path d="M20 15h2"/><path d="M2 9h2"/><path d="M2 15h2"/>',
}
function iconSvg(name, size) {
  size = size || 16
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">${ICON_SVG[name]}</svg>`
}

function renderShell(activeId) {
  const mount = document.getElementById('app-shell')
  if (!mount) return
  const tabs = HACKOPS_TABS.map(t => `
    <a class="tab ${t.id === activeId ? 'active' : ''}" href="${t.href}">
      <span class="ic">${t.ic}</span>${t.label}
    </a>`).join('')

  mount.innerHTML = `
    <div class="statbar frame frame-tight" style="margin:14px 16px 0; justify-content:space-between;">
      <div class="row gap-20 wrap">
        <div class="stat"><span class="dot"></span>${MOCK_STATE.callsign}</div>
        <div class="stat stat-hero text-accent">${iconSvg('zap')}<b>${fmtNum(MOCK_STATE.power)}</b></div>
        <div class="stat"><span class="dot"></span>SQUAD <b>${MOCK_STATE.agentsActive}/${MOCK_STATE.agentsCap}</b></div>
      </div>
      <div class="row gap-20 wrap">
        <div class="stat stat-hero text-cash">${iconSvg('dollar')}<b>$${fmtNum(MOCK_STATE.cash)}</b></div>
        <div class="stat stat-hero text-gems">${iconSvg('gem')}<b>${fmtNum(MOCK_STATE.gems)}</b></div>
        <div class="theme-pop-wrap">
          <button class="btn btn-sm" id="theme-btn" onclick="toggleThemePop(event)">&#9679; Theme</button>
        </div>
      </div>
    </div>
    <nav class="tabbar" style="margin:14px 16px 0;">${tabs}</nav>
  `
  initThemeSwitcher()
}

// ═══════════════════════════════════════════════════════════════════════
// Live theme switcher — reproduces the real app's Primary/Secondary/
// Neutral swatch popover (app/layouts/default.vue) so every mockup can be
// checked against any of the 17+17+5 combinations a real user might pick.
// Only --accent/--accent-2/neutral-derived grays move; rarity, cash, gems,
// xp stay fixed on purpose (see PLAN.md §4) — this is the thing to watch
// when clicking through swatches: rarity colors must never shift.
// ═══════════════════════════════════════════════════════════════════════
const THEME_PALETTE = {
  hue: [
    ['red', '239,68,68'], ['orange', '249,115,22'], ['amber', '245,158,11'], ['yellow', '234,179,8'],
    ['lime', '132,204,22'], ['green', '34,197,94'], ['emerald', '16,185,129'], ['teal', '20,184,166'],
    ['cyan', '6,182,212'], ['sky', '14,165,233'], ['blue', '59,130,246'], ['indigo', '99,102,241'],
    ['violet', '139,92,246'], ['purple', '168,85,247'], ['fuchsia', '217,70,239'], ['pink', '236,72,153'],
    ['rose', '244,63,94'],
  ],
  neutral: [
    ['slate', '100,116,139'], ['gray', '107,114,128'], ['zinc', '113,113,122'],
    ['neutral', '115,115,115'], ['stone', '120,113,108'],
  ],
}
const THEME_DEFAULT = { primary: 'green', secondary: 'blue', neutral: 'zinc' }
const THEME_STORAGE_KEY = 'hackops-mock-theme'

function rgbOf(list, name) { return list.find(x => x[0] === name)[1].split(',').map(Number) }
function mixRgb(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)) }
function rgbStr(a) { return `rgb(${a[0]}, ${a[1]}, ${a[2]})` }
function rgbaStr(a, alpha) { return `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${alpha})` }

function loadTheme() {
  try { return { ...THEME_DEFAULT, ...JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)) } }
  catch { return { ...THEME_DEFAULT } }
}

function applyTheme(theme) {
  const root = document.documentElement.style
  const p = rgbOf(THEME_PALETTE.hue, theme.primary)
  const s = rgbOf(THEME_PALETTE.hue, theme.secondary)
  const n = rgbOf(THEME_PALETTE.neutral, theme.neutral)
  const black = [5, 7, 10]
  root.setProperty('--accent', rgbStr(p))
  root.setProperty('--accent-dim', rgbaStr(p, 0.14))
  root.setProperty('--accent-2', rgbStr(s))
  root.setProperty('--bg', rgbStr(mixRgb(black, n, 0.05)))
  root.setProperty('--bg-elevated', rgbStr(mixRgb(black, n, 0.08)))
  root.setProperty('--panel', rgbStr(mixRgb(black, n, 0.11)))
  root.setProperty('--panel-2', rgbStr(mixRgb(black, n, 0.15)))
  root.setProperty('--border', rgbaStr(n, 0.16))
  root.setProperty('--border-strong', rgbaStr(n, 0.30))
  root.setProperty('--text-dim', rgbStr(mixRgb(n, [255, 255, 255], 0.18)))
  root.setProperty('--text-muted', rgbStr(mixRgb(n, [255, 255, 255], 0.48)))
}

// The popover is appended directly to <body> (position: fixed, positioned
// off the trigger button's rect) rather than nested inside the statbar's
// corner-cut `.frame`. `clip-path` on an ancestor clips ALL descendant
// painting, including absolutely-positioned children that visually escape
// the box — so nesting it inside `.frame` silently cropped it off-screen.
function getOrCreateThemePop() {
  let pop = document.getElementById('theme-pop')
  if (!pop) {
    pop = document.createElement('div')
    pop.id = 'theme-pop'
    pop.className = 'theme-pop'
    document.body.appendChild(pop)
  }
  return pop
}

function initThemeSwitcher() {
  const theme = loadTheme()
  applyTheme(theme)
  renderThemePop()
}

function renderThemePop() {
  const theme = loadTheme()
  const pop = getOrCreateThemePop()

  const group = (label, key, list) => `
    <div class="theme-pop-group">
      <div class="theme-pop-label">${label}</div>
      <div class="theme-pop-swatches">
        ${list.map(([name, rgb]) => `
          <button class="swatch ${theme[key] === name ? 'selected' : ''}"
            title="${name}" style="background: rgb(${rgb})"
            onclick="setThemeVal('${key}','${name}')"></button>
        `).join('')}
      </div>
    </div>`

  pop.innerHTML =
    group('Primary', 'primary', THEME_PALETTE.hue) +
    group('Secondary', 'secondary', THEME_PALETTE.hue) +
    group('Neutral', 'neutral', THEME_PALETTE.neutral)
}

function setThemeVal(key, name) {
  const theme = loadTheme()
  theme[key] = name
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  applyTheme(theme)
  renderThemePop()
}

function toggleThemePop(e) {
  e.stopPropagation()
  const pop = getOrCreateThemePop()
  const btn = document.getElementById('theme-btn')
  const wasOpen = pop.classList.contains('open')
  pop.classList.remove('open')
  if (wasOpen) return
  const r = btn.getBoundingClientRect()
  pop.style.position = 'fixed'
  pop.style.top = (r.bottom + 8) + 'px'
  pop.style.right = (window.innerWidth - r.right) + 'px'
  pop.style.left = 'auto'
  pop.classList.add('open')
}
document.addEventListener('click', (e) => {
  const pop = document.getElementById('theme-pop')
  const btn = document.getElementById('theme-btn')
  if (pop && !pop.contains(e.target) && e.target !== btn) pop.classList.remove('open')
})

// ═══════════════════════════════════════════════════════════════════════
// Real game formulas (mirrored from shared/utils/hack-config.ts) — used so
// the crafting bench mockup shows accurate gem costs, not placeholders.
// ═══════════════════════════════════════════════════════════════════════
function itemUpgradeCost(currentLevel) { return Math.round(Math.pow(1.13, currentLevel - 1)) }
function rerollCost(modCount, lockedCount) {
  const lockSurcharge = lockedCount <= 0 ? 0 : 2 * lockedCount - 1
  return modCount + lockSurcharge
}
const RARITY_MOD_COUNT = { ghost: 1, operative: 2, specialist: 3, elite: 4, phantom: 5 }
const RARITY_SORT_ORDER = ['ghost', 'operative', 'specialist', 'elite', 'phantom']
const MOD_RANGES = {
  loot_percent: { min: 1, max: 12, decimals: 1, unit: '%' },
  speed_percent: { min: 1, max: 12, decimals: 1, unit: '%' },
  xp_flat: { min: 1, max: 7, decimals: 0, unit: '' },
  gem_chance: { min: 0.1, max: 2, decimals: 2, unit: '%' },
  power_flat: { min: 4, max: 28, decimals: 0, unit: '' },
  item_chance: { min: 1, max: 10, decimals: 1, unit: '%' },
  gem_bonus: { min: 1, max: 3, decimals: 0, unit: '' },
}

// Agent classes — keyed by the real `AgentClass` values from
// hack-config.ts, not the display label, same convention as rarity ids
// elsewhere in these mockups. CLASS_PORTRAIT points at the 4 real class
// portraits sliced from assets/agents.png (see PLAN.md §12.4).
const CLASS_LABEL = {
  infiltrator: 'Infiltrator',
  cryptographer: 'Cryptographer',
  social_engineer: 'Social Engineer',
  bruteforce: 'Bruteforce',
}
const CLASS_PORTRAIT = {
  infiltrator: '../assets/agent/infiltrator.jpg',
  cryptographer: '../assets/agent/cryptographer.jpg',
  social_engineer: '../assets/agent/social-engineer.jpg',
  bruteforce: '../assets/agent/bruteforce.jpg',
}

// ═══════════════════════════════════════════════════════════════════════
// Item card renderer — shared between items.html and loadout.html so both
// screens show identical, redesigned cards: rarity/name/slot/level up top,
// base power-from-level called out on its own line, rolled traits shown
// as separate chips below (power, loot, speed, gem chance, xp, bonus gems).
// ═══════════════════════════════════════════════════════════════════════
// No emoji glyphs on trait/attribute chips — the user was explicit about
// this. `.mod-chip`'s own box (border + background, see shared.css)
// combined with the bold-value/muted-label text split is what marks
// these as attributes, not a decorative icon.
const MOD_META = {
  power_flat:    { label: 'Power',       unit: '' },
  loot_percent:  { label: 'Loot',        unit: '%' },
  speed_percent: { label: 'Speed',       unit: '%' },
  gem_chance:    { label: 'Gem Chance',  unit: '%' },
  xp_flat:       { label: 'XP',          unit: '' },
  item_chance:   { label: 'Item Find',   unit: '%' },
  gem_bonus:     { label: 'Bonus Gems',  unit: '' },
}
// Slot icons match the real app exactly (i-lucide-usb / i-lucide-terminal /
// i-lucide-cpu, rendered muted-gray, not tinted per slot type — see the
// user's pasted markup from the actual project). The box these sit in is
// still reserved, oversized, transparent space for a real item image/icon
// later (per the user's own "not sure what we'll do for images yet") —
// only the icon shape and color inside it changed here, not the box.
const SLOT_ICON = { tool: 'usb', software: 'terminal', hardware: 'cpu' }

function itemBasePower(level) { return level * 2 }
function itemTotalPower(item) {
  return itemBasePower(item.level) + item.mods.filter(m => m.type === 'power_flat').reduce((s, m) => s + m.value, 0)
}
function modChipHTML(mod) {
  const meta = MOD_META[mod.type]
  return `<span class="mod-chip"><b>${mod.value}${meta.unit}</b> <span class="mod-chip-label">${meta.label}</span></span>`
}
function itemCardHTML(item, opts = {}) {
  const size = opts.iconSize || 56
  const base = itemBasePower(item.level)
  return `
    <div class="row gap-14" style="align-items:flex-start;">
      <div class="ph-image" style="width:${size}px;height:${size}px; flex-shrink:0; border:none; background:transparent; color:var(--text-muted);">
        ${iconSvg(SLOT_ICON[item.slot], Math.round(size * 0.4))}
      </div>
      <div style="flex:1; min-width:0;">
        <div class="row between gap-8 wrap">
          <span class="card-title-lg text-rarity ${item.rarity}">${item.name}</span>
          <span class="badge badge-rarity ${item.rarity}">${item.slot} &middot; Lv ${item.level}</span>
        </div>
        <div class="card-sub-md" style="margin-top:3px;">Base power (from level) <b class="text-accent">+${base}</b> &middot; total <b class="text-accent">${itemTotalPower(item)} PWR</b></div>
        <div class="row gap-8 wrap" style="margin-top:9px;">${item.mods.map(modChipHTML).join('')}</div>
      </div>
    </div>
  `
}
function sortItems(items, mode) {
  const copy = [...items]
  if (mode === 'rarity') copy.sort((a, b) => RARITY_SORT_ORDER.indexOf(b.rarity) - RARITY_SORT_ORDER.indexOf(a.rarity))
  else if (mode === 'power') copy.sort((a, b) => itemTotalPower(b) - itemTotalPower(a))
  else if (mode === 'name') copy.sort((a, b) => a.name.localeCompare(b.name))
  return copy
}

// ── Deterministic mock inventory generator (~30 items, stable across
// reloads so sort/filter comparisons make sense while demoing) ─────────
const NAME_POOLS = {
  tool: ['USB Infiltrator', 'Signal Probe', 'Ghost Tap', 'Neural Sniffer', 'Quantum Spike', 'Black Tap', 'Phantom Drive', 'Cipher Key'],
  software: ['Zero Day Exploit', 'Polymorphic Shell', 'Ghost Suite', 'Darknet Relay', 'Neural Bypass', 'Stealth Daemon', 'AI Decryptor', 'Recursive Worm'],
  hardware: ['Black Ice Rig', 'Signal Scrambler', 'Neural Implant', 'Optical Jammer', 'Dark Server', 'Void Terminal', 'Quantum Node', 'Stealth Array'],
}
const RARITY_PREFIX = { ghost: '', operative: 'Improved ', specialist: 'Advanced ', elite: 'Military-Grade ', phantom: 'Mythic ' }

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genMockInventory(count, seed) {
  const rand = mulberry32(seed || 1337)
  const slots = ['tool', 'software', 'hardware']
  const rarityRoll = [
    ['ghost', 0.30], ['operative', 0.32], ['specialist', 0.22], ['elite', 0.12], ['phantom', 0.04],
  ]
  const modTypes = Object.keys(MOD_META)
  const items = []
  for (let i = 0; i < count; i++) {
    const slot = slots[Math.floor(rand() * slots.length)]
    let r = rand(), rarity = 'ghost', acc = 0
    for (const [name, w] of rarityRoll) { acc += w; if (r <= acc) { rarity = name; break } }
    const level = 1 + Math.floor(rand() * 20)
    const modCount = RARITY_MOD_COUNT[rarity]
    const pool = [...modTypes]
    const mods = []
    for (let m = 0; m < modCount && pool.length; m++) {
      const idx = Math.floor(rand() * pool.length)
      const type = pool.splice(idx, 1)[0]
      const range = MOD_RANGES[type]
      const val = range.min + rand() * (range.max - range.min)
      mods.push({ type, value: Math.round(val * Math.pow(10, range.decimals)) / Math.pow(10, range.decimals) })
    }
    const baseName = NAME_POOLS[slot][Math.floor(rand() * NAME_POOLS[slot].length)]
    items.push({ id: `item-${i}`, name: RARITY_PREFIX[rarity] + baseName, slot, rarity, level, mods })
  }
  return items
}

// ── Placeholder audio: simulates a VO clip playing + captions teletyping.
// Real implementation swaps this for useAudio().playVoice(name, {captionsRef}).
function initPlaceholderAudio() {
  document.querySelectorAll('.ph-audio[data-caption]').forEach(el => {
    el.addEventListener('click', () => playPlaceholderVoice(el))
  })
}

function playPlaceholderVoice(triggerEl) {
  if (triggerEl.classList.contains('playing')) return
  const captionTargetSel = triggerEl.getAttribute('data-caption-target')
  const captionText = triggerEl.getAttribute('data-caption') || ''
  const captionEl = captionTargetSel ? document.querySelector(captionTargetSel) : null
  triggerEl.classList.add('playing')
  const label = triggerEl.querySelector('.label')
  const originalLabel = label ? label.textContent : null
  if (label) label.textContent = 'PLAYING…'

  if (captionEl) {
    captionEl.innerHTML = '<span class="cursor"></span>'
    let i = 0
    const speed = 32
    const interval = setInterval(() => {
      i++
      captionEl.innerHTML = captionText.slice(0, i) + '<span class="cursor"></span>'
      if (i >= captionText.length) {
        clearInterval(interval)
        setTimeout(() => {
          triggerEl.classList.remove('playing')
          if (label && originalLabel) label.textContent = originalLabel
        }, 400)
      }
    }, speed)
  } else {
    setTimeout(() => {
      triggerEl.classList.remove('playing')
      if (label && originalLabel) label.textContent = originalLabel
    }, 2200)
  }
}

// ── Two-click arm-then-confirm pattern (Fire agent / Sell item / etc.)
// Matches the existing app's current interaction pattern — kept as-is.
function armConfirm(btn, onConfirm) {
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed', 'btn-armed')
    const original = btn.textContent
    btn.dataset.original = original
    btn.textContent = 'Confirm?'
    btn._disarmTimer = setTimeout(() => disarmConfirm(btn), 3000)
  } else {
    clearTimeout(btn._disarmTimer)
    disarmConfirm(btn)
    onConfirm && onConfirm()
  }
}
function disarmConfirm(btn) {
  btn.classList.remove('armed', 'btn-armed')
  if (btn.dataset.original) btn.textContent = btn.dataset.original
}

// ── Countdown rings/text for in-progress ops
function startCountdowns() {
  document.querySelectorAll('[data-countdown-end]').forEach(el => {
    const end = Number(el.getAttribute('data-countdown-end'))
    const textEl = el.querySelector('.countdown-text') || el
    const bar = el.querySelector('.bar > i')
    const totalMs = Number(el.getAttribute('data-countdown-total') || 0)
    const tick = () => {
      const remain = end - Date.now()
      if (remain <= 0) {
        textEl.textContent = 'READY TO COLLECT'
        if (bar) bar.style.width = '100%'
        return
      }
      const h = Math.floor(remain / 3_600_000)
      const m = Math.floor((remain % 3_600_000) / 60_000)
      const s = Math.floor((remain % 60_000) / 1000)
      textEl.textContent = `${h}h ${m}m ${s}s`
      if (bar && totalMs) bar.style.width = Math.min(100, 100 - (remain / totalMs) * 100) + '%'
      requestAnimationFrame(() => setTimeout(tick, 1000))
    }
    tick()
  })
}

// ── Minimal drag & drop for the loadout mockup
function initDragDrop(onDrop) {
  document.querySelectorAll('[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.itemId || '')
      el.classList.add('dragging')
    })
    el.addEventListener('dragend', () => el.classList.remove('dragging'))
  })
  document.querySelectorAll('.drop-target').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over') })
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
    el.addEventListener('drop', e => {
      e.preventDefault()
      el.classList.remove('drag-over')
      const itemId = e.dataTransfer.getData('text/plain')
      onDrop && onDrop(itemId, el)
    })
  })
}

// Apply immediately (not just on DOMContentLoaded) to avoid a flash of
// default-green before the user's saved swatch choice kicks in.
applyTheme(loadTheme())

document.addEventListener('DOMContentLoaded', () => {
  const sl = document.createElement('div'); sl.className = 'scanlines'; document.body.appendChild(sl)
  const nv = document.createElement('div'); nv.className = 'noise-vignette'; document.body.appendChild(nv)
  initPlaceholderAudio()
  startCountdowns()
})
