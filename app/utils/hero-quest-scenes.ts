/**
 * The scenes the Hero Quest stage switches between. Battle is the ground: it has no menu item and
 * shows whenever no other scene is open. Each scene keeps its own route, so links and reloads land
 * on it, and the stage reads which one is open off the path.
 */
export const HQ_MENU_SCENES = ['gacha', 'collections', 'loadouts', 'raids', 'traits', 'arena', 'classes', 'tree', 'shop', 'calendar', 'settings'] as const
export type HqMenuScene = typeof HQ_MENU_SCENES[number]
export type HqScene = 'battle' | HqMenuScene

export const HQ_SCENE_LABELS: Readonly<Record<HqScene, string>> = {
    battle: 'Battle',
    gacha: 'Gacha',
    collections: 'Collections',
    loadouts: 'Loadouts',
    traits: 'Traits',
    raids: 'Raids',
    arena: 'Arena',
    classes: 'Classes',
    tree: 'Passive Tree',
    shop: 'Shop',
    calendar: 'Calendar',
    settings: 'Settings'
}

export function hqScenePath(scene: HqScene): string {
    return scene === 'battle' ? '/hero-quest' : `/hero-quest/${scene}`
}

/** The scene a path shows on the stage, or null for a page drawn without it (the wiki, the dev tools). */
export function hqSceneOf(path: string): HqScene | null {
    if (path === '/hero-quest' || path === '/hero-quest/') return 'battle'
    // a prefix match, so Collections' submenu pages stay on its scene
    return HQ_MENU_SCENES.find(s => path === hqScenePath(s) || path.startsWith(`${hqScenePath(s)}/`)) ?? null
}

/**
 * The Shop's tabs: the upgrades, and Battle Speed, which moved in from a menu button of its own
 * (the user's call, 2026-10-10) to make room. Each is a route, like the Collections tabs.
 */
export const HQ_SHOP_TABS = ['upgrades', 'speed'] as const
export type HqShopTab = typeof HQ_SHOP_TABS[number]

export const HQ_SHOP_TAB_LABELS: Readonly<Record<HqShopTab, string>> = {
    upgrades: 'Upgrades',
    speed: 'Battle Speed'
}

/** The Upgrades tab is the bare scene. */
export function hqShopTabPath(tab: HqShopTab): string {
    return tab === 'upgrades' ? hqScenePath('shop') : `${hqScenePath('shop')}/${tab}`
}

export function hqShopTabOf(path: string): HqShopTab {
    return path.startsWith(hqShopTabPath('speed')) ? 'speed' : 'upgrades'
}

/**
 * The Calendar's tabs: the login calendar, the main page, and the Milestones, which moved in from a
 * menu button of their own (the user's call, 2026-10-10) to make room for the Arena. Each is a route.
 */
export const HQ_CALENDAR_TABS = ['calendar', 'milestones'] as const
export type HqCalendarTab = typeof HQ_CALENDAR_TABS[number]

export const HQ_CALENDAR_TAB_LABELS: Readonly<Record<HqCalendarTab, string>> = {
    calendar: 'Calendar',
    milestones: 'Milestones'
}

/** The calendar tab is the bare scene. */
export function hqCalendarTabPath(tab: HqCalendarTab): string {
    return tab === 'calendar' ? hqScenePath('calendar') : `${hqScenePath('calendar')}/${tab}`
}

export function hqCalendarTabOf(path: string): HqCalendarTab {
    return path.startsWith(hqCalendarTabPath('milestones')) ? 'milestones' : 'calendar'
}

/** The Collections scene's tabs, one per gacha, in the order the scene draws them. */
export const HQ_COLLECTION_TABS = ['gear', 'champions', 'skills', 'artifacts'] as const
export type HqCollectionTab = typeof HQ_COLLECTION_TABS[number]

export const HQ_COLLECTION_TAB_LABELS: Readonly<Record<HqCollectionTab, string>> = {
    gear: 'Gear',
    champions: 'Champions',
    skills: 'Skills',
    artifacts: 'Artifacts'
}

export function hqCollectionTabPath(tab: HqCollectionTab): string {
    return `${hqScenePath('collections')}/${tab}`
}

/** The tab a Collections path is on; the first one for the bare scene, which redirects to it. */
export function hqCollectionTabOf(path: string): HqCollectionTab {
    return HQ_COLLECTION_TABS.find(t => path.startsWith(hqCollectionTabPath(t))) ?? HQ_COLLECTION_TABS[0]
}

/** The Arena scene's tabs, in the order the scene draws them. */
export const HQ_ARENA_TABS = ['fight', 'defense', 'shop', 'log', 'ranking'] as const
export type HqArenaTab = typeof HQ_ARENA_TABS[number]

export const HQ_ARENA_TAB_LABELS: Readonly<Record<HqArenaTab, string>> = {
    fight: 'Fight',
    defense: 'Defence',
    shop: 'Shop',
    log: 'Log',
    ranking: 'Ranking'
}
