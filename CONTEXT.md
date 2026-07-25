# Personal Second Brain

A private, user-controlled system for capturing, developing, and retrieving one person's notes and knowledge across devices.

## Language

**Self-hosted knowledge system**:
A server-first knowledge system whose authoritative data store and service lifecycle are controlled by the user. It may call user-configured external AI providers without transferring custody of the system's stored data or credentials to the product operator.
_Avoid_: Cloud notes, local-only notes

**Authoritative data store**:
The copy of notes, attachments, indexes, and account data held on the user's own server and treated as the source of truth by every client.
_Avoid_: Sync folder, master files

**Trusted server**:
The user's self-hosted server, which is trusted to read and process stored knowledge, including sensitive content. Privacy comes from user-controlled hosting and access rather than from hiding all content from the server.
_Avoid_: Zero-knowledge server, untrusted cloud

**Plaintext local custody**:
The accepted at-rest boundary in which canonical Markdown, Git objects,
indexes, AI runtime, and local Secret bindings may be plaintext on the trusted
server. The product relies on operator-controlled OS permissions, full-disk
encryption, snapshots, and physical security rather than E2E encryption or an
application Vault-unlock layer.
_Avoid_: Zero-knowledge storage, application-managed local encryption, encrypted remote backup

**Sensitive content**:
Private material such as credentials, financial records, or intimate journal entries that may live in a note but requires explicit scoping before it is disclosed to an AI provider or operational logs.
_Avoid_: End-to-end encrypted content, password vault entry

**AI-redacted span**:
An explicitly marked inline or multi-block Markdown range stored in plaintext
between `<!-- ai:omit -->` and `<!-- /ai:omit -->`. Owner reads and search retain
the content, while every product-controlled AI retrieval, model, Web-query
generation, compilation, review, and AI-safe API sees a constant
`[AI-REDACTED]` placeholder and cannot match the hidden value. It is authored
through a `Hide from AI` editor action and is not encryption or a password
vault.
_Avoid_: General block ACL, masked-at-rest secret, automatic secret detection

**Content-free operational log**:
Local service telemetry limited to identifiers, operation names, status,
latency, sizes, provider/model names, token or cost totals, and subsystem
health. It excludes note titles, paths, bodies, search terms, URLs, prompts,
model messages, tool inputs or outputs, HTTP bodies, and secrets. Full Pi
session content remains separate Vault-scoped runtime data.
_Avoid_: AI transcript log, request-body log, remote product analytics

**AI provider**:
An interchangeable external or self-hosted model service configured only when a Vault enables its optional AI capability and authorized directly by the user. A task may send it explicitly scoped note content needed to produce a result.
_Avoid_: Built-in AI backend

**External egress channel**:
Any destination outside the trusted server that may receive knowledge-derived
data, including an external model, Web Search provider, fetched URL host,
plaintext backup target, or remote telemetry. An AI Run freezes all of its
channels before retrieval; local-only content is eligible only when none can
carry its content or a derived query outward.
_Avoid_: Model-only disclosure check, prompt-created network tool, hidden search-provider egress

**Knowledge client**:
The single responsive web application exposed by the trusted server and opened from desktop or mobile browsers at the same URL. Optional PWA installation and recent-data caching do not create separate native clients or an offline-first requirement.
_Avoid_: Desktop client, mobile client, native app

**Ephemeral knowledge client**:
The first-version browser storage boundary in which the PWA may cache only its
static application shell. Knowledge bodies, Sources, attachments, search
results, AI responses, and Vault metadata remain memory-resident for the open
page and use no-store responses rather than persistent browser caches. Opening
content still discloses it to the local device and its administrator or
extensions.
_Avoid_: Offline Vault, IndexedDB note cache, protection from a compromised browser

**Passive attachment**:
A Vault attachment treated strictly as user-controlled data rather than
application code. Safe raster images, audio, video, and PDF may render inline;
HTML, SVG, scripts, executables, and ambiguous formats download with attachment
disposition and MIME-sniffing disabled. The server never executes uploaded
content, regardless of filename or repository metadata.
_Avoid_: Executable notebook asset, trusted SVG, inline arbitrary HTML attachment

**Gateway-protected origin**:
The single-user HTTP origin exposed by the Vault Service only behind an
operator-controlled trust boundary such as Cloudflare Zero Trust, an
authenticating reverse proxy, VPN, or private network. The product does not own
browser accounts, login, TLS termination, MFA, rate limiting, or Web sessions;
any request that reaches this origin is treated as the owner. Direct exposure of
the bare listener to an untrusted network violates the deployment contract.
_Avoid_: Public application server, built-in account system, anonymous public endpoint

**Gateway-authenticated caller**:
A browser or machine client admitted by the operator's perimeter. A verified
human identity establishes an Interactive Owner channel, while a verified
machine identity establishes an Agent channel. Browser sessions and gateway
machine credentials belong to the gateway; the application still requires one
explicit Vault context and enforces revision, AI effect, Change Proposal, and
operation-specific boundaries without introducing user accounts or roles.
_Avoid_: Application account, ambient Vault, caller-selected trusted identity header

**Interactive Owner channel**:
The request authority used for direct human actions such as editing Human
Notes, deciding Review, or changing Vault configuration. It is established by
a trusted Web entrypoint rather than a caller-selected field. Starting an AI
Run from this channel does not transfer human write authority into the Run.
_Avoid_: Browser User-Agent, AI acting as human, request-body actor flag

**Agent channel**:
The request authority used by external Agents, Codex skills, automation, and
every product-owned AI Run. It may use authorized retrieval and managed AI
Knowledge operations, but Human Notes, Today, and Organization Model changes
remain Change Proposals regardless of who initiated the Run.
_Avoid_: Human editor, unrestricted machine caller, prompt-selected authority

**External Agent tool call**:
One bounded, sessionless request and final response on the Trusted Agent
Entrypoint. Codex, Claude Code, or another external runtime owns its own
conversation, planning, retry loop, and task lifecycle; the Vault Service
retains no Thread, Run, or generic asynchronous Operation for that caller.
Idempotency preserves a completed mutation outcome across transport retry
without turning the call into server-owned workflow state.
_Avoid_: Hosted Agent session, resumable external Run, server-owned Agent plan

**Trusted Agent Entrypoint**:
An optional separately reachable application boundary whose admitted requests
authenticate with an Agent API credential and always create an Agent channel.
Its caller cannot select or upgrade that channel, and it shares the same Vault
behavior and transport contracts as the Web entrypoint rather than forming a
second Agent-specific knowledge system. Plain HTTP use asserts an
operator-trusted network; the credential authenticates the caller but does not
provide transport confidentiality.
_Avoid_: Shared unauthenticated Web and Agent entrypoint, Agent-supplied role, parallel Agent backend

**Agent API credential**:
A server-issued, named machine credential for one external Agent. It is shown
once, stored only as a verification hash, independently revocable, and limited
to an explicit Vault allowlist. It always establishes the Agent channel and has
no finer first-version capability scopes; operation authority still comes from
the Agent channel and scoped VaultHandle. Credentials are server-local and do
not enter, clone, fork, or restore with any Vault repository.
_Avoid_: Shared global API key, Interactive Owner credential, OAuth grant, Vault content

**Managed Change Set**:
An idempotent, all-or-nothing batch submitted by an Agent channel to create,
revise, or remove authorized AI Knowledge and Source content without per-item
human approval. It carries base revisions, rationale, and evidence as
applicable, receives system provenance for the Agent credential and channel,
and reaches canonical state only after complete staging, validation, and one
Vault Transaction. Human Notes, Today, and Organization Model targets are
outside its authority and require a Change Proposal.
_Avoid_: Agent object PUT, partial batch write, Human Note patch, Pi session requirement

**Vault**:
The complete canonical, runtime, and security isolation unit for one body of knowledge. It owns a canonical Markdown Git repository and history, Organization Model and configuration, runtime indexes, AI jobs and cursors, backup state and targets, credential references, locks, migration state, and access context. A worker scoped to one Vault receives no ambient ability to read or modify another.
_Avoid_: Folder, workspace view, repository alone, shared runtime partition

**Vault Catalog**:
The minimal server-global registry used to discover and open Vaults. It registers the stable Vault identity and mutable display metadata from the canonical Vault Manifest together with local lifecycle state and storage location, but stores no note content, shared knowledge index, cross-Vault AI state, or secrets. The catalog is reconstructible by importing repositories rather than being the sole source of Vault identity.
_Avoid_: Global knowledge database, cross-Vault index, Vault content registry

**Vault Manifest**:
The canonical, Git-tracked `.second-brain/vault.md` document containing the Vault's stable identity, display name, format version, creation metadata, and portable non-secret configuration or references to it. Restoring the repository preserves this identity; explicitly forking it creates a new identity and records the source Vault and commit. The identity scopes APIs and jobs but is not an Organization Model schema ID.
_Avoid_: Catalog-only identity, mutable folder name as identity, secret-bearing config

**Secret binding**:
A trusted-server-local mapping from a Git-tracked logical secret reference to a
provider, backup, or encryption credential stored outside every Vault
repository. Version one may use an owner-only local file, environment variable,
or mounted platform secret without pretending that same-host application
encryption protects against a compromised server. Restore and fork leave
bindings unresolved until explicitly rebound.
_Avoid_: Secret in Git, copied fork credential, recoverable full-secret UI

**Backup Recovery Kit**:
A small owner-exported recovery artifact containing a Vault's identity, backup
target locator, backup-format and password-KDF parameters, encrypted Backup
Master Key envelope, root manifest verification data, and restore instructions.
It contains neither knowledge content, plaintext keys, the user passphrase, nor
remote-provider credentials. An Encrypted Git remote is not reported as
recovery-ready until the owner has downloaded and acknowledged a current Kit;
the passphrase and remote credentials remain separately recoverable.
_Avoid_: Vault export, plaintext key backup, passphrase file, server-only recovery metadata

**Backup Master Key**:
A random per-Vault secret used to protect Encrypted Git remote data.
The owner passphrase is processed by a versioned memory-hard KDF to produce a
wrapping key that authenticated-encrypts this master key; it does not directly
encrypt every artifact. The trusted server keeps the usable master key in its
Secret Store for unattended backups, while the remote and Backup Recovery Kit
contain only its encrypted envelope. Changing the passphrase rewraps the master
key; losing both the server copy and passphrase makes recovery intentionally
impossible.
_Avoid_: Passphrase as content key, global Vault key, vendor recovery key, recoverable backdoor

**Local-first Vault creation**:
The default creation path that initializes a new Git repository directly on the trusted server, writes its Vault Manifest and Core Model or selected Preset, and creates an initial commit without requiring any remote. A Remote Backup Target may be attached later; cloning a remote is an import or restore path, not the definition of creating a Vault.
_Avoid_: Mandatory GitHub repository, remote-first workspace, browser-side git init

**Vault restore**:
Registering and reconstructing the same logical Vault from its canonical
repository while preserving its Vault identity, configuration, and Git history.
The service first restores into isolated staging, validates repository and Vault
integrity, then atomically registers it and rebuilds disposable projections.
Secret bindings remain unresolved and dependent features stay disabled until
the owner rebinds them. A server never overwrites or merges into a live Vault
with the same identity; a collision requires explicit recovery of the existing
registration, inactive replacement, or a Vault fork.
_Avoid_: Import as duplicate, automatic new identity, implicit merge, in-place live overwrite

**Vault fork**:
Creating a new isolated Vault identity from an existing Vault or commit. The new Vault records source provenance but receives no active secret bindings, remote backup activation, runtime state, or ambient access to the source Vault.
_Avoid_: Restore, shared worktree, copied remote credentials, alias of Primary Vault

**Vault context**:
The single explicit Vault identity bound to every web route, API request, tool call, event stream, AI job, and capability token. Browser tabs may independently address different Vaults, but no request searches, resolves links, runs Views, or reads objects across Vault boundaries. An Agent authorized for multiple Vaults makes separately authorized and audited calls for each identity and combines results only in its own task context.
_Avoid_: Session-global current Vault, cross-Vault query, global knowledge index, ambient second Vault

**Vault trash**:
The reversible first phase of Vault deletion. Trashing revokes Vault-scoped capabilities, stops writes, AI jobs, checkpoints, and remote backup activity, hides the Vault from the ordinary selector, and retains its local repository, runtime state, and secret bindings for a configurable retention period. Restoring re-registers the Vault and rebuilds disposable projections as needed.
_Avoid_: Archive folder, immediate data deletion, active backup while trashed

**Vault purge**:
The separately confirmed irreversible deletion of a trashed Vault's local repository, runtime state, and Vault-scoped secrets after jobs and capabilities have been terminated. A minimal Catalog tombstone prevents stale work from targeting a reused identity. Purge detaches but never automatically deletes a remote backup; remote destruction is a distinct explicit operation.
_Avoid_: One-click permanent delete, cascading remote deletion, identity reuse

**Repository-complete recovery**:
The Vault durability contract that a fresh server can clone or import the canonical repository and reconstruct the same knowledge, attachments, Organization Model, non-secret policies, schema/migration version, and Git history without access to the failed server's runtime state. Indexes, embeddings, links, Views, cursors, job queues, locks, caches, and health status are disposable projections or restartable processes. Secret values are the sole intentional exception: unresolved references leave provider and backup features safely disabled until the user rebinds them.
_Avoid_: Runtime database as source of truth, index backup as required recovery input, silently missing configuration

**Repository-native portability**:
The rule that the canonical Git repository is itself the complete portable Vault artifact. Version one introduces no proprietary Vault export format or Web export workflow: users may use standard Git clone, Git bundle, or filesystem backup according to their operational needs. Plain working-tree copies remain readable Markdown but preserve history only when the Git repository is included.
_Avoid_: Proprietary Vault bundle, second canonical backup format, mandatory product Export

**Vault import**:
The staged registration of a canonical Vault repository supplied from a local Git repository or remote Git URL. The service copies or clones it into controlled staging, validates Git integrity, the Vault Manifest and format version, reserved paths, unsafe links, and identity collisions, then atomically moves it into service-managed storage and registers it as restore or explicit fork. Secret references remain unresolved and disabled until rebound. A generic Markdown directory without a Vault Manifest is content migration, not Vault import.
_Avoid_: In-place arbitrary repository mount, implicit restore-or-fork choice, importing secrets, treating any Markdown folder as a Vault

**Primary Vault**:
The Vault containing the user's real long-lived second brain.
_Avoid_: Production folder, main notebook

**Test Vault**:
An ordinary isolated Vault used by developers for experiments, migrations, and destructive validation without exposing the Primary Vault. It has no special product data model or first-version seeding UI. Repository-level development tooling may safely create a snapshot fixture with a new Vault identity, no copied runtime or secrets, and no active remote; normal Vault import performs the final identity and isolation checks.
_Avoid_: Test folder, sandbox mode, product-only Vault kind, recursive copy of a live Vault directory

**Checkpoint commit**:
A server-created Git commit that seals the current canonical Vault worktree into a durable revision. Ordinary edits save continuously without creating commits; by default the server checks every 30 minutes, commits only when canonical files changed, and does nothing when the worktree is clean. The server also creates explicit boundaries around review, schema migration, bulk import, accepted multi-file Change Proposals, and successful AI Knowledge maintenance. Checkpoint timing is server policy rather than a user-facing save control.
_Avoid_: Save, manual commit, per-edit commit, sync event

**Object working revision**:
The cryptographic hash of one Durable Object's current canonical bytes, returned as its revision or ETag and recomputable directly from the repository worktree. Every write supplies the base revision it observed and succeeds only if the current hash still matches, then atomically replaces the file and returns a new hash. It provides per-save optimistic concurrency without making runtime state authoritative.
_Avoid_: Modification time, runtime-only version counter, last-write-wins, Git commit per save

**Vault history revision**:
A Git commit that identifies a durable whole-Vault history boundary for checkpointing, rollback, citations, Processing cursors, migration, import, and multi-object operations. It is distinct from Object working revision: many immediately durable autosaves may occupy the canonical worktree before the next history revision seals them.
_Avoid_: Autosave token, editor revision, content hash of one object

**Request read set**:
The immutable collection of exact object or block bytes and Object working revisions supplied to one transient read-only AI question. It freezes what that request sees without creating a Git commit; a citation can detect that the current source has since changed but does not promise historical replay after the answer is discarded.
_Avoid_: Git checkpoint per chat, moving prompt input, durable evidence snapshot

**Durable evidence snapshot**:
The Git commit tree sealed before an AI maintenance run, saved research artifact, Review, or Change Proposal that must remain reproducible. Persistent citations resolve through this Vault history revision, while later application of proposed writes still revalidates current target object revisions.
_Avoid_: Request-local citation, live worktree read, long-running moving snapshot

**Recovery checkpoint**:
The event commit created after startup scans a valid dirty canonical worktree left by a server crash or shutdown before the periodic checkpoint. The service preserves those saved files, validates and rebuilds projections, and seals them rather than silently reverting to the previous Git commit.
_Avoid_: Crash rollback, discarding dirty worktree, treating HEAD as the only saved state

**Content conflict**:
The user-facing result when a write's base Object working revision is stale and its changes overlap newer canonical content. The server never applies last-write-wins. A browser retains its draft and may use its base snapshot plus the current object for a safe non-overlapping three-way merge; overlapping changes enter a content-level Review offering current, draft, or manual combination without exposing Git branches or merge mechanics. Agents must re-read and regenerate a patch.
_Avoid_: Git conflict, silent overwrite, forced save, CRDT

**Managed repository access**:
The deployment boundary in which the Vault Service account is the sole ordinary writer to a running Vault worktree. Humans and tools may read it directly, but live writes use revision-aware API or companion CLI operations. Raw filesystem edits are normal only while the service is stopped and are imported by a startup scan; mutations detected while running are treated as an exceptional recovery event that pauses writes and requires reconciliation. Administrators who grant other processes write permission explicitly bypass this guarantee.
_Avoid_: Shared writable sync folder, watcher as concurrency protocol, ambient shell write access

**Data-only repository**:
The rule that Markdown, attachments, Git metadata, and imported repository
configuration are never trusted as executable instructions. The non-root
service confines resolved paths to one Vault root, invokes Git without a shell,
disables repository hooks and executable filters or helpers, and gives child
processes only the exact environment and credential required for one operation.
_Avoid_: Executable notebook, arbitrary path API, repository-controlled Git process

**Repository Coordinator**:
The single per-Vault authority that schedules worktree publication and every operation that mutates Git index, refs, or repository structure. Revision-checked writes to different objects may prepare concurrently, while same-object writes serialize; checkpoint snapshots and Vault Transactions briefly take an exclusive publish barrier. Remote backup consumes committed refs only and never reads or blocks the dirty worktree.
_Avoid_: Git CLI from arbitrary worker, shared repository lock race, backup of dirty files

**Vault transaction**:
An all-or-nothing multi-object operation for an accepted AI Change Proposal, schema migration, bulk import, or other coherent rewrite. It prepares and validates changes in an isolated staging tree, briefly acquires a Vault write barrier, seals pending autosaves into a pre-operation checkpoint, revalidates every target object's base revision, and publishes one complete event commit. A journal guarantees crash recovery to a complete before or after state; any stale target aborts the entire operation rather than overwriting human work or leaving partial files.
_Avoid_: Sequential write loop, long-lived edit lock, partial migration, one commit per file

**Compensating revision**:
A new object save or Vault Transaction that restores content from an earlier history revision or applies the inverse of a prior event commit without rewriting Git history. It preserves later history and remote/citation targets; if subsequent edits overlap the inverse patch, the conflicting portion enters content Review rather than being forcibly reset.
_Avoid_: Git reset, force push, history rewrite, destructive checkout

**Processing cursor**:
The exact Git commit successfully processed by one named incremental purpose,
such as Review recent changes or Knowledge compilation. Each purpose owns its
own cursor and advances it only at that purpose's success point. A new Run first
seals a boundary commit, then examines the commit range from its cursor to that
boundary so changed files are neither omitted nor repeatedly inferred from
calendar dates.
_Avoid_: Today's files, last modified timestamp, dirty-worktree scan

**Remote backup target**:
A user-configured, server-managed destination that asynchronously receives committed Vault history, with retries, last-successful-backup health, integrity verification, and a tested restore path. Checkpoint creation never waits for remote availability, and remote backup is not a browser synchronization protocol.
_Avoid_: Client sync, synchronous push, manual backup

**Remote recovery point**:
The exact Checkpoint commit whose encrypted or plaintext backup has completed
upload and remote verification. Catastrophic loss of the trusted server
guarantees recovery only through this commit: later autosaves and local commits
that have not reached a verified Remote recovery point may be lost. Under normal
operation the target follows the default 30-minute checkpoint cadence; a remote
outage extends the window and must remain visible as degraded backup health
without blocking local edits or commits.
_Avoid_: Latest autosave guarantee, last attempted upload, hidden backup lag

**Backup health**:
The content-free operational view of one Remote Backup Target: latest local
Checkpoint, latest Remote recovery point, lag in commits and elapsed time, last
attempt time and error, and any Remote backup divergence. It may offer an
explicit retry but reveals no changed paths, filenames, note titles, or
knowledge content.
_Avoid_: Backup file browser, content-bearing error, hidden recovery lag

**Remote backup divergence**:
The safety state entered when a Remote Backup Target is ahead of, has diverged
from, has moved behind, or contains history unrelated to the expected Remote
recovery point. Normal backup permits only forward advancement from that point
and never pulls, merges, or force-pushes. Divergence stops remote publication
without blocking local work; recovery reconstructs the remote into isolation
before the owner explicitly restores, forks, replaces, or reinitializes the
target.
_Avoid_: Backup sync conflict, automatic remote merge, silent force push

**Encrypted Git remote**:
A Remote Backup Target implemented by an independently versioned Git-compatible
CLI or alternative repository CLI. The Vault Service treats its encryption,
object/pack transport, opaque naming, manifest, and reconstruction format as an
external capability contract rather than implementing another snapshot,
generation, or retention system. The trusted server's canonical repository
remains ordinary plaintext Git; the untrusted remote receives no plaintext Git
objects, original paths, commit messages, note content, or attachments and
cannot browse or directly clone the Vault. Restore uses the companion CLI,
Backup Recovery Kit, passphrase, and remote credentials to reconstruct a normal
Git repository.
_Avoid_: Encrypted snapshot hierarchy, GitHub private repository alone, whole-Vault git-crypt, second history model

**Recovery verification**:
The distinction between mandatory per-publication verification and optional
end-to-end exercises. A Remote recovery point advances only after the target
confirms the intended commit is recoverably present. A Restore Test may
automatically reconstruct that point into temporary isolated storage and
validate Git plus Vault integrity; a Recovery Drill may additionally exercise
the owner's separately held Recovery Kit, passphrase, and remote credentials.
Neither full exercise is required to enable backup, and both retain only a
content-free outcome.
_Avoid_: Unverified successful push, mandatory monthly restore, registering a test clone as a live Vault

**Git history retention**:
The version-one policy that every commit reachable from the Vault's canonical
refs remains part of local and remote recovery history. Ordinary note deletion
adds a new state but does not erase older content. The product applies no
age-, count-, or size-based history truncation; irreversible erasure would be a
separate explicit history-rewrite procedure.
_Avoid_: Backup retention window, delete means purge, automatic shallow history

**Modular monolith**:
The first-version deployment shape: one TypeScript server process and application package contains HTTP delivery, background scheduling, AI orchestration, and isolated Vault instances behind explicit internal interfaces. The Vue Web/PWA is a separate browser build target served by that process. Heavy work may later move to an external command or process, but normal orchestration has no distributed worker system.
_Avoid_: Microservices, Redis job cluster, package per internal concern, browser/server code mixing

**Vault Module**:
The deep per-Vault module that owns canonical objects, Organization Model behavior, repository and revisions, transactions, projections and search, subscriptions, and enforcement of Vault knowledge policies. Its interface hides Markdown parsing, Git CLI, filesystem, Repository Coordinator, and index implementation so callers cannot coordinate or bypass them independently.
_Avoid_: Repository service, parallel Document and Search services, storage plugin layer

**VaultManager**:
The small server-global module that owns Vault Catalog and lifecycle operations and opens a VaultHandle for an authorized actor and one explicit Vault identity.
_Avoid_: Global knowledge service, cross-Vault query coordinator, God application module

**VaultHandle**:
The actor- and capability-scoped interface to exactly one Vault Module, used in-process by HTTP handlers and background work for read, query, execute, and subscription behavior. External clients reach the same behavior through the typed HTTP interface; a handle has no ambient ability to select another Vault.
_Avoid_: Raw repository handle, HTTP client, unscoped Vault singleton

**Organization Model**:
The Vault-owned, editable definition of its types, properties, relationships, lifecycle, templates, and views. Its canonical files live with the notes under `.second-brain/model/` in the Vault repository, so Git versions knowledge and the model that interprets it together. It shapes how Human Notes are understood without changing the canonical object format, and an optional AI capability may read it as organizing context.
_Avoid_: Folder structure, hard-coded ontology, Organization Profile

**Core Model**:
The minimal Organization Model installed into every Vault. It provides the core properties `type`, `state`, `tags`, and `aliases`; the captured, organized, and archived Knowledge Lifecycle; an Inbox Saved View over captured standalone Human Notes; and Today/Daily Notes. It contains no domain Types, custom Properties, Relationships, or Templates, and the Vault may customize it after creation.
_Avoid_: Hidden preset, hard-coded Portent, empty schema

**Blank Vault**:
A Vault created without an optional Preset. It begins with only the Core Model, so capture, Today, lifecycle state, Inbox, tags, and ordinary linking work immediately without imposing Portent, PARA, or another organization style.
_Avoid_: Empty repository, schema-free Vault, Minimal preset

**Preset**:
An optional installable extension to the Core Model, such as Portent or PARA, copied into a Vault at creation and then owned and independently customized by that Vault. A Preset enriches the starting Types, Properties, Relationships, Templates, Views, and lifecycle configuration without becoming a permanent mode or dependency.
_Avoid_: Plugin, permanent dependency, application mode, Core Model

**Schema key**:
A human-readable identifier such as `project` or `belongs_to` that is written directly in Markdown and serves as the identity of a type, property, relationship, lifecycle state, or other Organization Model definition. Schema definitions do not receive a parallel opaque ID.
_Avoid_: Schema ID, hidden definition ID, display label

**Primary type**:
The single optional `type` value that describes what a Durable Object fundamentally is, such as `note`, `project`, or `device`. Captured objects may remain untyped, while further classification belongs in properties, tags, or relationships.
_Avoid_: Parent type, multiple types, class inheritance

**Type definition**:
A structured Markdown model document identified by a human-readable schema key. It owns the definitions, ordering, defaults, and advisory or explicitly required rules for that Type's custom properties, and may reference separate templates or views. It may contain a short human/AI-readable description, but it is not a Durable Object or an ordinary knowledge page.
_Avoid_: Type note, class, implicit frontmatter convention, database schema

**Core property**:
A small application-level field whose meaning is consistent for every Durable Object, such as `type`, `state`, `tags`, or `aliases`. Core properties are part of the canonical object and Organization Model contract rather than being redefined by each Type.
_Avoid_: Custom property, Type-owned field

**Knowledge lifecycle**:
The single Vault-wide attention lifecycle stored in `.second-brain/model/lifecycle.md` and represented on objects by the core `state` property. The Core Model distinguishes captured, organized, and archived knowledge; a Vault or Preset may customize those human-readable states and any dependent Views. Domain status such as a device being under repair or a project being paused belongs in a Type property instead.
_Avoid_: Type lifecycle, workflow status, device status, project status

**Type property**:
A custom property definition embedded directly in one Type definition, with a human-readable key, value kind, options or taxonomy, default, display order, and advisory or required rules. It has no standalone file, registry entry, or opaque ID; the same key on another Type is an independent definition.
_Avoid_: Global property, shared property, Property object

**Relationship definition**:
A Vault-wide Organization Model document stored as `.second-brain/model/relationships/<key>.md`, defining an object-reference key, its cardinality, inverse, and advisory target constraints. It has no opaque ID or knowledge lifecycle. Presets may supply relationships such as Portent's `belongs_to` and `related_to`; relation instances remain human-readable wikilinks in ordinary object frontmatter, while inverse edges are derived. Custom relationship creation is an advanced capability.
_Avoid_: Core property, Type-owned property, hard-coded Portent relation

**Saved view**:
A Git-tracked declarative query stored as `.second-brain/model/views/<key>.md`, containing filters, grouping, sorting, layout, and visible-column preferences but no stored membership. Results are derived from canonical Markdown and rebuildable indexes. Temporary UI filters become a Saved View only by explicit user action.
_Avoid_: Folder, collection with members, materialized list, transient filter

**QuerySpec**:
The bounded declarative filter, boolean composition, ordering, and pagination
language shared by a Saved View and a transient structured query. It addresses
Organization Model fields and derived object metadata rather than a storage
engine, executable expression language, full-text search, graph traversal, or
cross-Vault join.
_Avoid_: SQL contract, JavaScript predicate, regex program, Search query, recursive graph query

**Template**:
A Vault-owned starter for creating a Durable Object. Applying a template copies its initial frontmatter and body once; the resulting Markdown is independent and is never silently changed when the template later evolves.
_Avoid_: Live template, inherited document, synchronized boilerplate

**Taxonomy property**:
A property whose human-readable values form a configurable hierarchy for classification, filtering, and tree views, such as `device_kind: router`. The hierarchy lives in the Organization Model and does not create subtype inheritance.
_Avoid_: Subtype, folder tree, type hierarchy

**Tag**:
An open-by-default, human-readable, flat marker used for lightweight cross-cutting discovery. Object-level tags live in frontmatter; inline tags retain their block location. A derived Tag Catalog supports suggestions, rename, merge, and reconciliation without turning tags into types, lifecycle states, taxonomy nodes, or Topic objects.
_Avoid_: Status, subtype, folder path, implicit Topic

**Schema migration**:
An explicit, previewable rewrite offered when an Organization Model change would invalidate or reinterpret existing Markdown. The user may apply it immediately, defer it, or keep the affected notes unchanged; Git makes the result reviewable and reversible.
_Avoid_: Silent rewrite, automatic schema upgrade

**Reconciliation**:
A repeatable, runtime-derived diagnostic process that compares Markdown against the current Organization Model, reports unknown or invalid schema keys and values, and offers repair or migration choices without silently changing authored knowledge. Its report is rebuildable and is not canonical repository data unless explicitly exported.
_Avoid_: Validation failure, background cleanup

**Today**:
The adjustable default home and human-authored chronological capture surface for the current day. Today is one ordinary date-based Human Note; its entries may contain thoughts, records, pasted links, or links to other notes without becoming separate objects or entering a special processing workflow. AI assistance and Review may appear around it, but cannot write into its note body without a Change Proposal.
_Avoid_: Daily dashboard, mandatory journal, Inbox

**Today entry**:
An ordinary Markdown fragment written into Today. It has no independent lifecycle, type, provenance record, or promotion state. When an entry deserves expansion, the user creates and links an ordinary Human Note using the same editing and wikilink tools available everywhere else.
_Avoid_: Capture item, promotable block, automatic extraction

**Review recent changes**:
A user-started Foreground AI conversation over authorized Vault changes since
its last successful Processing cursor. It begins with a catch-up summary but may
continue into clarification, Web research, and deeper exploration. The
conversation is disposable runtime state and creates no Daily Summary object;
only results the user explicitly asks to retain become AI Knowledge, Sources,
or a Change Proposal.
_Avoid_: Scheduled daily report, Daily Summary type, review inbox item

**Review recent changes Run**:
The proposal-capable Foreground AI Run that hosts Review recent changes. Its
effect class is a fixed ceiling rather than an instruction to write: ordinary
conversation remains transient, an explicit request may preserve Sources or AI
Knowledge through one validated transaction, and any requested Human Note or
Today change can only become a Change Proposal in the same conversation.
_Avoid_: Read-only thread that must restart to save, automatic daily write, direct Human Note edit

**Recent review cursor**:
The Processing cursor advanced to a Review recent changes Run's boundary commit
only after its complete initial catch-up summary is successfully delivered to
the present user. Failure or cancellation before delivery leaves it unchanged;
later conversation continues against the same evidence snapshot without
blocking the cursor.
_Avoid_: Selected calendar day, thread-close marker, per-entry reviewed state

**Recent review baseline**:
The explicit initial starting point chosen when no Recent review cursor exists.
It defaults to the beginning of the current Vault-local day and may instead be
a recent interval, selected date, or the current boundary with no retrospective
summary. Later historical reviews use independent ranges and do not move the
ordinary cursor.
_Avoid_: Implicit full-Vault review, Vault creation commit, compilation baseline

**Recent review summary**:
The initial response that completes a Review recent changes Run's catch-up
phase. It separates authored and captured input under Your changes from a brief
AI activity account of generated objects changed in the same commit range.
Generated activity remains inspectable but is not relabelled as human input or
reused as primary evidence.
_Avoid_: Daily report object, mixed authorship summary, AI approval queue

**Today context**:
The configurable set of deterministic Saved Views shown only alongside the
current day's Today to resurface current Vault state, such as open Markdown
checkboxes, captured Inbox notes, recent objects, and Preset-defined pending
work. An unresolved result may therefore appear across successive days until it
changes in its source object. It works without AI and does not turn Today or the
Vault into a replacement task manager.
_Avoid_: Copied task list, AI-generated daily dashboard, Today body content

**Inbox**:
The Core Model Saved View of standalone Human Notes whose Knowledge Lifecycle state is `captured`. Inbox is an attention queue derived from canonical Markdown, not a folder, Type, storage location, or container with membership. Creating from Inbox and the global New Note action both create a standalone Human Note in the captured state; Today entries are not Inbox items.
_Avoid_: Inbox folder, Inbox type, Daily Notes, stored collection

**Contextual creation**:
A note-creation action whose visible navigation context supplies explicit initial semantics. Creating from a Type assigns that `type` and applies its optional Template; unless the Template says otherwise, the new standalone Human Note remains `captured`. Creating from Inbox or using global New Note assigns `state: captured`. Context supplies defaults but does not create a distinct object format or storage location.
_Avoid_: Empty-then-classify workflow, folder-based creation, implicit query inference

**Authored knowledge**:
Content deliberately written or accepted by the user as part of their own knowledge base. Its human authorship remains distinguishable from AI-generated material even when both are related or displayed together.
_Avoid_: AI output, generated note

**Generated material**:
Content proposed by an AI provider and retained with explicit machine provenance until the user reviews and accepts it into authored knowledge. It must not silently become indistinguishable from the user's own writing.
_Avoid_: Authored knowledge, automatic note

**Generated workspace**:
The bounded area in which AI may create and revise generated material autonomously. AI may read explicitly authorized authored knowledge, but may affect authored knowledge only by proposing a reviewable change.
_Avoid_: AI folder, autonomous knowledge base

**Optional AI capability**:
A per-Vault capability that is disabled until configured and is not required for capture, editing, types, relationships, lifecycle, views, search, or Graph navigation. Enabling it may add knowledge answers, generated work, research, and editor assistance, but does not expand AI's authority over Human Notes or Today.
_Avoid_: Core dependency, mandatory provider, AI-first storage

**Vault AI prompt**:
A Git-tracked, user-editable Markdown instruction that shapes one AI purpose,
such as Review recent changes, knowledge compilation, or resurfacing, within capabilities
already granted by its AI Run. It may define focus, method, output preference,
domain guidance, and examples, but cannot expand effect class, tools, Vault or
object scope, provider disclosure, budget, citation, provenance, or Review
rules.
_Avoid_: System security policy, runtime chat message, authority-bearing prompt

**Prompt revision**:
The exact Git revision of a Vault AI prompt frozen into one AI Run and recorded
with any durable generated outcome. Editing a prompt affects later Runs but
does not reset an existing cursor or silently reinterpret prior AI Knowledge;
historical recompilation is a separate explicit, cost-visible operation.
_Avoid_: Mutable live prompt, automatic AI Knowledge migration, compilation cursor

**Interactive AI suggestion**:
An AI-generated insertion or edit offered inside the current Human Note editing flow. It enters authored knowledge only when the user explicitly accepts it; AI never applies it proactively or edits the note directly.
_Avoid_: Inline autonomous edit, background rewrite

**Change proposal**:
A reviewable, attributable set of additions, edits, moves, or deletions that AI proposes against authored knowledge. A pending proposal is a Git-tracked canonical artifact under `.second-brain/reviews/` containing its base commit, target object revisions, patch or structured operations, rationale, citations, scope, and state. Reaching Review disposes the Pi AgentSession; the proposal may wait indefinitely without compute. Acceptance revalidates and transacts it, rejection records the decision, and stale targets require refresh rather than overwrite.
_Avoid_: Automatic edit, background rewrite, live waiting process, runtime-only decision

**Review decision**:
The explicit resolution of a Change Proposal. Accept revalidates and applies the complete proposal; Reject closes it without target changes; Revise records feedback or selected operations as a newly validated successor; Refresh reruns a stale proposal against current content. The original becomes accepted, rejected, or superseded and is never partially or silently mutated. Applied work is undone only through a compensating revision.
_Avoid_: Raw partial patch, reopen applied proposal, in-place authorship conversion

**Knowledge answer**:
An AI response grounded in authorized authored knowledge and linked back to the passages that support it. It is the system's primary AI capability.
_Avoid_: Generic chatbot response, generated note

**Answer grounding**:
The visible account of which evidence boundary a Knowledge answer actually
used. The default Vault-first policy searches authorized Vault knowledge and
may enrich an insufficient answer through an already-authorized external
search tool or clearly identified model knowledge; Vault-only forbids both.
Claims distinguish Vault-grounded, Web-enriched, and Model-supplemented
material instead of giving non-Vault assertions false Vault citations.
_Avoid_: Hidden web enrichment, citation laundering, one undifferentiated answer source

**Core retrieval**:
The non-AI Vault capability that finds authorized knowledge through lexical
content, structured properties, aliases, wikilinks, and declared
relationships. It remains complete and useful without an AI provider or
semantic embeddings and always returns canonical object, revision, and source
location references with its matches.
_Avoid_: Vector search, model-dependent search, cross-Vault search

**Lexical retrieval**:
The first-version text-matching part of Core retrieval. It supports mixed
Chinese and English substring search, weighted title and heading matches, and
a bounded fallback for very short queries without requiring language-specific
segmentation or an AI model.
_Avoid_: Semantic retrieval, mandatory Chinese dictionary, raw Markdown syntax search

**Vault retrieval projection**:
The single disposable per-Vault query model derived from canonical Markdown.
It serves Core retrieval across Human Notes, Sources, and AI Knowledge while
preserving each result's Knowledge Space, authorization policy, canonical
revision, and source location. It is never evidence, a backup, or a
cross-Vault index; deleting and rebuilding it must not change knowledge or
citations.
_Avoid_: Canonical knowledge database, global search database, separate graph service

**Retrieval watermark**:
The Vault history revision through which the Vault retrieval projection is
known to reflect canonical knowledge. Autosaved worktree changes after that
commit may remain absent from Vault-wide search until the next checkpoint and
projection update; callers can observe the watermark and pending-change state
rather than assuming search is current.
_Avoid_: Object working revision, hidden indexing lag, per-save index revision

**Search refresh**:
The user-facing request to make current saved knowledge available to
Vault-wide search and AI retrieval before the normal checkpoint cadence. The
server creates a checkpoint when needed, updates the Vault retrieval
projection, and advances its Retrieval watermark; the user does not manage Git
staging, commit messages, or repository history through this action.
_Avoid_: Manual Git commit, per-save indexing, index-only refresh

**Indexed block**:
A Markdown-semantic passage projected for retrieval together with its owning
object, heading path, source range, text hash, Object working revision, and
optional stable block identity. Indexing a passage does not itself modify
Markdown or require every paragraph to receive an explicit ID; a durable block
identity is added only when a persistent citation must survive later edits.
_Avoid_: Arbitrary token chunk, database-owned content, mandatory block ID

**Retrieval role**:
The purpose for which a retrieved passage may be used. Human Notes and Sources
may be evidence when policy permits; AI Knowledge is generated material that
may guide discovery, answer navigation, deduplication, and managed updates but
cannot validate its own claims. The spaces share one index and ordinary search
UI while tools preserve this role on every result.
_Avoid_: Separate corpus service, AI Knowledge as primary evidence, hidden generated origin

**Graph navigation**:
The explicit traversal of authorized wikilink and declared-relationship edges
from known objects. It provides backlinks, related objects, and bounded
neighborhood expansion without silently changing first-version lexical ranking
according to link count or an opaque graph score.
_Avoid_: Graph database, PageRank, automatic graph-ranked search

**Semantic retrieval**:
An optional AI-era retrieval enhancement that finds conceptually related
passages through embeddings and may contribute candidates to a combined search.
It is not required to create, open, rebuild, search, or recover a Vault, and its
derived data may be discarded or replaced without affecting canonical
knowledge or citations.
_Avoid_: Core retrieval, canonical vector store, required Vault index

## Knowledge Spaces

**Durable Object**:
A knowledge item that has its own stable identity, lifecycle, relationships, and revision history. A fragment inside Today is not a Durable Object; the user may manually create and link a separate Durable Object when an idea needs independent development.
_Avoid_: File, block, database row

**Human Notes**:
The Portent-organized space for journals, ideas, explanations, records, and other knowledge authored or explicitly accepted by the user. AI may read it under the Vault's policy, but the user owns its write authority.
_Avoid_: Source archive, AI Wiki

**Sources**:
The space for captured external material whose chosen preserved representation and provenance are stored as evidence. Each Source is a self-describing Markdown record under `sources/records/` with a structured `source` profile rather than `type: Source`; optional original payloads live under `sources/files/`. AI may read and interpret a Source but must not rewrite it.
_Avoid_: Bookmark list, Human Notes

**URL Capture**:
The explicit action that turns a bare URL into a Source. Merely pasting a URL into Today or a Human Note does not capture it. After successful capture, the selected URL becomes a readable wikilink to the Source record; an authorized AI research job may perform the same action when it actually uses the page as evidence. Dedicated browser and share-sheet integrations are later conveniences rather than prerequisites.
_Avoid_: Browser bookmark sync, web clipper

**Transient URL research**:
The authorized fetching of a pasted URL inside a Foreground AI conversation
without changing its containing note or creating a Source. A Vault AI prompt
may guide which links deserve inspection, but any external page that ultimately
supports durable AI Knowledge must first be preserved through URL Capture.
_Avoid_: Automatic Source capture, durable uncited web claim, pasted-link side effect

**Source capture mode**:
The declared preservation strength of a Source. Web capture defaults to `markdown`, which stores extracted readable Markdown and its provenance/hash without retaining the fetched HTML payload. `snapshot` stores the same extracted Markdown plus the original fetched payload and its own integrity metadata; the default may be overridden per capture or Vault. Binary evidence such as PDFs and images preserves the original file by default. A citation can claim only what the preserved representation supports.
_Avoid_: Implicit missing attachment, unlabelled lossy copy, universal raw snapshot

**Capture revision**:
One immutable preserved representation of a Source at a particular retrieval time and Git revision. Refreshing a Source whose content hash changed creates a new Capture Revision under the same Source identity; an unchanged hash is a no-op. Citations remain pinned to the exact object, block, and revision they used even when a newer capture becomes current.
_Avoid_: Silent overwrite, one Source per refresh, floating evidence

**AI Knowledge**:
The AI-owned space in which authorized agents use the same Markdown, Type, property, relationship, Template, and View substrate available elsewhere in the Vault. The system enforces the Human/AI write-authority boundary, but does not hard-code Memory Record and Compiled Knowledge Page as object kinds; AI may create and evolve suitable Types and schemas under Vault guidance. Users may read and request changes through AI maintenance, but do not directly edit managed object bodies; taking ownership creates a separate Human Note.
_Avoid_: Separate AI database, hard-coded AI object taxonomy, Human Notes, directly edited wiki

**AI write provenance**:
The small, system-recorded audit envelope attached to content written into AI Knowledge through an authorized agent or API. It records at least the responsible actor, write channel, and time independently of any AI-chosen Type or schema. Its precise Markdown shape remains an implementation decision; it is an authorship and audit boundary, not a Memory or Wiki taxonomy.
_Avoid_: AI-chosen authorship, mandatory Memory schema, relying only on chat history

**AI Access Gateway**:
The mandatory policy-enforcement boundary through which every AI or external Agent searches, reads, cites, or writes Vault knowledge using application-defined tools or the typed HTTP API. Only the trusted Vault Service may access the canonical Markdown Git worktree; AI workers and model providers receive no direct filesystem access and see only policy-authorized tool results. Search, indexes, embeddings, wikilink expansion, and citation resolution must obey the same boundary.
_Avoid_: Giving an AI the repository path, shell access to the Vault, frontmatter-only access control, provider-side filtering

**AI read policy**:
A Vault-wide default governing whether knowledge may be withheld from AI, read
only by local or self-hosted models, or sent to an explicitly authorized
external provider. An individual Durable Object may declare a stricter override
that AI cannot relax, and an AI-redacted span is omitted from every AI channel.
Version one otherwise has no general block-level policy or ACL.
_Avoid_: Treating all private notes as provider-readable, AI-controlled policy relaxation, block-level ACLs in version one

**AI disclosure default**:
The explicit per-Vault choice made when an external AI provider is enabled:
ordinary objects are either external-allowed, local-only, or withheld unless
they declare a stricter object override. External-allowed is the recommended
usable default for a Vault intended for provider-grounded answers, but is never
inferred merely from adding credentials.
_Avoid_: Silent provider consent, automatic secret detection, object policy that widens the Vault default

**Disclosure policy change**:
A forward-looking update to the AI read policy applied to subsequent search and
read tool calls. It does not erase content already present in a Pi session,
cancel the active Run, or retract data already sent to an external provider; a
user who needs a clean boundary closes that thread and starts another.
_Avoid_: Retroactive provider deletion, automatic Run cancellation, session scrubbing

**Effective retrieval scope**:
The authorized object set computed for one actor, Vault, and AI Run disclosure
boundary before ranking, snippets, wikilink expansion, or relationship
traversal. User search may span the Vault, while an AI query excludes objects
with stricter withheld or local-model-only policy than the Run permits.
Filtering the final model response is not a substitute for this scope.
_Avoid_: Post-retrieval redaction, provider-side filtering, metadata leakage

**Retrieval source mode**:
The caller's bounded choice for a cited answer to use only authorized Vault
knowledge or to combine it with Web Search. `vault-only` disables Web retrieval
but does not imply that the selected model is local; provider disclosure remains
an independent consequence of the frozen AI Profile and AI read policy.
_Avoid_: Local execution mode, provider consent, prompt-selected network tool

**AI Thread**:
A disposable Vault-scoped runtime handle over one Pi AgentSession for a
multi-turn product-owned Web AI conversation. It freezes caller channel, AI
Profile, egress channels, maximum effect, and purpose or evidence boundary;
every message creates one AI Run using the same session context. It stores no
second transcript, is not created for an External Agent tool call, and must
promote any durable outcome into Source, AI Knowledge, or a Change Proposal.
_Avoid_: Canonical chat object, second transcript database, cross-Vault conversation, mutable authority

**AI Run**:
The product-owned execution envelope for one message turn or standalone AI
task. It fixes the actor, Vault, maximum effect class, provider disclosure
scope, budget, evidence mode, durable job state, Review path, and final outcome.
A Foreground Run executes against its AI Thread's Pi AgentSession; a standalone
Scheduled Run owns a disposable session for that task. Pi does not own
authorization, canonical writes, Review, or Vault transaction state.
_Avoid_: Pi session as authorization, generic chat session, unbounded autonomous agent

**AI effect class**:
The immutable maximum side effect declared before an AI Run starts. `read-only` returns an answer or suggestion without canonical writes; `managed-write` may transact only inside explicitly authorized Sources or AI Knowledge; `proposal` may describe Human Notes, Today, or Organization Model changes but must stop for Review. A Run cannot promote its own class.
_Avoid_: Tool-discovered permission, dynamic privilege escalation, task-name security policy

**Foreground Run**:
An AI Run explicitly initiated by a present user or caller that can return immediate questions, conflicts, and Review decisions. It is not globally paused by an unrelated pending Change Proposal; its writes still revalidate revisions and surface any proposal they stale or conflict with.
_Avoid_: Scheduled automation, assume-away conflict, bypass Review

**Scheduled Run**:
An unattended AI Run triggered by time or system policy, such as Knowledge
compilation. If any Change Proposal is awaiting decision, repository-writing
scheduled automation stops before creating a Pi AgentSession. Missed triggers
coalesce into one catch-up range from that purpose's last successful Processing
cursor to the latest boundary after Review clears.
_Avoid_: Foreground request, daily stale-job backlog, autonomous writes behind pending Review

**Automation gate**:
The per-Vault gate closed by any unresolved Change Proposal for repository-writing Scheduled Runs. It consumes no model or worker resources and does not block Foreground Runs. Accepting, rejecting, or otherwise resolving all pending proposals reopens it and schedules at most one cursor-based catch-up run.
_Avoid_: Global AI shutdown, object-by-object merge queue, one blocked job per schedule tick

**AI Profile**:
The Vault-configured provider, model, thinking level, and hard execution budget resolved for an AI Run before it starts. A Vault has a default and may override foreground, research, or scheduled-maintenance purposes; a Foreground Run may select another authorized profile. Provider, model, token/turn/cost/time limits, and any explicit fallback allowlist are frozen for the Run. Cross-provider fallback is forbidden by default because it changes disclosure and cost.
_Avoid_: Model chosen by agent, unlimited scheduled run, silent provider fallback

**Pi AgentSession**:
The embedded TypeScript Pi SDK model conversation and custom-tool loop used by
an AI Thread or standalone AI Run for streaming, provider/model execution,
turn-level retries, cancellation, and its execution transcript. Sessions are
isolated per Vault in runtime storage and may be discarded without knowledge
loss; important output becomes AI Knowledge, a Source, or a Change Proposal.
Built-in filesystem, shell, edit, and write tools and ambient resource discovery
are disabled; the active Run injects only approved product tools backed by its
scoped VaultHandle. Tool results include relevant object, block, and revision
references, so the session is sufficient to inspect what the model saw and did
without a parallel disclosure ledger.
_Avoid_: Vault filesystem agent, product job record, Change Proposal state machine

**AI staging area**:
The disposable per-Run workspace into which every Pi custom write tool records candidate Sources, AI Knowledge, or Change Proposals during model execution. Tools cannot mutate the canonical worktree. After the session ends, the product validates the complete staged result and publishes it through one Vault Transaction or persists a validated proposal; failure or cancellation discards the staging area.
_Avoid_: Canonical write tool, partial AI commit, tool-call transaction

**AI Run retry**:
The bounded recovery policy outside Pi's turn-level transient retry. Foreground whole-Run retry requires an explicit user action; a Scheduled Run may restart from the same durable evidence snapshot a limited number of times with backoff and a fresh staging area. Failed scheduled work never advances its Processing cursor. Before retry, transaction recovery determines whether the prior attempt already committed.
_Avoid_: Infinite retry, retry as budget expansion, duplicate transaction

**AI Run cancellation**:
The request to stop an AI Run and discard its staging area before publication. Queued, preparing, running, and validating work can stop immediately and abort Pi; a pending proposal may be explicitly closed. Once a Vault Transaction begins publish, cancellation becomes a recorded request and recovery must determine the complete committed or uncommitted outcome rather than interrupting halfway.
_Avoid_: Half-committed cancellation, cancelled label after commit, process kill as transaction control

**Memory pattern**:
A recommended, configurable AI Knowledge pattern for small durable inputs written through an authorized agent or API. An AI may realize it with a dedicated Type and suitable provenance and citation properties, but the core system does not reserve a Memory object kind or dictate one universal schema.
_Avoid_: Hard-coded Memory Record, implicit model memory, mandatory global Memory type

**Compiled Wiki pattern**:
A recommended, configurable AI Knowledge pattern for discovering latent concepts, claims, and relationships across authorized Human Notes, Sources, and AI-managed inputs. Its primary value is incremental synthesis into useful new knowledge units, not rewriting or mirroring every Human Note as a polished AI article. AI may create Types, properties, relationships, and Views suited to the Vault; guidance requires generated output not to recursively masquerade as primary evidence, without making Wiki Page a hard-coded object kind.
_Avoid_: Hard-coded Wiki Page, primary source, directly edited Wiki page, one generated rewrite per Human Note

**Knowledge compilation**:
The optional Scheduled AI purpose that incrementally maintains the Compiled Wiki
pattern from authorized evidence changed since its last successful Git cursor.
It writes directly within AI Knowledge under managed-write rules, uses existing
AI Knowledge only for deduplication and update targets, and creates no daily
summary or per-result review queue. Crossing into human-owned or Vault-wide
structure still requires a Change Proposal.
_Avoid_: Review recent changes, daily report, AI Knowledge as self-evidence, suggestion inbox

**Compilation invalidation**:
The deterministic expansion from changed, refreshed, or deleted evidence to AI
Knowledge claims that cite it. A compilation reevaluates those generated
targets against current evidence and may update, historicize, downgrade, or
remove them; a pinned historical citation explains an earlier basis but does
not keep a retracted claim current.
_Avoid_: Append-only generated wiki, citation as permanent truth, silent stale claim

**Compilation baseline**:
The explicit starting Git revision chosen when Knowledge compilation is first
enabled. Starting now treats the current Vault as prior context and processes
future evidence changes; compiling the existing Vault authorizes a bounded
historical first pass with visible model cost. Later schedules and manual runs
continue from the last successful compilation cursor.
_Avoid_: Implicit full-Vault scan, AI enablement time, calendar start date

**Claim citation**:
A human-readable Markdown footnote attached to the claim or block it supports and machine-resolved to the cited object's stable identity, exact block, and revision. Multiple nearby claims may share a citation and one claim may cite multiple inputs. A page-level Sources list is a derived View over these citations rather than the authoritative evidence mapping.
_Avoid_: Page-only bibliography, floating latest-source link, uncited generated fact

**Historical citation view**:
The minimal resolution of a persistent Claim citation against the exact Git
revision and repository path it recorded. It shows the cited block as it
existed then, marks it as historical, and links to the current Durable Object.
Version one does not automatically diff, classify, or reconcile later edits and
deletions.
_Avoid_: Floating current-note citation, citation diff workflow, SQLite row lookup

**Epistemic status**:
The visible distinction AI maintains between a claim directly supported by cited material, a synthesis inferred across multiple inputs, and an unverified hypothesis. AI may choose Types and properties that fit the Vault, but it must not present an inference or hypothesis as directly evidenced fact; inferred material cites its basis and may carry confidence or a needs-verification state.
_Avoid_: Hidden inference, false certainty, treating confidence as evidence

**Review**:
The bounded queue of decisions that AI hands back only when an operation crosses an ownership or authorization boundary or has broad structural impact. Ordinary creation, linking, inference, and maintenance inside isolated AI Knowledge take effect without per-item approval and remain inspectable and reversible through provenance and Git history. Human Note changes, destructive bulk rewrites, Vault-wide Organization Model changes, unauthorized scope expansion, and genuine user decisions require review.
_Avoid_: Notification feed, task list, approval for every AI note, low-confidence inbox

## Knowledge Flow

**Human knowledge layer**:
The Portent model applied to Human Notes: types, relationships, and lifecycle organize what the user writes without giving AI direct write access.
_Avoid_: AI Wiki, PARA folders

**Compiled knowledge layer**:
The LLM Wiki-style pattern applied within AI Knowledge: AI incrementally discovers and records cited concepts, claims, and relationships hidden across imperfectly organized Human Notes, Sources, and AI-managed inputs. It reuses the Vault's configurable Organization Model instead of producing a wholesale generated copy of the human corpus.
_Avoid_: Human notebook, transient RAG response
