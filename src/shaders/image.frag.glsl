#version 300 es
precision highp float;

#include ./grid.glsl;

// Georeferenced image: an equirectangular RGBA texture over u_bounds (west,
// south, east, north in degrees, row 0 at the north edge), straight alpha.
uniform sampler2D u_image;
uniform vec4 u_bounds;
uniform float u_opacity;
uniform float u_clip;

in vec3 v_geo;
in vec3 v_rot;
out vec4 o_color;

void main() {
    if (acos(clamp(normalize(v_rot).x, -1.0, 1.0)) > u_clip) {
        discard;
    }
    vec2 uv = geoUv(normalize(v_geo), u_bounds);
    if (!onGrid(uv, u_bounds)) {
        discard;
    }
    vec4 color = texture(u_image, uv);
    o_color = vec4(color.rgb, color.a * u_opacity);
}
