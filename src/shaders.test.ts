import { describe, expect, it } from "vitest";
import { withZartiglChunks } from "./glsl";
import advectSource from "./shaders/advect.frag.glsl";
import compositeSource from "./shaders/composite.frag.glsl";
import drawSource from "./shaders/draw.vert.glsl";
import rasterSource from "./shaders/raster.frag.glsl";
import rasterVert from "./shaders/raster.vert.glsl";

// The shaders as compiled: zartigl chunks inserted.
const advectFrag = withZartiglChunks(advectSource);
const compositeFrag = withZartiglChunks(compositeSource);
const drawVert = withZartiglChunks(drawSource);
const rasterFrag = withZartiglChunks(rasterSource);

describe("projversor advection randomness", () => {
  it("draws respawns from the integer hash, not from sin", () => {
    expect(advectFrag).toContain("float random(uvec3 v)");
    expect(advectFrag).toContain("uniform uint u_frame");
    expect(advectFrag).not.toContain("sin(dot(");
    expect(advectFrag).not.toContain("u_seed");
  });
});

describe("shared velocity blending", () => {
  it("uses zartigl's physical velocity blend for advection and speed color", () => {
    for (const shader of [advectFrag, drawVert]) {
      expect(shader).not.toContain("/// @zartigl");
      expect(shader).toContain(
        "vec3 blendVelocity(vec3 a, vec3 b, float fraction)",
      );
      expect(shader).toContain(
        "blendVelocity(texture(u_vel0, uv).xyz, texture(u_vel1, uv).xyz, u_vel_mix)",
      );
    }
  });
});

describe("projversor grids", () => {
  it("samples regional grids only inside their bounds", () => {
    for (const shader of [advectFrag, rasterFrag]) {
      expect(shader).toContain("bool onGrid(vec2 uv, vec4 bounds)");
    }
    expect(advectFrag).toContain("if (!onGrid(uv, u_bounds))");
    expect(rasterFrag).toContain("if (!onGrid(uv, u_tint_bounds))");
  });

  it("applies the catalog vibrance like zartigl's scalar shaders", () => {
    expect(rasterFrag).toContain("vec3 applyVibrance(vec3 c, float v)");
    expect(rasterFrag).toContain("applyVibrance(ramp.rgb");
  });

  it("keeps the ramp alpha so palettes can fade low values out", () => {
    expect(rasterFrag).toContain("ramp.a * u_opacity");
  });

  it("decodes scalar frames with zartigl's GeoVideo decoder, on the GPU", () => {
    for (const shader of [rasterFrag, drawVert]) {
      expect(shader).not.toContain("/// @zartigl");
      expect(shader).toContain("float geoVideoScalarValue(float r)");
      expect(shader).toContain("geoVideoScalarValue(r) * validity");
    }
  });

  it("grades the trail composite with zartigl's shared helper", () => {
    expect(compositeFrag).not.toContain("#include");
    expect(compositeFrag).toContain("vec3 gradeColor(vec3 c, vec4 g)");
    expect(compositeFrag).toContain(
      "u_grade_on > 0.5 ? gradeColor(color.rgb, u_grade) : color.rgb",
    );
  });

  it("drops raster triangles across a projection cut", () => {
    expect(rasterVert).toContain("longest < u_max_jump");
  });
});
