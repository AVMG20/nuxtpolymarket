// How big a stage canvas is drawn: the largest integer scale that fits both the page's width and
// the window height left under the stage's top, then capped by the player's size choice.

import type { Presenter } from './canvas'

/** The player's choice in Settings: Large fills what is available, Small is the size at release. */
export type HqStageSize = 'large' | 'mid' | 'small'

export const HQ_STAGE_SIZES: readonly HqStageSize[] = ['large', 'mid', 'small']

// between the two, so a new screen doesn't open the game edge to edge (the user's call, 2026-10-13)
export const HQ_STAGE_SIZE_DEFAULT: HqStageSize = 'mid'

/** The stage's width at release (2026-10-12): the page's `max-w-4xl` column less its `sm:p-6` padding. */
const RELEASE_WIDTH = 896 - 2 * 24

/** What stays clear under the stage, so its bottom edge sits off the window's: the page's `sm:p-6`. */
const BOTTOM_GAP = 24

/** The stage's one-pixel border on each side, which the canvas sits inside. */
const BORDER = 2

export function isHqStageSize(value: unknown): value is HqStageSize {
    return HQ_STAGE_SIZES.includes(value as HqStageSize)
}

/** The CSS box a stage may fill: `frame`'s width, and the height from its top to the bottom of the window that scrolls it. */
export function stageRoom(frame: HTMLElement): { width: number, height: number } {
    const scroller = frame.closest('main')
    const top = frame.getBoundingClientRect().top
    // measured from the top of the scrolled content, so a page scrolled down doesn't win a bigger stage
    const height = scroller
        ? scroller.clientHeight - (top - scroller.getBoundingClientRect().top + scroller.scrollTop)
        : window.innerHeight - (top + window.scrollY)
    return { width: frame.getBoundingClientRect().width - BORDER, height: height - BOTTOM_GAP - BORDER }
}

/** The loading box's width, before the art says its frame: about where the stage will land, so the intro grows toward it. */
export function stagePlaceholderWidth(frame: HTMLElement, aspect: number, size: HqStageSize): number {
    const room = stageRoom(frame)
    const small = Math.min(room.width, RELEASE_WIDTH)
    const width = size === 'large' ? room.width : size === 'small' ? small : (room.width + small) / 2
    return Math.max(0, Math.min(width, room.height * aspect)) + BORDER
}

/** The integer scale a stage is drawn at: Large fills `room`, Small also keeps to the release width, Mid sits between. */
export function stageScale(presenter: Pick<Presenter, 'scaleFor'>, room: { width: number, height: number }, size: HqStageSize, dpr: number): number {
    const large = presenter.scaleFor(room.width, room.height, dpr)
    const small = presenter.scaleFor(Math.min(room.width, RELEASE_WIDTH), room.height, dpr)
    return size === 'large' ? large : size === 'small' ? small : Math.round((large + small) / 2)
}

/** Size `presenter` into `frame` at `size`. Returns the CSS size the canvas should be shown at. */
export function fitStage(presenter: Presenter, frame: HTMLElement, size: HqStageSize): { width: number, height: number } {
    const dpr = window.devicePixelRatio || 1
    return presenter.setScale(stageScale(presenter, stageRoom(frame), size, dpr), dpr)
}
