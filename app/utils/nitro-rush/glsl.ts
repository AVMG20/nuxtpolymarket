/** Arithmetic hash: sin-based ones lose precision on some GPUs (ANGLE on Windows) and turn into visible speckle. */
export const HASH_GLSL = /* glsl */`
        float hash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }`
