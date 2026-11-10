// Polytown day/night preference.
//
// 'system' follows the OS colour scheme live, so a machine that switches to
// dark mode at sunset brings the night to town with it. 'sun' follows the
// real sun: the town's sunset starts as the real one does and night falls
// with real twilight. Where the player is comes from their time zone alone,
// so nothing asks for or stores a location. 'day' and 'night' pin it.
// Persisted per browser; defaults to 'system'.
import { solarElevation, townNightLevel, townPlaceFromTimeZone } from '~/utils/town/sun'

export type TownThemeMode = 'system' | 'sun' | 'day' | 'night'

const STORAGE_KEY = 'polytown-theme'
const MODES: TownThemeMode[] = ['system', 'sun', 'day', 'night']
/** How often the real sun is looked at again. Twilight lasts over half an hour, so a minute is smooth. */
const SUN_TICK_MS = 60_000

const mode = ref<TownThemeMode>('system')
const systemDark = ref(false)
const now = ref(Date.now())
/** Where the sun is followed from: the player's time zone's city, or a guess from its offset. */
let place: { lat: number, lon: number } | null = null
let hydrated = false

function placeFromTimeZone() {
    let zone: string | undefined
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
        // No Intl time zone: guessed from the offset alone.
    }
    return townPlaceFromTimeZone(zone)
}

function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw && (MODES as string[]).includes(raw)) mode.value = raw as TownThemeMode
    } catch {
        // Private mode / blocked storage: stay on 'system'.
    }
    try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        systemDark.value = mq.matches
        mq.addEventListener('change', e => { systemDark.value = e.matches })
    } catch {
        // No matchMedia: system means day.
    }
    place = placeFromTimeZone()
    setInterval(() => { now.value = Date.now() }, SUN_TICK_MS)
}

export function useTownTheme() {
    hydrate()

    /** How dark the town should be: 0 day, 1 night, in between at dusk and dawn. */
    const nightLevel = computed(() => {
        switch (mode.value) {
            case 'day': return 0
            case 'night': return 1
            case 'sun': {
                return place ? townNightLevel(solarElevation(new Date(now.value), place.lat, place.lon)) : 0
            }
            default: return systemDark.value ? 1 : 0
        }
    })

    function setMode(value: TownThemeMode) {
        mode.value = value
        now.value = Date.now()
        try {
            localStorage.setItem(STORAGE_KEY, value)
        } catch {
            // Ignore quota / privacy errors.
        }
    }

    /** System → real sun → day → night → system. */
    function cycle() {
        setMode(MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!)
    }

    return { mode, nightLevel, setMode, cycle }
}
