// Polytown motion preference — for players who get motion sick.
//
// One persisted flag. Off, the town looks and moves exactly as it always has.
// On, the scene trades every bit of motion it can spare: an orthographic view
// (no perspective swim while zooming), a camera that cuts instead of gliding,
// quarter-turn snaps instead of a free orbit, and no ambient drift — still
// water, no smoke, no traffic, no bobbing labels. Defaults to the OS's
// prefers-reduced-motion setting until the player picks for themselves.

const STORAGE_KEY = 'polytown-motion'

const reduced = ref(false)
let hydrated = false

function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
            reduced.value = raw === '1'
            return
        }
    } catch {
        // Private mode / blocked storage — fall through to the OS preference.
    }
    try {
        reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        // No matchMedia — leave the default.
    }
}

function persist() {
    if (!import.meta.client) return
    try {
        localStorage.setItem(STORAGE_KEY, reduced.value ? '1' : '0')
    } catch {
        // Ignore quota / privacy errors.
    }
}

export function useTownMotion() {
    hydrate()

    function setReduced(value: boolean) {
        reduced.value = value
        persist()
    }

    function toggle() {
        setReduced(!reduced.value)
    }

    return { reduced, setReduced, toggle }
}
