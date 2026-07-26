import { mergeAttributes, Node } from "@tiptap/core";

export type WikilinkPresentation = {
  status: "resolved" | "ambiguous" | "unresolved";
  url: string | null;
};

export const PreservedWikilink = Node.create<{
  resolve: (target: string) => WikilinkPresentation;
}>({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  priority: 1_000,

  addOptions() {
    return {
      resolve: () => ({ status: "unresolved", url: null })
    };
  },

  addAttributes() {
    return {
      sourceMarkdown: {
        default: "",
        rendered: false
      },
      label: {
        default: ""
      },
      target: {
        default: "",
        rendered: false
      }
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }, { tag: "a[data-wikilink]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const presentation = this.options.resolve(node.attrs.target);
    return [
      presentation.url ? "a" : "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": "",
        "data-link-status": presentation.status,
        "data-link-target": node.attrs.target,
        ...(presentation.url ? { href: presentation.url } : {}),
        role: "link",
        tabindex: "0",
        "aria-label": `${node.attrs.label} — ${presentation.status} wikilink`,
        contenteditable: "false"
      }),
      node.attrs.label
    ];
  },

  markdownTokenName: "wikilink",

  parseMarkdown(token, helpers) {
    return helpers.createNode("wikilink", {
      sourceMarkdown: token.raw ?? "",
      label: token.text,
      target: token.target
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
      const target = match[1]!.split("|", 1)[0]!.trim();
      return {
        type: "wikilink",
        raw,
        text: label,
        target
      };
    }
  }
});
