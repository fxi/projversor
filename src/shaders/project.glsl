// Blended world projection, twin of projections.ts (blendRaw). Raw formulas
// must stay identical to d3's so the overlay coastlines match the raster.

uniform int u_proj_a;
uniform int u_proj_b;
uniform float u_ka;       // fit scale of a, px per raw unit
uniform float u_kb;       // fit scale of b
uniform float u_t;        // 0 = a, 1 = b
uniform float u_zoom;
uniform vec2 u_center;    // css px
uniform vec2 u_viewport;  // css px

const float PI = 3.141592653589793;

float mollweideTheta(float phi) {
    float target = PI * sin(phi);
    float x = phi;
    for (int i = 0; i < 12; i++) {
        float den = 1.0 + cos(x);
        if (den < 1e-6) break;
        float d = (x + sin(x) - target) / den;
        x -= d;
        if (abs(d) < 1e-7) break;
    }
    return 0.5 * x;
}

/** F(φ, k² = ½), PROJ's ell_int_5 Chebyshev series, as projections.ts. */
float ellInt5(float phi) {
    // Clenshaw recurrence unrolled: SwiftShader stalls on the array loop.
    float y0 = phi * 2.0 / PI;
    float y = 2.0 * y0 * y0 - 1.0;
    float y2 = 2.0 * y;
    float d1 = -8.58691003636495e-7;
    float d2 = 0.0;
    float t;
    t = d1; d1 = y2 * d1 - d2 + 2.02692115653689e-7; d2 = t;
    t = d1; d1 = y2 * d1 - d2 + 3.12960480765314e-5; d2 = t;
    t = d1; d1 = y2 * d1 - d2 + 5.30394739921063e-5; d2 = t;
    t = d1; d1 = y2 * d1 - d2 - 0.0012804644680613; d2 = t;
    t = d1; d1 = y2 * d1 - d2 - 0.00575574836830288; d2 = t;
    t = d1; d1 = y2 * d1 - d2 + 0.0914203033408211; d2 = t;
    return phi * (y * d1 - d2 + 0.5 * 2.19174570831038);
}

/** Adams World in a Square II, unturned square, as projections.ts. */
vec2 adamsWs2(float lam, float phi) {
    float spp = tan(0.5 * phi);
    float a = cos(asin(clamp(spp, -1.0, 1.0))) * sin(0.5 * lam);
    bool sm = spp + a < 0.0;
    bool sn = spp - a < 0.0;
    float b = acos(clamp(spp, -1.0, 1.0));
    a = acos(clamp(a, -1.0, 1.0));
    float m = asin(sqrt(max(0.0, 1.0 + min(0.0, cos(a + b)))));
    float n = asin(sqrt(max(0.0, 1.0 - max(0.0, cos(a - b)))));
    return vec2(ellInt5(sm ? -m : m), ellInt5(sn ? -n : n));
}

vec2 rawProject(int id, float lam, float phi) {
    if (id == 0) {
        return vec2(lam, phi);
    }
    if (id >= 6) {
        // One call site for both: SwiftShader compiles every inlined copy.
        vec2 s = adamsWs2(lam, phi);
        // 7: turned 45° clockwise, as adamsDiamondRaw.
        return id == 6 ? s : 0.7071067811865476 * vec2(s.x + s.y, s.y - s.x);
    }
    if (id == 1) {
        // Equal Earth (Šavrič et al.), as d3.geoEqualEarthRaw.
        const float A1 = 1.340264;
        const float A2 = -0.081106;
        const float A3 = 0.000893;
        const float A4 = 0.003796;
        const float M = 0.8660254037844386;
        float l = asin(M * sin(phi));
        float l2 = l * l;
        float l6 = l2 * l2 * l2;
        return vec2(
            lam * cos(l) / (M * (A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2))),
            l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2))
        );
    }
    if (id == 2) {
        float theta = mollweideTheta(phi);
        return vec2(0.9003163161571061 * lam * cos(theta), 1.4142135623730951 * sin(theta));
    }
    float cy = cos(phi);
    float cxcy = cos(lam) * cy;
    if (id == 5) {
        return vec2(cy * sin(lam), sin(phi));
    }
    float k;
    if (id == 3) {
        k = sqrt(2.0 / max(1.0 + cxcy, 1e-7));
    } else {
        // acos(cxcy) steps by about 3e-4 rad (2 km) near the center in float32,
        // which draws rings at high zoom; atan of sine over cosine does not.
        float s = length(vec2(cy * sin(lam), sin(phi)));
        float c = atan(s, cxcy);
        k = s > 1e-6 ? c / s : 1.0;
    }
    return vec2(k * cy * sin(lam), k * sin(phi));
}

/** Blended projection in css px, y down, before the viewport transform. */
vec2 projectPx(float lam, float phi) {
    // Two call sites, not four: each inlines every projection.
    vec2 pa = u_t < 1.0 ? u_ka * rawProject(u_proj_a, lam, phi) : vec2(0.0);
    vec2 pb = u_t > 0.0 ? u_kb * rawProject(u_proj_b, lam, phi) : vec2(0.0);
    vec2 p = u_t <= 0.0 ? pa : (u_t >= 1.0 ? pb : mix(pa, pb, u_t));
    return u_center + u_zoom * vec2(p.x, -p.y);
}

vec4 pxToClip(vec2 px, float depth) {
    return vec4(px.x / u_viewport.x * 2.0 - 1.0, 1.0 - px.y / u_viewport.y * 2.0, depth, 1.0);
}

vec2 lonLat(vec3 r) {
    return vec2(atan(r.y, r.x), asin(clamp(r.z, -1.0, 1.0)));
}

/** Angular distance from the projection center, rotated frame. */
float centerDistance(vec3 r) {
    // As rawProject: acos near 1 loses the small distances high zooms need.
    return atan(length(r.yz), r.x);
}
