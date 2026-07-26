import { describe, expect, test } from "vitest";

import { isRichMarkdownRoundTripSafe } from "../../src/web/foundation-markdown.js";

describe("Foundation Markdown safety", () => {
  test("accepts Markdown emitted by the rich editor", () => {
    expect(
      isRichMarkdownRoundTripSafe(
        [
          "",
          "",
          "A paragraph.",
          "",
          "- ",
          "- A list item",
          "",
          "- [x] A task",
          "",
          "```",
          "const answer = 42;",
          "```",
          ""
        ].join("\n")
      )
    ).toBe(true);
  });

  test.each([
    ["tables", "| Key | Value |\n| --- | --- |\n| mist | high |"],
    ["math", "$$\nx^2 + y^2\n$$"],
    ["Mermaid", "```mermaid\ngraph TD\n  seed --> forest\n```"],
    ["HTML", "<section data-kind=\"weather\">Fog</section>"]
  ])("preserves unsupported %s syntax as an opaque block", (_label, markdown) => {
    expect(isRichMarkdownRoundTripSafe(`Before.\n\n${markdown}\n\nAfter.`)).toBe(
      true
    );
  });

  test("does not mistake supported code or wikilinks for unsupported syntax", () => {
    expect(
      isRichMarkdownRoundTripSafe(
        [
          "Use `<section>` and `$$` literally beside [[weather|Weather]].",
          "",
          "```html",
          "<section>",
          "| not | a table |",
          "$$",
          "</section>",
          "```"
        ].join("\n")
      )
    ).toBe(true);
  });

  test.each([
    ["ordinary links", "[site](https://example.com)"],
    ["images", "![alt](image.png)"],
    ["horizontal rules", "---"],
    ["inline HTML", "Before <span>x</span> after"]
  ])("directs remaining unsupported %s to Raw Markdown", (_label, markdown) => {
    expect(isRichMarkdownRoundTripSafe(markdown)).toBe(false);
  });
});
