import * as THREE from 'three'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { buildDfWeaponModel, disposeDfWeaponModel } from '~/utils/dead-front/weapons'

/** Weapon models built once per (weapon, tier) and reused. */
export class DfWeaponCache {
    private cache = new Map<string, THREE.Group>()
    get(id: DfWeaponId, pap = 0): THREE.Group {
        const k = `${id}:${pap}`
        let g = this.cache.get(k)
        if (!g) {
            try {
                g = buildDfWeaponModel(id, pap)
            } catch {
                g = new THREE.Group()
            }
            this.cache.set(k, g)
        }
        return g
    }

    dispose(): void {
        for (const g of this.cache.values()) {
            g.removeFromParent()
            disposeDfWeaponModel(g)
        }
        this.cache.clear()
    }
}
