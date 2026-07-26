import { Editor, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

import { opaqueMarkdownExtensions } from "./OpaqueMarkdownBlock.js";
import { PreservedWikilink } from "./PreservedWikilink.js";

export function createFoundationMarkdownExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      horizontalRule: false,
      link: false,
      strike: false,
      underline: false
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({
      markedOptions: { gfm: true }
    }),
    PreservedWikilink,
    ...opaqueMarkdownExtensions
  ];
}

function normalizeRichRoundTrip(markdown: string): string {
  return markdown
    .replace(/^\n+|\n+$/g, "")
    .replace(
      /^([ \t]*(?:[-+*]|\d+\.)[ \t]*)\n\n(?=[ \t]*(?:[-+*]|\d+\.)[ \t])/gm,
      "$1\n"
    );
}

export function isRichMarkdownRoundTripSafe(bodyMarkdown: string): boolean {
  let editor: Editor | undefined;
  try {
    editor = new Editor({
      extensions: createFoundationMarkdownExtensions(),
      content: bodyMarkdown,
      contentType: "markdown"
    });
    return (
      normalizeRichRoundTrip(editor.getMarkdown()) ===
      normalizeRichRoundTrip(bodyMarkdown)
    );
  } catch {
    return false;
  } finally {
    editor?.destroy();
  }
}
