import type * as THREE from 'three'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import type { DfAudio, DfProjectileView, DfRenderContext, DfViewmodel } from '../context'
import { buildDfWeaponModelImpl } from './models'
import { createDfProjectileViewImpl } from './projectiles'
import { DF_WSND, registerDfWeaponSoundsImpl } from './sounds'
import { createDfViewmodelImpl } from './viewmodel'

// Weapons module entry. Factory names and signatures are a contract with the engine.

export { disposeDfWeaponModel } from './models'
export { disposeDfWeaponMaterials } from './materials'
export { DF_WSND } from './sounds'
/** Muzzle-flash light colour for a weapon at a PaP tier (the X-Ray uses its tier's colour scheme). */
export { dfMuzzleFlashColor } from './viewmodel'
export { dfXrayScheme } from './xray'

export function createDfViewmodel(ctx: DfRenderContext): DfViewmodel {
    return createDfViewmodelImpl(ctx)
}

export function createDfProjectileView(ctx: DfRenderContext): DfProjectileView {
    return createDfProjectileViewImpl(ctx)
}

/**
 * World-space model (third-person hands, box float, pedestal, wall chalk preview, armory preview).
 * About 1 unit = 1 metre, muzzle toward -z, origin at the grip. The group owns its geometries;
 * materials are shared from a cache, so dispose it with `disposeDfWeaponModel(group)` (or
 * dispose only geometries), never its materials.
 */
export function buildDfWeaponModel(id: DfWeaponId, pap = 0, attachments: DfAttachmentChoice = {}): THREE.Group {
    return buildDfWeaponModelImpl(id, pap, attachments)
}

export function registerDfWeaponSounds(audio: DfAudio): void {
    registerDfWeaponSoundsImpl(audio)
}

/** Sound the engine plays at a remote shooter for one of their shots. */
export function dfShotSoundName(weapon: DfWeaponId, pap: number): string {
    return DF_WSND.fire(weapon, pap)
}
