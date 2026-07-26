export type Wikilink = {
  target: string;
  label: string;
  sourceMarkdown: string;
};

const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

export function wikilinks(markdown: string): Wikilink[] {
  return [...markdownOutsideCode(markdown).matchAll(WIKILINK)].map((match) => ({
    target: match[1]!.trim(),
    label: (match[2] ?? match[1])!.trim(),
    sourceMarkdown: match[0]
  }));
}

export function rewriteWikilinks(
  markdown: string,
  shouldRewrite: (target: string) => boolean,
  replacementTarget: string
): string {
  const decisions = new Map<string, boolean>();
  return transformMarkdownOutsideCode(markdown, (source) =>
    source.replace(
      WIKILINK,
      (sourceMarkdown, target: string, label: string | undefined) => {
        const normalizedTarget = target.trim();
        const rewrite =
          decisions.get(normalizedTarget) ??
          shouldRewrite(normalizedTarget);
        decisions.set(normalizedTarget, rewrite);
        if (!rewrite) {
          return sourceMarkdown;
        }
        return `[[${replacementTarget}${label ? `|${label}` : ""}]]`;
      }
    )
  );
}

function markdownOutsideCode(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line.replace(/`+[^`]*`+/g, "");
    })
    .join("\n");
}

function transformMarkdownOutsideCode(
  markdown: string,
  transform: (source: string) => string
): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) {
        return line;
      }
      return line
        .split(/(`+[^`]*`+)/)
        .map((segment, index) => (index % 2 === 0 ? transform(segment) : segment))
        .join("");
    })
    .join("\n");
}
