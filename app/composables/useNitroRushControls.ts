import type { ComputedRef, Ref } from 'vue'
import { firstPad, PadPresses, readPad, type PadCommand } from '~/utils/nitro-rush/gamepad'
import { CONTROL_KEYS, isTyping, NITRO_KEYS } from '~/utils/nitro-rush/input'
import type { NitroRushEngine } from '~/utils/nitro-rush/engine'
import type { Phase } from '~/utils/nitro-rush/types'

interface Controls {
    engine: () => NitroRushEngine | null
    root: Ref<HTMLElement | null>
    phase: Ref<Phase>
    screen: Ref<'splash' | 'select' | 'builder'>
    paused: Ref<boolean>
    inSession: ComputedRef<boolean>
    /** Any input at all, which keeps the player from counting as away. */
    onActive: () => void
    /** The controller was used: its player isn't on the touch controls. */
    onPadUsed: () => void
    openSelect: () => void
    backToTitle: () => void
    play: () => void
    togglePause: (force?: boolean) => void
    nitro: () => void
}

/** The keyboard and the controller, both turned into the same game actions. */
export function useNitroRushControls(c: Controls) {
    /** A standard controller is connected, so the menus can name its buttons. */
    const hasPad = ref(false)
    /** The controller moved last, so the focused menu button has to show. */
    const padFocus = ref(false)
    const presses = new PadPresses()
    let raf = 0

    const onMenu = () => c.phase.value === 'attract'
    const inBuilder = () => onMenu() && c.screen.value === 'builder'
    /** The car is under the player, so the confirm button belongs to it. */
    const driving = () => c.inSession.value && c.phase.value !== 'finished' && !c.paused.value

    function advance() {
        if (onMenu() && c.screen.value === 'splash') c.openSelect()
        else c.play()
    }

    /** Between runs and on the menus, confirm moves things on. */
    const canAdvance = () => onMenu() || (c.phase.value === 'finished' && !c.paused.value)

    function onKeyDown(e: KeyboardEvent) {
        c.onActive()
        padFocus.value = false
        if (isTyping(e) || inBuilder()) return
        if (e.code === 'Escape' && onMenu() && c.screen.value === 'select') {
            c.backToTitle()
            return
        }
        if (e.code === 'Escape' || e.code === 'KeyP') {
            c.togglePause()
            return
        }
        const confirm = e.code === 'Enter' || e.code === 'Space'
        // On the menus a focused button (a track card, a swatch) handles the key itself.
        if (confirm && onMenu() && e.target instanceof HTMLElement && e.target.closest('button')) return
        if (confirm && canAdvance()) {
            e.preventDefault()
            if (!e.repeat) advance()
            return
        }
        if (e.code === 'KeyR' && !e.repeat && c.inSession.value) {
            c.play()
            return
        }
        if (c.paused.value) return
        if (NITRO_KEYS.has(e.code)) {
            e.preventDefault()
            if (!e.repeat) c.nitro()
            return
        }
        const control = CONTROL_KEYS[e.code]
        if (!control) return
        e.preventDefault()
        c.engine()?.setControl(control, true)
    }

    function onKeyUp(e: KeyboardEvent) {
        const control = CONTROL_KEYS[e.code]
        if (control) c.engine()?.setControl(control, false)
    }

    /** The menu's buttons in tab order, stepped through since a controller has no pointer. */
    function stepFocus(step: 1 | -1) {
        const buttons = [...c.root.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []].filter(b => b.offsetParent && !b.closest('[inert]'))
        if (!buttons.length) return
        const at = buttons.indexOf(document.activeElement as HTMLElement)
        const next = buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length]!
        next.focus()
        next.scrollIntoView({ block: 'nearest' })
        padFocus.value = true
    }

    function focusedButton() {
        const el = document.activeElement
        return el instanceof HTMLElement && c.root.value?.contains(el) ? el.closest('button') : null
    }

    function padCommand(command: PadCommand) {
        if (inBuilder()) return
        if (command === 'nitro') {
            if (!c.paused.value) c.nitro()
        } else if (command === 'pause') {
            if (onMenu()) advance()
            else c.togglePause()
        } else if (command === 'restart') {
            if (c.inSession.value) c.play()
        } else if (command === 'back') {
            if (c.paused.value) c.togglePause(false)
            else if (onMenu() && c.screen.value === 'select') c.backToTitle()
        } else if (!driving()) {
            if (command === 'confirm') {
                // A button focused mid-run (the HUD's pause) mustn't take A on the finish screen.
                const button = onMenu() || c.paused.value ? focusedButton() : null
                if (button) button.click()
                else if (canAdvance()) advance()
            } else if (onMenu() || c.paused.value) {
                stepFocus(command === 'next' ? 1 : -1)
            }
        }
    }

    function pollPad() {
        raf = requestAnimationFrame(pollPad)
        // A pad keeps reporting while another window has the player's attention.
        const pad = document.hasFocus() ? firstPad(navigator.getGamepads?.() ?? []) : null
        hasPad.value = !!pad
        const read = pad && readPad(pad)
        if (read?.active) {
            c.onActive()
            c.onPadUsed()
        }
        c.engine()?.setPad(read && driving() ? read.car : null)
        for (const command of presses.take(read?.held ?? new Set())) padCommand(command)
    }

    function onPointerDown() {
        padFocus.value = false
    }

    onMounted(() => {
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('pointerdown', onPointerDown, { passive: true })
        raf = requestAnimationFrame(pollPad)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('pointerdown', onPointerDown)
        cancelAnimationFrame(raf)
    })

    return { hasPad, padFocus }
}
