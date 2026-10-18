// Player settings for Dead Front, stored per browser.

export interface DfSettings {
    /** Mouse sensitivity multiplier, 0.2..3. */
    sensitivity: number
    /** Horizontal-ish field of view in degrees (vertical FOV derived), 70..100. */
    fov: number
    /** Master volume 0..1. */
    volume: number
    /** Effects volume 0..1 (everything but music), under the master volume. */
    sfxVolume: number
    /** Render quality: 'auto' detects the GPU; applies from the next match. */
    quality: DfQualitySetting
    invertY: boolean
}

export type DfQualitySetting = 'auto' | 'low' | 'high'

const KEY = 'dead-front:settings'

export const DF_DEFAULT_SETTINGS: DfSettings = { sensitivity: 1, fov: 85, volume: 0.8, sfxVolume: 1, quality: 'auto', invertY: false }

function clamp(v: unknown, lo: number, hi: number, d: number): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : d
    return Math.min(hi, Math.max(lo, n))
}

export function dfSanitizeSettings(raw: Partial<DfSettings> | null | undefined): DfSettings {
    const r = raw ?? {}
    return {
        sensitivity: clamp(r.sensitivity, 0.2, 3, DF_DEFAULT_SETTINGS.sensitivity),
        fov: clamp(r.fov, 70, 100, DF_DEFAULT_SETTINGS.fov),
        volume: clamp(r.volume, 0, 1, DF_DEFAULT_SETTINGS.volume),
        sfxVolume: clamp(r.sfxVolume, 0, 1, DF_DEFAULT_SETTINGS.sfxVolume),
        quality: r.quality === 'low' || r.quality === 'high' ? r.quality : 'auto',
        invertY: r.invertY === true
    }
}

export function dfLoadSettings(): DfSettings {
    try {
        const raw = localStorage.getItem(KEY)
        return dfSanitizeSettings(raw ? JSON.parse(raw) as Partial<DfSettings> : null)
    } catch {
        return { ...DF_DEFAULT_SETTINGS }
    }
}

export function dfSaveSettings(s: DfSettings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(dfSanitizeSettings(s)))
    } catch {
        // private mode / blocked storage: settings just don't persist
    }
}

/** Converts the setting (treated as horizontal FOV at 16:9) to a vertical FOV for the camera. */
export function dfVerticalFov(horizontalDeg: number, aspect = 16 / 9): number {
    const h = (horizontalDeg * Math.PI) / 180
    return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI
}
