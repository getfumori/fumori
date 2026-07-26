import { mergeAttributes, Node } from "@tiptap/core";

export const PreservedWikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  priority: 1_000,

  addAttributes() {
    return {
      sourceMarkdown: {
        default: "",
        rendered: false
      },
      label: {
        default: ""
      }
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": "",
        contenteditable: "false"
      }),
      node.attrs.label
    ];
  },

  markdownTokenName: "wikilink",

  parseMarkdown(token, helpers) {
    return helpers.createNode("wikilink", {
      sourceMarkdown: token.raw ?? "",
      label: token.text
    });
  },

  renderMarkdown(node) {
    return node.attrs?.sourceMarkdown ?? "";
  },

  markdownTokenizer: {
    name: "wikilink",
    level: "inline",
    start: "[[",
    tokenize(source) {
      const match = source.match(/^\[\[([^\]\n]+)\]\]/);
      if (!match) {
        return undefined;
      }
      const raw = match[0];
      const label = match[1]!.split("|", 2)[1] ?? match[1]!;
      return {
        type: "wikilink",
        raw,
        text: label
      };
    }
  }
});
