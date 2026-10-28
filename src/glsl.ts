import {
  COLOR_GRADE_GLSL,
  GEOVIDEO_SCALAR_GLSL,
  VELOCITY_BLEND_GLSL,
  RANDOM_GLSL,
  VIBRANCE_GLSL,
} from "@fxi/zartigl/engine";

/** zartigl's shared GLSL chunks, which this build cannot `#include`. */
const CHUNKS: Record<string, string> = {
  COLOR_GRADE_GLSL,
  GEOVIDEO_SCALAR_GLSL,
  VELOCITY_BLEND_GLSL,
  RANDOM_GLSL,
  VIBRANCE_GLSL,
};

/** Replace each `/// @zartigl NAME` line (a comment the GLSL loader keeps) of a shader by zartigl's chunk. */
export function withZartiglChunks(source: string): string {
  return source.replace(/^\/\/\/ @zartigl (\w+)$/gm, (_line, name: string) => {
    const chunk = CHUNKS[name];
    if (chunk === undefined) {
      throw new Error(`Unknown zartigl GLSL chunk: ${name}`);
    }
    return chunk;
  });
}
