import {
  type MarkdownToken,
  type MarkdownTokenizer,
  mergeAttributes,
  Node
} from "@tiptap/core";

type OpaqueMarkdownBlockOptions = {
  name: string;
  label: string;
  markdownTokenName: string;
  accepts?: (token: MarkdownToken) => boolean;
  markdownTokenizer?: MarkdownTokenizer;
};

function canonicalTokenSource(token: MarkdownToken): string {
  return (token.raw ?? "").replace(/\n+$/, "");
}

function createOpaqueMarkdownBlock(options: OpaqueMarkdownBlockOptions) {
  return Node.create({
    name: options.name,
    group: "block",
    atom: true,
    selectable: true,
    priority: 1_000,

    addAttributes() {
      return {
        sourceMarkdown: {
          default: "",
          rendered: false
        }
      };
    },

    parseHTML() {
      return [{ tag: `div[data-opaque-markdown="${options.name}"]` }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          "data-opaque-markdown": options.name,
          contenteditable: "false"
        }),
        ["strong", {}, options.label],
        ["pre", {}, node.attrs.sourceMarkdown]
      ];
    },

    markdownTokenName: options.markdownTokenName,

    parseMarkdown(token, helpers) {
      if (options.accepts && !options.accepts(token)) {
        return [];
      }
      return helpers.createNode(options.name, {
        sourceMarkdown: canonicalTokenSource(token)
      });
    },

    renderMarkdown(node) {
      return node.attrs?.sourceMarkdown ?? "";
    },

    ...(options.markdownTokenizer
      ? { markdownTokenizer: options.markdownTokenizer }
      : {})
  });
}

const OpaqueTable = createOpaqueMarkdownBlock({
  name: "opaqueMarkdownTable",
  label: "Table — edit in Raw Markdown",
  markdownTokenName: "table"
});

const OpaqueHtml = createOpaqueMarkdownBlock({
  name: "opaqueMarkdownHtml",
  label: "HTML — edit in Raw Markdown",
  markdownTokenName: "html"
});

const OpaqueMermaid = createOpaqueMarkdownBlock({
  name: "opaqueMarkdownMermaid",
  label: "Mermaid — edit in Raw Markdown",
  markdownTokenName: "code",
  accepts: (token) => token.lang?.trim().toLowerCase() === "mermaid"
});

const mathTokenizer: MarkdownTokenizer = {
  name: "opaqueMarkdownMath",
  level: "block",
  start(source) {
    const index = source.match(/^\$\$(?:[ \t]*\n|.+\$\$[ \t]*(?:\n|$))/m)
      ?.index;
    return index ?? -1;
  },
  tokenize(source) {
    const match = source.match(
      /^\$\$(?:[^\n]*\$\$[ \t]*(?:\n|$)|[ \t]*\n[\s\S]*?\n\$\$[ \t]*(?:\n|$))/
    );
    if (!match) {
      return undefined;
    }
    return {
      type: "opaqueMarkdownMath",
      raw: match[0]
    };
  }
};

const OpaqueMath = createOpaqueMarkdownBlock({
  name: "opaqueMarkdownMath",
  label: "Math — edit in Raw Markdown",
  markdownTokenName: "opaqueMarkdownMath",
  markdownTokenizer: mathTokenizer
});

export const opaqueMarkdownExtensions = [
  OpaqueTable,
  OpaqueHtml,
  OpaqueMermaid,
  OpaqueMath
];
