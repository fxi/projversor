import type { GeoVideoBounds } from "@fxi/zartigl/engine";
import imageFrag from "./shaders/image.frag.glsl";
import rasterVert from "./shaders/raster.vert.glsl";
import { drawLonLatMesh } from "./SphereScalar";
import { Program, isGlobalGrid, type ViewFrame } from "./view";

/** What a georeferenced image is drawn from. */
export type ImageSource = TexImageSource;

/**
 * A georeferenced image on the sphere: an equirectangular RGBA texture
 * over `bounds` (west, south, east, north in degrees; east may pass 180 to
 * cross the antimeridian), drawn on the raster mesh so it morphs with the
 * projections. A global image repeats across the seam.
 */
export class SphereImage {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    image: ImageSource,
    readonly bounds: GeoVideoBounds,
  ) {
    this.program = new Program(gl, rasterVert, imageFrag);
    this.vao = gl.createVertexArray();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Straight alpha, as compositeBlend expects.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const wrapS = isGlobalGrid(bounds) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Draw over the bound framebuffer at `opacity` (0–1). */
  draw(frame: ViewFrame, opacity: number): void {
    const p = this.program.use();
    p.texture("u_image", 0, this.texture);
    p.vec4("u_bounds", this.bounds);
    p.float("u_opacity", opacity);
    drawLonLatMesh(this.gl, this.vao, p, frame, this.bounds);
  }

  destroy(): void {
    this.program.delete();
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteTexture(this.texture);
  }
}

/** Check image bounds from untyped input; throws with `path`. */
export function parseImageBounds(value: unknown, path: string): GeoVideoBounds {
  const b = value as number[];
  const valid =
    Array.isArray(b) &&
    b.length === 4 &&
    b.every(Number.isFinite) &&
    b[0] < b[2] &&
    b[2] - b[0] <= 360 &&
    b[1] < b[3] &&
    b[1] >= -90 &&
    b[3] <= 90;
  if (!valid) {
    throw new Error(
      `${path} must be [west, south, east, north] degrees, west < east, south < north`,
    );
  }
  return [b[0], b[1], b[2], b[3]];
}

/** Load an image url (cross-origin, decoded), or take a loaded source. */
export async function loadImage(
  source: string | ImageSource,
  doc: Document,
): Promise<ImageSource> {
  if (typeof source !== "string") {
    return source;
  }
  const image = doc.createElement("img");
  image.crossOrigin = "anonymous";
  image.src = source;
  await image.decode();
  return image;
}
