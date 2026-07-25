# Use a constrained rich editor over canonical Markdown

Fumori uses one WYSIWYG editing surface backed by canonical Markdown rather
than a source-first editor or split preview. The rich surface exposes only
constructs that round-trip reliably through the versioned Markdown Profile;
Raw Markdown remains an escape hatch for unsupported or exact-source editing.
This preserves the calm direct-editing experience that is central to the
product without allowing rich-editor convenience to weaken Markdown
portability or silently rewrite user content.
