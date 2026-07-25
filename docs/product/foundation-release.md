# Foundation Release

Status: Accepted

The Foundation Release is Fumori's first shippable version. It establishes the
project, proves the server-authoritative Markdown Vault substrate, and delivers
a useful desktop note application before broader product capabilities are
added.

## Resolved boundaries

- The release is a note-app foundation, not an AI product release.
- The product is a server-hosted Web application inspired by Tolaria's calm,
  constrained note-editing and organization model. It does not adopt
  client-side Git synchronization.
- An operator creates an empty local Git repository and manually runs the
  Fumori Vault bootstrap command. Bootstrap writes the canonical Vault
  Manifest and Core Model and creates the initial history boundary.
- One server instance opens one configured Vault. The internal domain remains
  explicitly Vault-scoped so multi-Vault support can be added without
  redefining the canonical model.
- Daily Notes, including the Today surface, and standalone Human Notes are the
  only knowledge spaces exposed for creation, editing, and browsing.
- The canonical repository retains `sources/` and `knowledge/` as reserved
  ownership boundaries, but the release provides no UI, API, or write workflow
  for them.
- Notes are text-first. Markdown may contain ordinary external links, but the
  product has no attachment upload, pasted-file ingestion, asset browser, or
  inline media and PDF preview flow. `assets/` remains a reserved canonical
  repository boundary.
- Vault bootstrap installs the Core Model. The application consumes canonical
  Type, property, relationship, and Saved View definitions and exposes
  `type`, `state`, `tags`, `aliases`, typed properties, and wikilink
  relationships on Human Notes.
- The Web application does not author or mutate Organization Model
  definitions. An operator may edit canonical model files outside the running
  service; those edits take effect through the same startup loading contract
  as note changes. Foundation does not provide model hot reload.
- Note bodies use one constrained WYSIWYG surface over canonical Markdown.
  Split preview is permanently excluded. Raw Markdown is an explicit escape
  hatch for unsupported or exact-source editing, not the ordinary editor.
- The Foundation rich surface covers paragraphs, H1–H3, bold, italic, inline
  code, ordered and unordered lists, checkboxes, blockquotes, fenced code
  blocks, and wikilinks. Frontmatter is edited through the document inspector.
- Today is the default route and primary capture surface. Historical Daily
  Notes are reached through calendar or history navigation associated with
  Today rather than through a separate top-level product area.
- Visiting Today or an absent historical date does not create a file. The
  first edit atomically creates that date's canonical Daily Note with its
  required envelope and date H1; an absent historical date requires an
  explicit create action before editing.
- The desktop workspace has three stable zones: primary navigation, a
  context/list pane, and the active document surface. Today uses the middle
  pane for calendar and recent-day navigation; Notes, Inbox, Types, and Search
  use it for their result lists.
- Primary navigation contains Today, Notes, Inbox, Types, Views, and Archive.
  Search opens from a compact icon and keyboard shortcut rather than occupying
  a navigation row.
- The workspace has one active document and stable note URLs. Browser
  Back/Forward and ordinary browser tabs provide concurrent navigation;
  Foundation has no internal document tab strip or workspace restoration.
- Foundation is a single-user, single-operator product, but the same Vault may
  be open in multiple browser tabs. Note saves remain conditional on the base
  Object working revision across those tabs; a stale tab cannot silently
  overwrite a newer canonical revision.
- Foundation provides no collaborative cursors, presence, edit locks, shared
  drafts, operational transform, CRDT, or real-time multi-user editing.
- Notes excludes Daily and archived Human Notes. Inbox is the Core Model's
  derived view of captured Human Notes. Types and operator-authored Saved Views
  are evaluated through the same projection/query contract and never store
  membership.
- Properties and relationships appear in an on-demand document inspector. The
  release has no permanent AI, Review, or evidence sidecar.
- Browser edits save automatically into the server-owned Vault worktree.
  Writes carry the base Object working revision, and the server never silently
  overwrites a newer revision.
- Autosave uses a configurable policy whose Foundation defaults are a
  1.5-second trailing debounce and a 10-second maximum dirty age. Note
  switching, internal navigation, and explicit `Cmd/Ctrl+S` save flush
  immediately; page background or close attempts a best-effort flush and warns
  while a draft remains dirty.
- Each note has at most one in-flight save. Later changes are coalesced, and
  the server persists complete Markdown through atomic replacement before
  returning the new Object working revision.
- Search and structured note lists use a disposable in-memory projection built
  from canonical Markdown at Vault startup and updated after successful saves.
  HTTP and UI layers query the projection interface rather than scanning the
  repository directly.
- Vault startup fully scans and validates canonical files, accepts valid
  external changes made while the service was stopped, and rebuilds the
  disposable projection. Unknown ordinary frontmatter fields are preserved.
- Foundation does not watch for or reconcile external writes while the service
  is running. Duplicate object IDs, malformed reserved metadata, invalid model
  definitions, and unsafe paths fail startup with actionable CLI diagnostics;
  startup does not auto-repair content or inject missing IDs.
- Foundation search is document-level lexical search over Human Notes and Daily
  Notes, including title, path, frontmatter, and body snippets. It does not
  promise large-Vault performance, advanced ranking, or block-level retrieval.
- Standalone Human Notes are created directly under `human/notes/`. The release
  has no folder tree, folder mutation, note move, or drag-and-drop filesystem
  organization. Types, Inbox, tags, relationships, and search are the primary
  navigation model.
- A new standalone note begins with a collision-safe temporary filename. Its
  first meaningful H1 may rename that file once to a readable slug; title and
  filename evolve independently afterward.
- An explicit rename-to-title operation preserves the object ID, rejects or
  resolves filename collisions deterministically, and updates affected
  human-readable wikilinks as one complete managed operation.
- A standalone Human Note may be archived by setting its lifecycle state to
  `archived`, which removes it from ordinary Notes and Inbox results without
  deleting canonical content.
- A confirmed delete removes the standalone Human Note's Markdown file.
  Incoming links are reported before confirmation but are not silently
  removed; after deletion they remain detectable as unresolved links. Content
  that never reached a checkpoint is not promised to be recoverable.
- Rich editing provides `[[target]]` and `[[target|label]]` autocomplete and
  opens resolved links. It distinguishes ambiguous and unresolved targets and
  may create a missing note from an unresolved target.
- The document inspector shows outgoing links, Organization Model
  relationships, and backlinks. The release has no graph visualization, block
  references, transclusion, or automatic link suggestions.
- Git history is separate from object autosave. The server creates checkpoint
  commits on a configurable schedule whose Foundation default is 30 minutes.
  A clean worktree is a no-op, and ordinary users do not operate Save or Commit
  controls.
- Startup recovery validates and seals a valid dirty canonical worktree left by
  a prior interruption. Clean shutdown may request a checkpoint, but recovery
  does not depend on shutdown hooks running.
- The scheduler and a deterministic manual test/operator trigger invoke the
  same checkpoint use case, so tests never wait for wall-clock scheduling.
- An owner-only HTTP operation exposes the manual checkpoint trigger. It
  reports whether a commit was created, the resulting commit SHA when present,
  the changed-file count, and a clean-worktree no-op result. The release does
  not require a CLI wrapper or Web checkpoint control.
- Git history, diffs, rollback, branches, remotes, and commits have no ordinary
  Web UI in Foundation. Operators may inspect the repository with the system
  Git CLI; later product history must avoid exposing raw Git mechanics.
- A stale save pauses autosave for that note and opens a content-level conflict
  dialog that preserves the local draft. The user may adopt current canonical
  content, explicitly replace it with the draft against the latest revision,
  or combine current and draft manually before retrying.
- Closing the conflict dialog does not discard the draft. Foundation performs
  no automatic three-way merge and exposes no Git branch or merge terminology
  in this flow.
- Desktop Web is the only release target. Mobile usability and responsive
  product design are deferred.
- Current stable Chrome/Chromium desktop is the only supported browser target.
  Automated browser acceptance covers at least 1280x720 and 1440x900
  viewports. Safari, Firefox, mobile browsers, and installed-PWA behavior are
  not release targets.
- The primary distribution is an npm package containing the server, prebuilt
  Web assets, and a `fumori` CLI. Operators use the CLI to bootstrap a Vault and
  start the service; Node.js 24 LTS and the system Git CLI are runtime
  prerequisites.
- Development uses the source `pnpm` workflow without a container. Operators
  own process supervision, TLS, gateway authentication, and filesystem
  permissions.
- Linux x64 and arm64 are supported server runtimes. macOS arm64 is supported
  for development, local use, and package smoke testing. GitHub Actions runs
  the Node.js 24 build, test, and packed-artifact checks on Linux and macOS;
  Windows and WSL are not release targets.
- `fumori serve` binds to `127.0.0.1` by default. Listening on a non-loopback
  interface requires explicit operator configuration and a warning that
  Foundation provides neither authentication nor TLS and must run behind a
  trusted network or authenticated gateway.

## Explicitly deferred

- AI providers, AI Threads and Runs, AI Knowledge, Knowledge compilation,
  cited Knowledge answers, and AI Review or Change Proposals
- Source capture, Source records, capture provenance, and Source refresh
- Attachment ingestion, asset management, and inline file or media previews
- Remote push, remote backup, encrypted backup, restore, and recovery UI
- Vault Catalog, Vault switching, Web-based Vault creation, Vault import,
  restore, fork, trash, and purge
- Content migration from generic Markdown directories, Anytype, historical
  notes, bookmarks, or other external sources
- Web-based Organization Model editing, schema migration, and reconciliation
  workflows
- Advanced rich-editor constructs and interactions, including tables, math,
  Mermaid, HTML blocks, media blocks, and a broad slash-command library
- SQLite/FTS or another persistent query database, semantic retrieval,
  embeddings, and vector indexes
- Folder browsing and folder mutation UI
- Note trash, restore-from-trash, and retention or automatic-purge behavior
- Native clients, client-side Git synchronization, and offline-first behavior
- Safari, Firefox, mobile-browser, and installed-PWA compatibility
- Required OCI images, Docker Compose distribution, Docker Hub publication, and
  Kubernetes manifests
- Git history, diff, rollback, branch, remote-status, and commit UI
- Internal document tabs, pinned tabs, and restored multi-document workspaces

The constrained rich editor is a core product capability rather than optional
visual polish. Foundation deliberately starts with a narrow round-trippable
formatting surface instead of postponing rich editing or presenting a split
Markdown preview.

Folder management is deferred without deciding that Fumori will never expose
it. Physical placement remains non-semantic: a future file move must not change
object identity, type, lifecycle, relationships, or derived-view membership.

Internal multi-document tabs are an important future workspace capability, not
a permanent non-goal. Their deferral keeps Foundation from owning multiple
dirty editor buffers before the save and conflict contracts are proven.

## Planning completion

The implementation-repository interview has resolved the release scope,
desktop information architecture, editing boundary, import boundary, and
measurable acceptance contract that the research handoff deliberately
deferred. No Foundation product-boundary question remains open. Detailed
engineering design belongs to the implementation spec.

## Acceptance approach

Foundation is not accepted through unit tests or mocked storage alone. Its
critical journeys run against a temporary real Git repository, a real Fumori
server process, and a desktop browser.

End-to-end verification must:

- bootstrap an empty Git repository and start the configured Vault;
- pack the npm artifact and smoke its installed `fumori` CLI, server, and
  bundled Web assets outside the source checkout;
- create, edit, link, find, archive, and delete canonical notes through the
  browser;
- trigger autosave and checkpoints deterministically;
- inspect the resulting Markdown, frontmatter, and Git commits directly;
- discard disposable projection state, restart the server, and prove that
  navigation and query state rebuild from the repository;
- submit a stale Object working revision and prove that newer canonical content
  is not silently overwritten; and
- open the same note in two browser tabs, edit from both revisions, and prove
  that the later stale save preserves its draft and enters the defined content
  conflict flow rather than overwriting the first tab's accepted save.

Visual polish may additionally require human review, but canonical data, save,
Git, recovery, and navigation contracts require automated verification.

### Bounded workload

The deterministic Foundation fixture contains 1,000 standalone Human Notes,
365 Daily Notes, no more than approximately 25 MB of Markdown, and 5,000 mixed
wikilinks or relationships across representative types, states, tags, and
unresolved targets.

On the designated CI or reference profile:

- cold startup plus full in-memory projection rebuild completes within 5
  seconds;
- lexical search responds within 200 milliseconds at P95;
- an already-projected note API read responds within 100 milliseconds at P95;
- a canonical save responds within 500 milliseconds at P95, excluding the
  configured editor debounce;
- a manual dirty checkpoint completes within 3 seconds; and
- a desktop route transition completes within 300 milliseconds at P95,
  excluding initial server startup.

Changing these budgets requires an explicit performance-baseline update rather
than silently removing or weakening the acceptance checks.

Vault bootstrap accepts only an empty Git repository. Foundation content is
created through Fumori after bootstrap; opening an existing canonical Vault or
migrating arbitrary content belongs to a later release.

## Research evidence

- [`Tolaria Autosave and AutoGit Evidence`](../research/tolaria-autosave.md)
  records the inspected upstream timing, flush, write, and checkpoint behavior
  that informed Fumori's autosave defaults.
- [`Tolaria Concurrent Editing Evidence`](../research/tolaria-concurrent-editing.md)
  records Tolaria's independent-window, filesystem-watcher, and unconditional
  editor-write behavior that informed Fumori's stricter multi-tab boundary.
