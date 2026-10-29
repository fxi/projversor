#version 300 es
precision mediump float;

// zartigl's glow.frag.glsl: the trails gathered into the glow texture,
// GLOW_SCALE× smaller.
uniform sampler2D u_screen;
out vec4 o_color;

/// @zartigl GLOW_GLSL

void main() {
    o_color = glowGather(u_screen, ivec2(gl_FragCoord.xy));
}
