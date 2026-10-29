#version 300 es
precision highp float;

// zartigl's composite.frag.glsl: the trails at opacity 1, with the optional
// glow and color grade. Off, colors pass unchanged.
uniform sampler2D u_screen;
uniform sampler2D u_glow_tex;
uniform float u_glow;
uniform float u_grade_on;
uniform vec4 u_grade;

in vec2 v_uv;
out vec4 o_color;

/// @zartigl GLOW_GLSL
/// @zartigl COLOR_GRADE_GLSL

void main() {
    vec4 color = texture(u_screen, v_uv);
    float alpha = floor(color.a * 255.0) / 255.0;
    color = vec4(color.rgb * step(1.0 / 255.0, alpha), alpha);
    if (u_glow > 0.0) {
        color = addGlow(color, u_glow_tex, v_uv, u_glow);
    }
    vec3 rgb = u_grade_on > 0.5 ? gradeColor(color.rgb, u_grade) : color.rgb;
    o_color = vec4(rgb, color.a);
}
