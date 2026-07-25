# Issue tracker: Local Markdown

Issues and specs for this repository live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue
- Comments and conversation history are appended under a `## Comments` heading

## Publishing and fetching

When a skill says to publish to the issue tracker, create the appropriate file
under `.scratch/<feature-slug>/`.

When a skill says to fetch a ticket, read the referenced Markdown file.

## Wayfinding operations

Wayfinder uses `.scratch/<effort>/map.md` with one child file per ticket under
`.scratch/<effort>/issues/`.

- Each child records `Type:`, `Status:`, and `Blocked by:` fields.
- The frontier is the first numbered open, unblocked, and unclaimed ticket.
- Claim work by setting `Status: claimed` before beginning.
- Resolve work by appending an `## Answer`, setting `Status: resolved`, and
  adding a context pointer to the map.
