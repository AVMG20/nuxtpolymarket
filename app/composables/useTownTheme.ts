// Polytown day/night preference.
//
// 'system' follows the OS colour scheme live, so a machine that switches to
// dark mode at sunset brings the night to town with it. 'day' and 'night'
// pin it. Persisted per browser; defaults to 'system'.

export type TownThemeMode = 'system' | 'day' | 'night'

const STORAGE_KEY = 'polytown-theme'
const MODES: TownThemeMode[] = ['system', 'day', 'night']

const mode = ref<TownThemeMode>('system')
const systemDark = ref(false)
let hydrated = false

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
}

export function useTownTheme() {
    hydrate()

    const night = computed(() => mode.value === 'night' || (mode.value === 'system' && systemDark.value))

    function setMode(value: TownThemeMode) {
        mode.value = value
        try {
            localStorage.setItem(STORAGE_KEY, value)
        } catch {
            // Ignore quota / privacy errors.
        }
    }

    /** System → day → night → system. */
    function cycle() {
        setMode(MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!)
    }

    return { mode, night, setMode, cycle }
}
