# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues. Use the `gh` CLI
for all operations.

## Repository

- GitHub repository: `getfumori/fumori`
- Infer the repository from `git remote -v` when commands run inside this
  clone.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List:
  `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Apply or remove labels with `gh issue edit`
- Close: `gh issue close <number> --comment "..."`

Use a heredoc for multi-line issue bodies.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an
ambiguous reference with `gh pr view <number>` and fall back to
`gh issue view <number>`.

## Publishing and fetching

When a skill says to publish to the issue tracker, create a GitHub issue.

When a skill says to fetch the relevant ticket, run:

`gh issue view <number> --comments`

## Wayfinding operations

Wayfinder uses one issue labelled `wayfinder:map`, with child issues as
tickets.

- Link children using GitHub sub-issues when available.
- Represent blockers with GitHub native issue dependencies.
- If native relationships are unavailable, use task lists and a `Blocked by:`
  line.
- The frontier is the first open child without an open blocker or assignee.
- Claim a ticket with `gh issue edit <number> --add-assignee @me`.
- Resolve it by commenting with the answer, closing it, and appending a context
  pointer to the map.
