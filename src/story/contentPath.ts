/**
 * A data file named by a story: relative to the content root, without `..`.
 * A scheme or a parent would leave the content.
 */
export const isContentPath = (value: unknown): value is string =>
  typeof value === "string" && /^\w[\w-]*(\/\w[\w.-]*)*$/.test(value);
