// Control bar colour sets, one per slot. Layout and behaviour are shared
// (SlotControlBar); only these values differ.
import type { SlotTheme } from '~/utils/slots/slot-controls'

/** Xeno Slot: semantic cockpit controls around the illustrated space stage. */
export const XENO_BAR_THEME: SlotTheme = {
    accent: 'var(--ui-primary)',
    accentDeep: 'color-mix(in srgb, var(--ui-primary) 65%, var(--ui-bg))',
    onAccent: 'var(--ui-bg)',
    surface: 'var(--ui-bg-muted)',
    control: 'var(--ui-bg-elevated)',
    line: 'var(--ui-border-accented)',
    text: 'var(--ui-text-highlighted)',
    muted: 'var(--ui-text-muted)',
    win: 'var(--ui-primary)',
    buy: 'var(--ui-secondary)',
    onBuy: 'var(--ui-bg)',
    panel: 'var(--ui-bg)',
    font: '\'Orbitron\', system-ui, sans-serif',
    numberFont: '\'Chakra Petch\', system-ui, sans-serif'
}

/** Candy Madness: bubblegum pink on plum. */
export const CANDY_BAR_THEME: SlotTheme = {
    accent: '#ff4fa3',
    accentDeep: '#b0126a',
    onAccent: '#ffffff',
    surface: 'rgba(74, 11, 61, 0.62)',
    control: 'rgba(255, 255, 255, 0.14)',
    line: 'rgba(255, 214, 240, 0.25)',
    text: '#fff5fb',
    muted: '#f7b3d9',
    win: '#ffe066',
    buy: '#ffd23a',
    onBuy: '#5a0a3c',
    panel: '#4a0b3d',
    font: '\'Fredoka\', system-ui, sans-serif',
    numberFont: '\'Lilita One\', \'Fredoka\', system-ui, sans-serif'
}

/** Aether Gates: gilded gold on night sky. */
export const AETHER_BAR_THEME: SlotTheme = {
    accent: '#f5c542',
    accentDeep: '#9a5b06',
    onAccent: '#2a1700',
    surface: 'rgba(9, 15, 40, 0.66)',
    control: 'rgba(253, 230, 138, 0.1)',
    line: 'rgba(253, 230, 138, 0.24)',
    text: '#fef3c7',
    muted: '#b8b3a0',
    win: '#fde68a',
    buy: '#5eead4',
    onBuy: '#062a2a',
    panel: '#0f1838',
    font: '\'Cinzel\', Georgia, serif',
    numberFont: '\'Cinzel\', Georgia, serif'
}

/** Fire in the Hole: lamp flame on mine timber. */
export const FIRE_BAR_THEME: SlotTheme = {
    accent: '#ff8a2a',
    accentDeep: '#a33a0c',
    onAccent: '#2a1204',
    surface: 'rgba(28, 16, 8, 0.72)',
    control: 'rgba(255, 214, 170, 0.1)',
    line: 'rgba(255, 200, 140, 0.22)',
    text: '#fbe9d0',
    muted: '#c9a47e',
    win: '#ffc857',
    buy: '#e5484d',
    onBuy: '#fff1e6',
    panel: '#2a1a0f',
    font: 'system-ui, sans-serif',
    numberFont: '\'Alfa Slab One\', Georgia, serif'
}

/** Book of Shadows: occult gold on black velvet. */
export const SHADOWS_BAR_THEME: SlotTheme = {
    accent: '#e9b95c',
    accentDeep: '#7a4a12',
    onAccent: '#1d1206',
    surface: 'rgba(12, 7, 10, 0.72)',
    control: 'rgba(240, 195, 106, 0.1)',
    line: 'rgba(240, 195, 106, 0.24)',
    text: '#f5e6c8',
    muted: '#b39a74',
    win: '#f0c36a',
    buy: '#b3202a',
    onBuy: '#ffe7b0',
    panel: '#1a0f14',
    font: 'Cinzel, Georgia, serif',
    numberFont: 'Cinzel, Georgia, serif'
}

/** Spiñata: fiesta magenta on dusk purple. */
export const SPINATA_BAR_THEME: SlotTheme = {
    accent: '#ff2d6f',
    accentDeep: '#a30d45',
    onAccent: '#ffffff',
    surface: 'rgba(36, 10, 48, 0.66)',
    control: 'rgba(255, 255, 255, 0.13)',
    line: 'rgba(255, 220, 240, 0.22)',
    text: '#fff7ec',
    muted: '#e6b8d8',
    win: '#ffd23a',
    buy: '#ffb400',
    onBuy: '#3a1000',
    panel: '#2a0c3a',
    font: 'system-ui, -apple-system, \'Segoe UI\', sans-serif',
    numberFont: '\'Lilita One\', \'Arial Black\', sans-serif'
}

/** Trash Panda Heist: semantic controls around the illustrated night stage. */
export const TRASH_BAR_THEME: SlotTheme = {
    accent: 'var(--ui-primary)',
    accentDeep: 'color-mix(in srgb, var(--ui-primary) 65%, var(--ui-bg))',
    onAccent: 'var(--ui-bg)',
    surface: 'var(--ui-bg-muted)',
    control: 'var(--ui-bg-elevated)',
    line: 'var(--ui-border-accented)',
    text: 'var(--ui-text-highlighted)',
    muted: 'var(--ui-text-muted)',
    win: 'var(--ui-primary)',
    buy: 'var(--ui-primary)',
    onBuy: 'var(--ui-bg)',
    panel: 'var(--ui-bg)',
    font: '\'Fredoka\', system-ui, sans-serif',
    numberFont: '\'Lilita One\', \'Fredoka\', system-ui, sans-serif'
}

/**
 * Ember Portals: the bar docks into the carved stone cabinet, so its own
 * surface is transparent; gold trim, fire-orange actions, teal runes.
 */
export const EMBER_BAR_THEME: SlotTheme = {
    accent: '#ff8a1f',
    accentDeep: '#b8390c',
    onAccent: '#2a0a02',
    surface: 'transparent',
    control: 'rgba(12, 10, 36, 0.72)',
    line: 'rgba(232, 181, 74, 0.35)',
    text: '#f4ecd8',
    muted: '#b9a57a',
    win: '#ffc247',
    buy: '#ff8a1f',
    onBuy: '#2a0a02',
    panel: '#16123a',
    font: '\'Nunito\', system-ui, sans-serif',
    numberFont: '\'Cinzel\', Georgia, serif'
}
