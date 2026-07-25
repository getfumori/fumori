# Research Provenance

Fumori begins from a completed architecture-research effort. This document
keeps that source discoverable without turning its research tracker into this
repository's implementation backlog.

## Stable baseline

- Source repository:
  `/Users/hibiki/code/vibe/second_brain_research`
- Baseline commit:
  `e02d10e496a79165f890262249fe1b8e85b513b7`
- Commit subject:
  `docs: capture second brain architecture research`

The source repository had no configured remote at the time of transfer. The
baseline commit is therefore local provenance and should be preserved or
backed up independently.

The root [`CONTEXT.md`](../CONTEXT.md) was initialized from Git blob
`ac1cd82413dbc3ea72126fd62f7d21d7aa08ae44` at that baseline and now serves as
Fumori's living domain glossary. Its single Chinese editor label was translated
to `Hide from AI` to satisfy this repository's English-only documentation
rule; the domain meaning is unchanged.

## Canonical research artifacts

At the baseline commit, the canonical source artifacts are:

1. `CONTEXT.md` — domain language and settled boundaries.
2. `.scratch/second-brain/map.md` — low-resolution decision index and research
   scope.
3. `.scratch/second-brain/issues/` — accepted detailed decisions in tickets
   01–13 and explicit implementation-repository deferrals in tickets 14–15.
4. `.scratch/second-brain/research/` — primary-source technical research.
5. `.scratch/second-brain/prototypes/` — frozen, throwaway behavioral evidence.

Paths in this list are relative to the source repository. When an exact
historical answer is needed, read the artifact from the baseline commit rather
than relying on a later working-tree version.

## Current implementation authority

Routine implementation planning no longer depends on reading the source
repository:

1. [`CONTEXT.md`](../CONTEXT.md) is the living domain glossary.
2. [`docs/architecture/accepted-baseline.md`](architecture/accepted-baseline.md)
   is the implementation-facing digest of accepted decisions 01–13.
3. [`docs/product/foundation-release.md`](product/foundation-release.md) is the
   accepted release overlay for the decisions previously deferred by research
   tickets 14–15.
4. [`docs/adr/`](adr/) records later decisions that override or refine the
   baseline.

The source repository remains historical evidence for auditing an exact
research trail. It is not an active planning dependency or issue tracker.

## Transfer boundary

- The source Wayfinder tickets remain research history. They are not copied
  into `.scratch/` here and must not be treated as the implementation backlog.
- The frozen UI shell is research evidence only and is not production code.
- Accepted architecture remains the default unless a concrete implementation
  constraint requires reopening a decision.
- First-release scope, desktop information architecture, import scope, and
  measurable acceptance seams were resolved in this repository and are
  recorded in
  [`docs/product/foundation-release.md`](product/foundation-release.md).

The Fumori product name and logo direction were accepted after the baseline
commit and were transferred through the accompanying implementation handoff.
They are recorded separately in [`docs/product/brand.md`](product/brand.md).
