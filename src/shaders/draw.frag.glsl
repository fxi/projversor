#version 300 es
precision highp float;

uniform sampler2D u_ramp;
uniform float u_opacity;

in float v_color;
in float v_bright;
out vec4 o_color;

void main() {
    // Ramp alpha (alphaFade) hides slow or fast particles too.
    vec4 ramp = texture(u_ramp, vec2(v_color, 0.5));
    o_color = vec4(ramp.rgb * v_bright, ramp.a * u_opacity);
}
