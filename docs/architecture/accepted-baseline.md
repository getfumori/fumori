# Accepted Architecture Baseline

This document is the implementation-facing digest of the architecture accepted
in the research repository at commit
`e02d10e496a79165f890262249fe1b8e85b513b7`. It preserves the decisions that
remain Fumori's default without copying the research Wayfinder tickets into the
implementation backlog.

The [Foundation Release](../product/foundation-release.md) is a deliberately
smaller delivery slice over this architecture. Deferring a capability from
Foundation does not reject its accepted long-term boundary.

## Authority

Use the following order when documents differ:

1. A later accepted ADR or accepted product document in this repository.
2. This architecture baseline.
3. The living terminology and invariants in [`CONTEXT.md`](../../CONTEXT.md).
4. The historical research artifacts identified by
   [Research Provenance](../research-provenance.md).

The historical repository is audit provenance, not a routine dependency for
implementation planning.

## Architecture decisions

| Area | Accepted architecture | Foundation treatment |
| --- | --- | --- |
| Canonical knowledge | A Vault is a Git repository with one Markdown file per durable object, stable hidden object identity, optional stable block identity, a minimal versioned envelope, readable wikilinks, and a round-trippable Markdown Profile. Service indexes and caches are disposable. | Implements the canonical Human Note and Daily Note substrate, with no attachments or block-level product features. |
| Organization Model | Every Vault owns a neutral Core Model defining lifecycle, Inbox, Today, Types, properties, relationships, templates, tags, and Saved Views. Richer Presets are detached inputs that become Vault-owned definitions rather than permanent external dependencies. | Bootstrap installs the Core Model. The Web app consumes definitions but does not edit, migrate, or reconcile them. |
| Knowledge spaces and provenance | Human Notes, Sources, and AI Knowledge have distinct ownership and provenance. Sources preserve revision-pinned evidence. AI Knowledge may synthesize authorized evidence but cannot recursively treat generated claims as evidence. | Exposes only Human Notes and Daily Notes. `sources/` and `knowledge/` remain reserved with no UI, API, or write flow. |
| Vault isolation and lifecycle | A Vault is the complete canonical, runtime, security, history, backup, and job boundary. Every operation carries one explicit Vault context. Catalog, import, restore, fork, trash, and purge preserve isolation and repository-native portability. | One configured Vault per server instance, initialized by an operator command against an empty Git repository. Multi-Vault lifecycle UI is deferred. |
| Revisions and transactions | Content-hash Object working revisions provide optimistic concurrency independently of Git commits. One Repository Coordinator owns canonical writes, staged multi-object transactions, checkpoints, event commits, recovery, and forward-moving rollback. | Conditional atomic note saves, stale-draft conflict handling, a 30-minute dirty-only checkpoint policy, deterministic manual checkpoint operation, and startup recovery are required. |
| Server shape | A Node.js TypeScript modular monolith owns one deep Vault Module. A Vault Manager issues explicitly scoped Vault Handles; HTTP, in-process jobs, and future agent paths use the same application contracts. Replaceable adapters are reserved for genuine external boundaries. | Uses the same modular-monolith direction without implementing deferred AI, backup, import, or persistent-index subsystems. |
| AI execution and Review | AI is an optional per-Vault capability. Product-owned AI Runs have fixed effects, budgets, evidence snapshots, staged writes, and review state. AI never directly rewrites Human Notes, Today, or Organization Model definitions; those changes require reviewable Change Proposals. | No AI providers, Runs, Threads, Review, proposals, compilation, or AI UI. The canonical ownership boundaries remain reserved. |
| Retrieval and citations | Retrieval is Vault-scoped, policy filtered, rebuildable, and grounded in authorized corpus roles. The accepted full system uses a disposable per-Vault SQLite projection for lexical and graph retrieval, with Git-pinned citations. Embeddings and vectors are optional rather than foundational. | Uses a disposable in-memory document projection and document-level lexical search. No SQLite, FTS, embeddings, vectors, or block retrieval. |
| Today and compilation | Today is the default human capture surface. Daily Notes remain ordinary canonical Markdown. Future catch-up, research, and AI Knowledge compilation operate incrementally from exact Git cursors and preserve evidence boundaries. | Today is the default route. Daily files are created lazily on first edit. Compilation and AI context are absent. |
| Security and privacy | The trusted server holds plaintext canonical data. The single-owner Web origin sits behind an operator-controlled gateway; the product does not claim protection from a compromised host, gateway, or endpoint. Secrets stay outside Vault repositories. AI egress, redaction, content-free logs, passive attachments, and ephemeral browser storage are explicit boundaries. | Defaults to loopback with no application login or TLS. Non-loopback binding is explicit and warned. Browser knowledge state is ephemeral; AI, secrets, and attachments are not exercised. |
| Service and agents | One schema-driven HTTP contract distinguishes the Interactive Owner channel from stateless Agent calls. Agent credentials are Vault-scoped and cannot upgrade their authority. Managed AI Knowledge writes and Human Note proposals reuse the same Vault application boundary. | Implements only the owner-facing Web and operator operations needed by the note app. Agent credentials, tools, Runs, and event streams are deferred. |
| Stack and delivery | The accepted stack is Node.js 24 LTS, TypeScript, pnpm, Vue 3, Vite+, Hono, Zod 4, and the system Git CLI. The service is single-replica and server-authoritative; native clients, browser-side Git, a hosted control plane, an external database, and a distributed queue are excluded. | Ships primarily as an npm package with a `fumori` CLI and prebuilt Web assets. OCI and Compose packaging may be added later but are not release gates. |
| Backup and recovery | Git is the sole complete history model. Optional remotes publish verified recovery points without blocking local work. Encrypted remote transport is an external capability with a Recovery Kit; restore validates in staging and rebuilds disposable state. | Provides local Git checkpoints and crash recovery only. Remote push, backup, restore, encrypted transport, and recovery UI are deferred. |

## Cross-cutting invariants

- Canonical Markdown and Git history remain sufficient to reconstruct every
  durable Vault fact; runtime projections never become a second source of
  truth.
- Browser editing writes to the server-owned worktree. Git is a coherent
  history and recovery mechanism, not a browser synchronization protocol.
- Human-authored spaces and AI-owned spaces retain separate write authority.
  Optional AI capability must not weaken the note app when disabled.
- Every route, operation, job, index, citation, secret binding, and future
  capability is scoped to exactly one Vault.
- Physical file placement is readable but non-semantic. Stable identity,
  lifecycle, Types, relationships, and derived views do not depend on folders.
- Repository contents are treated as data, never executable application code.
- External egress is explicit and policy-controlled. Operational logs remain
  content-free.
- Recovery favors validation, staging, and forward history over silent repair
  or destructive rollback.

## Foundation overlay

Foundation proves the narrow vertical substrate before expanding the accepted
architecture:

- bootstrap an empty local Git repository into a canonical Vault;
- serve one Vault through a desktop Web note application;
- create, edit, link, search, archive, and delete canonical Markdown notes;
- preserve a constrained WYSIWYG experience without split preview;
- rebuild all query state from the repository;
- autosave safely across browser tabs with optimistic revisions;
- checkpoint and recover the Git worktree deterministically; and
- distribute and verify the packaged application on supported Node.js
  platforms.

Foundation intentionally does not build speculative scaffolding for deferred
features. New modules and seams should be introduced when a real release needs
them, while preserving the invariants above.

## Explicit future capabilities

The following remain important but are not Foundation requirements:

- responsive mobile Web and installed-PWA behavior;
- internal multi-document tabs and restored workspaces;
- multiple open Vaults and complete Vault lifecycle management;
- attachments, Sources, AI Knowledge, AI execution, Review, and cited answers;
- persistent SQLite projections and block-level retrieval;
- content import and migration;
- remote backup, restore, and encrypted recovery;
- external Agent credentials and tool APIs; and
- optional OCI or Compose packaging.
