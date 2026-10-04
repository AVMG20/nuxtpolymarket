/**
 * The scenes the Hero Quest stage switches between. Battle is the ground: it has no menu item and
 * shows whenever no other scene is open. Each scene keeps its own route, so links and reloads land
 * on it, and the stage reads which one is open off the path.
 */
export const HQ_MENU_SCENES = ['gacha', 'collections', 'loadouts', 'classes', 'prestige', 'speed', 'settings'] as const
export type HqMenuScene = typeof HQ_MENU_SCENES[number]
export type HqScene = 'battle' | HqMenuScene

export const HQ_SCENE_LABELS: Readonly<Record<HqScene, string>> = {
    battle: 'Battle',
    gacha: 'Gacha',
    collections: 'Collections',
    loadouts: 'Loadouts',
    classes: 'Classes',
    prestige: 'Prestige',
    speed: 'Battle Speed',
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
