import { describe, expect, it } from "vitest";
import { paragraphs } from "./paragraphs";

describe("paragraphs", () => {
  it("splits on blank lines and drops empty ones", () => {
    expect(paragraphs("One.")).toEqual(["One."]);
    expect(paragraphs("One.\n\nTwo.")).toEqual(["One.", "Two."]);
    expect(paragraphs(" One. \n \n\n Two.\n")).toEqual(["One.", "Two."]);
    expect(paragraphs("One\nline.")).toEqual(["One\nline."]);
    expect(paragraphs("")).toEqual([]);
  });
});
