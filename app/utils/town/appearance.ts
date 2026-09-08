// Presentation only: five architectural stages, with extra details every level.
// Roads deliberately keep their connected street artwork; they cannot upgrade.
export function townVisualLevel(level = 1): number {
    return Number.isFinite(level) ? Math.max(1, Math.min(20, Math.floor(level))) : 1
}

export function townVisualStage(level = 1): number {
    return Math.floor((townVisualLevel(level) - 1) / 4)
}

export function townBuildingPortrait(id: string, level = 1): string {
    const visualLevel = townVisualLevel(level)
    return `/town/buildings/${id}${visualLevel > 1 && id !== 'road' ? `-${visualLevel}` : ''}.png`
}
