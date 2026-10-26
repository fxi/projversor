// Scalar field (e.g. temperature) that tints the particles, sampled like
// velocity.glsl (include it first, for grid.glsl). u_tint0/u_tint1 are
// consecutive scalar-luma frames as the browser decodes them, blended by
// u_tint_mix; u_tint_mask is the static validity. Decoded by zartigl's
// shared scalar decoder, as its MapLibre layer does.

uniform sampler2D u_tint0;
uniform sampler2D u_tint1;
uniform sampler2D u_tint_mask;
uniform float u_tint_mix;
uniform vec4 u_tint_bounds;  // west, south, east, north in degrees

/// @zartigl GEOVIDEO_SCALAR_GLSL

/** x = value × validity, y = validity in [0, 1]. */
vec2 sampleTint(vec3 g) {
    vec2 uv = geoUv(g, u_tint_bounds);
    if (!onGrid(uv, u_tint_bounds)) return vec2(0.0);
    // Linear codes: blending them blends the values.
    float r = mix(texture(u_tint0, uv).r, texture(u_tint1, uv).r, u_tint_mix);
    float validity = texture(u_tint_mask, uv).r;
    return vec2(geoVideoScalarValue(r) * validity, validity);
}
