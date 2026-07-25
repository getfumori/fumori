# Tolaria Concurrent Editing Evidence

## Inspection snapshot

- Inspected on: 2026-07-25
- Official repository: [`refactoringhq/tolaria`](https://github.com/refactoringhq/tolaria)
- Revision: [`a904e2f96ae634c05155abdf05a89456a8f54f52`](https://github.com/refactoringhq/tolaria/tree/a904e2f96ae634c05155abdf05a89456a8f54f52)
- Commit date: 2026-07-24
- Tag at that revision: `alpha-v2026.7.24-alpha.0004`

Unless a section is explicitly labeled as inference or recommendation, the statements below describe the inspected Tolaria revision.

## Short answer

Tolaria does not implement collaborative or conflict-detecting concurrent note editing.

- A single Tolaria window has a single-note model: its `tabs` state contains zero or one note, so the same note cannot be open in two independent editor tabs within that window ([`src/hooks/useTabManagement.ts` lines 103-110 and 469-472](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useTabManagement.ts#L103-L110)).
- The same note can be opened in multiple native note windows. Each window receives a unique label and starts a full, independent `App` instance that reads and writes the same filesystem ([`src/utils/openNoteWindow.ts` lines 38-60](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/openNoteWindow.ts#L38-L60); [`docs/adr/0031-full-app-for-note-windows.md` lines 13-29](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0031-full-app-for-note-windows.md#L13-L29)).
- Separate windows converge through filesystem watcher events. They do not share an editor buffer, object revision, lock, operational transform, CRDT, or conditional-save protocol.
- If two windows edit the same note while both have unsaved changes, either window can later overwrite the other window's saved content without a save conflict. The write that ultimately determines the file depends on the order/race of direct filesystem writes.

## Window and editor state ownership

Secondary note windows are intentionally full application instances. They load their own vault graph, tab state, editor state, unsaved-path set, autosave timer, and content cache. The architecture explicitly says that vault state is loaded independently in each note window and that eventual consistency comes from file watching ([ADR-0031, lines 23-29](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0031-full-app-for-note-windows.md#L23-L29)). ADR-0123 preserves the full graph and watcher scope in every note window rather than introducing shared editor state over IPC ([`docs/adr/0123-full-vault-graph-for-secondary-note-windows.md` lines 16-31](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0123-full-vault-graph-for-secondary-note-windows.md#L16-L31)).

The current window-opening code does not key windows by note path. It creates a new `note-${Date.now()}` label, so repeated "Open in New Window" actions can create independent windows for the same path ([`src/utils/openNoteWindow.ts` lines 42-52](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/openNoteWindow.ts#L42-L52)).

## Cross-window change propagation

Every full App window registers the relevant vault roots. The Rust backend reuses one native watcher per root, records all owning window labels, and emits `vault-changed` through the Tauri app when files change ([`src-tauri/src/vault_watcher.rs` lines 87-118 and 163-220](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/vault_watcher.rs#L87-L118)). Renderer listeners batch watcher paths for 350 milliseconds before reconciling them ([`src/hooks/useVaultWatcher.ts` lines 8-10 and 265-311](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useVaultWatcher.ts#L8-L10)).

Each renderer keeps its own in-memory map of writes it recently initiated and suppresses matching watcher paths for four seconds. That suppression state is local to the hook instance, not a cross-window registry ([`src/hooks/useVaultWatcher.ts` lines 109-177](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useVaultWatcher.ts#L109-L177)). Therefore, a write suppressed as "internal" by its originating window is still treated as an external filesystem change by a sibling window.

Secondary windows reload known changed entries individually, while the main window performs a wider vault refresh. Both paths use the same active-note replacement policy ([`src/utils/noteWindowVaultRefresh.ts` lines 28-58](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/noteWindowVaultRefresh.ts#L28-L58); [`docs/adr/0165-window-owned-vault-watchers-and-main-window-git-background-work.md` lines 16-30](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0165-window-owned-vault-watchers-and-main-window-git-background-work.md#L16-L30)).

### Clean active note

If the active note has no unsaved local edits and a watcher batch names that file, Tolaria reloads and remounts it from disk, even if the editor is focused. It first compares the current tab content with the file to avoid an unnecessary remount when they already match ([`src/App.tsx` lines 573-598](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/App.tsx#L573-L598); [`src/utils/pulledVaultRefresh.ts` lines 132-191](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/pulledVaultRefresh.ts#L132-L191)).

### Dirty active note

If the active note has unsaved local edits, external refresh leaves that editor buffer mounted and does not replace it with the changed disk version ([`src/utils/pulledVaultRefresh.ts` lines 60-70 and 149-157](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/pulledVaultRefresh.ts#L60-L70); decision and consequences in [`docs/adr/0135-clean-active-note-refresh-after-external-edit.md` lines 16-43](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0135-clean-active-note-refresh-after-external-edit.md#L16-L43)).

This protects the local draft from being replaced in memory, but it is not a conflict detector. When that dirty window later autosaves, its complete Markdown snapshot is sent to the normal unconditional save path.

## Save and conflict protocol

The renderer invokes `save_note_content` with the path and complete content. The native command accepts `path`, `content`, and optional `vault_path`; it does not accept an ETag, object revision, expected prior hash, or expected prior content ([`src/hooks/useSaveNote.ts` lines 6-28](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useSaveNote.ts#L6-L28); [`src-tauri/src/commands/vault/file_cmds.rs` lines 227-240](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/commands/vault/file_cmds.rs#L227-L240)).

Tolaria has a `validate_note_content` command, but it is used to validate cached content before opening a note; `save_note_content` does not call it as a write precondition ([`src/hooks/noteContentCache.ts` lines 407-443](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/noteContentCache.ts#L407-L443); [`src-tauri/src/commands/vault/file_cmds.rs` lines 203-240](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/commands/vault/file_cmds.rs#L203-L240)).

The backend writes the full content with direct `fs::write`. There is no per-note lock, server-side serialization queue, or temporary-file atomic replacement in this path ([`src-tauri/src/vault/file.rs` lines 153-170](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/vault/file.rs#L153-L170)).

The renderer does coalesce duplicate in-flight flushes and prevents an older completion in the **same hook instance** from clearing a newer local pending buffer ([`src/hooks/useEditorSave.ts` lines 157-167 and 292-325](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L157-L167)). This is same-window stale-completion protection; it does not coordinate independent App instances.

Git conflict UI addresses pull/merge conflicts, not two windows writing the same working-tree file. It is not part of `save_note_content`.

### Separate MCP write guard

Tolaria's MCP `update_note` tool has a separate, opt-in `expectedMtime` check and uses a temporary-file-plus-rename write. When supplied, a mismatched modification time rejects the agent write and preserves the file; omitting it explicitly selects last-writer-wins behavior ([`docs/adr/0158-vault-write-mcp-tools-update-and-append.md` lines 17-38](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0158-vault-write-mcp-tools-update-and-append.md#L17-L38); [`mcp-server/vault.js` lines 83-104 and 499-532](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/mcp-server/vault.js#L83-L104)).

This protection is not reused by the interactive editor's Tauri `save_note_content` path.

## Other cross-window mechanisms

Tolaria contains a `BroadcastChannel`/`localStorage` cross-window store, but its only production consumers are AI workspace session and pop-out-window context stores. It is not connected to note text, editor revisions, or saves ([`src/lib/crossWindowPersistedStore.ts` lines 12-90](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/lib/crossWindowPersistedStore.ts#L12-L90); production references in [`src/lib/aiWorkspaceSessionStore.ts`](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/lib/aiWorkspaceSessionStore.ts) and [`src/lib/aiWorkspaceWindowSharedContext.ts`](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/lib/aiWorkspaceWindowSharedContext.ts)).

The repository's WebSocket code supports the MCP/UI bridge and AI activity. It does not broadcast note edits or enforce write revisions. Cross-window note convergence is filesystem-watcher based.

## Observable same-note scenario

Given two windows, A and B, that loaded the same note:

1. A begins editing and becomes dirty.
2. B edits and saves a complete Markdown snapshot.
3. A receives the watcher event, but its dirty buffer remains mounted.
4. A later saves its own complete snapshot. The backend does not compare it with B's version, so B's saved changes can be overwritten without a conflict response.
5. If B is clean, B then receives A's watcher event and reloads A's version from disk.

This result follows directly from the dirty-buffer preservation rule plus unconditional full-file writes. If writes overlap closely, the implementation offers no ordering or atomicity guarantee beyond the operating-system calls.

## Test coverage and limitations

The inspected tests verify:

- shared native watchers remain alive until their final owning window closes ([`src-tauri/src/vault_watcher.rs` lines 315-326](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/vault_watcher.rs#L315-L326));
- recent writes are suppressed only by the renderer that marked them ([`src/hooks/useVaultWatcher.test.ts` lines 97-113](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useVaultWatcher.test.ts#L97-L113));
- clean active notes refresh while dirty active notes do not ([`src/utils/pulledVaultRefresh.test.ts` lines 80-111](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/utils/pulledVaultRefresh.test.ts#L80-L111));
- overlapping saves and stale completions are handled within one editor-save hook ([`src/hooks/useEditorSave.test.ts` lines 205-229 and 430-463](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.test.ts#L205-L229)).
- the separate MCP update path rejects a mismatched `expectedMtime` and leaves the original content intact ([`mcp-server/test.js` lines 219-250](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/mcp-server/test.js#L219-L250)).

No test was found that runs two live App renderers editing and saving the same note concurrently. The silent-overwrite conclusion is therefore a source-level consequence of the verified API and refresh contracts, not the result of an upstream two-window end-to-end test.

## Implications for Fumori (recommendation)

Fumori is a server-authoritative Web application, so multiple browser tabs and sessions are a normal operating condition rather than an auxiliary desktop-window edge case. Every note write should carry the base object revision (or an equivalent expected-content token), and the server should reject a stale write instead of overwriting newer canonical content. A rejected write should leave the browser draft intact and expose a resolvable conflict state.

Per-object server-side write serialization and atomic file replacement should protect filesystem integrity, while revision comparison protects user intent. Live update delivery can improve convergence for clean clients, but filesystem watching, WebSocket notifications, or BroadcastChannel messages are not substitutes for a conditional write precondition.
