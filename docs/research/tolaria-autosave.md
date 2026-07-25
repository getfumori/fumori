# Tolaria Autosave and AutoGit Evidence

## Inspection snapshot

- Inspected on: 2026-07-25
- Official repository: [`refactoringhq/tolaria`](https://github.com/refactoringhq/tolaria)
- Revision: [`a904e2f96ae634c05155abdf05a89456a8f54f52`](https://github.com/refactoringhq/tolaria/tree/a904e2f96ae634c05155abdf05a89456a8f54f52)
- Commit date: 2026-07-24
- Tag at that revision: `alpha-v2026.7.24-alpha.0004`
- Sources used: the official repository, its bundled ADRs and architecture notes, and the official documentation at [`tolaria.md`](https://tolaria.md/)

Unless a section is explicitly labeled as inference, the statements below describe the inspected Tolaria revision.

## Editor-to-disk timing

Tolaria does not write on every keystroke. Its current save pipeline has separate editor-buffer and persistence stages:

| Editing surface | Editor-to-app-state stage | App-state-to-disk stage | Approximate idle time from the last ordinary keystroke to the start of a disk save |
| --- | --- | --- | --- |
| Rich editor | 1.5-second trailing debounce before serializing BlockNote to Markdown | 1.5-second trailing debounce before calling `save_note_content` | About 3.0 seconds |
| Raw Markdown editor | 500-millisecond trailing debounce before publishing the CodeMirror document | 1.5-second trailing debounce before calling `save_note_content` | About 2.0 seconds |

The rich-editor debounce is defined in [`src/hooks/editorChangeDebounce.ts` lines 3-38](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/editorChangeDebounce.ts#L3-L38). The persistence debounce is defined in [`src/hooks/useEditorSave.ts` lines 34-40 and 242-265](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L34-L40), with each content change replacing the pending content and resetting that timer in [lines 531-564](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L531-L564). The raw editor's first-stage 500-millisecond debounce is in [`src/components/RawEditorView.tsx` lines 34-76 and 150-187](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/components/RawEditorView.tsx#L34-L76).

Tolaria's architecture document describes the two-stage rich-editor pipeline: coalesce change events before Markdown serialization, then wait another 1.5-second idle window before `save_note_content` ([`docs/ABSTRACTIONS.md` lines 812-814](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/ABSTRACTIONS.md#L812-L814)). ADR-0102 superseded the original 500-millisecond persistence decision with the 1.5-second idle window ([`docs/adr/0102-low-end-safe-autosave-idle-window.md` lines 1-28](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0102-low-end-safe-autosave-idle-window.md#L1-L28)).

### Maximum wait

No maximum-wait timer is present in either ordinary debounce path. Both implementations clear and restart a single trailing timer on each change. Therefore, continuous editing can postpone ordinary autosave indefinitely until an explicit flush boundary occurs. The persistence tests explicitly verify that each content change resets the timer ([`src/hooks/useEditorSave.test.ts` lines 465-509](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.test.ts#L465-L509)).

## Explicit flush boundaries

Tolaria bypasses the normal idle wait in these cases:

- Manual save (`Cmd+S`) cancels the pending persistence timer and saves immediately ([`src/hooks/useEditorSave.ts` lines 489-528](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L489-L528); regression test at [`src/hooks/useEditorSave.test.ts` lines 548-563](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.test.ts#L548-L563)).
- Switching notes first flushes the rich/raw editor buffer into app state and then awaits persistence for the note being left ([`src/App.tsx` lines 511-537](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/App.tsx#L511-L537); [`src/hooks/useAppSave.ts` lines 533-574](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAppSave.ts#L533-L574)). An official smoke test verifies that raw edits reach disk without waiting for the debounce window ([`tests/smoke/save-before-note-switch.spec.ts` lines 201-219](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/tests/smoke/save-before-note-switch.spec.ts#L201-L219)).
- Note mutations and destructive note actions use the same flush-before-action path ([`src/App.tsx` lines 531-537 and 1161-1168](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/App.tsx#L531-L537)).
- Entering raw mode, changing the active path, or unmounting the rich editor flushes pending rich-editor serialization ([`src/hooks/editorChangeDebounce.ts` lines 40-75](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/editorChangeDebounce.ts#L40-L75)).
- Manual save and unmount flush the raw editor's 500-millisecond editor-buffer stage into app state ([`src/components/RawEditorView.tsx` lines 168-187](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/components/RawEditorView.tsx#L168-L187)).

No content-save flush is registered for window blur, document visibility change, or browser/page unload in the inspected save pipeline. Blur and visibility listeners belong to AutoGit checkpoint scheduling, not note persistence ([`src/hooks/useAutoGit.ts` lines 147-174](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAutoGit.ts#L147-L174)). If the entire `useEditorSave` hook unmounts, it clears the persistence timer rather than performing a final disk save; this is asserted by [`src/hooks/useEditorSave.test.ts` lines 577-588](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.test.ts#L577-L588).

## In-flight saves and conflicts

Tolaria has renderer-side stale-save protection:

- Two flush requests for the same buffered snapshot share one in-flight promise ([`src/hooks/useEditorSave.ts` lines 157-167 and 292-325](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L157-L167)).
- If an older save resolves after newer content has become pending, the old completion cannot clear the newer pending buffer or replace current in-memory tab state. The newer content remains scheduled for a later save ([`src/hooks/useEditorSave.ts` lines 210-239 and 651-660](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.ts#L210-L239); test at [`src/hooks/useEditorSave.test.ts` lines 430-463](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useEditorSave.test.ts#L430-L463)).
- External-vault refresh preserves dirty local editor content and only replaces a clean active note from disk ([`docs/ABSTRACTIONS.md` lines 612-614](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/ABSTRACTIONS.md#L612-L614)).

Tolaria does **not** expose a compare-and-swap save contract. The Tauri command accepts only `path`, `content`, and optional `vault_path`; it does not accept a base revision, expected hash, or expected prior content ([`src-tauri/src/commands/vault/file_cmds.rs` lines 227-240](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/commands/vault/file_cmds.rs#L227-L240)). The repository has a separate content-validation command, but the save command does not call it ([`src-tauri/src/commands/vault/file_cmds.rs` lines 203-240](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/commands/vault/file_cmds.rs#L203-L240)). Consequently, the inspected implementation does not reject a save because another process or window changed the file after it was loaded.

## Filesystem write behavior

The native save function:

- validates and creates missing parent directories;
- rejects read-only targets;
- writes the full content with Rust's direct `fs::write`;
- retries transient permission/access-denied failures after 25, 50, 100, and 200 milliseconds, then makes one final attempt.

See [`src-tauri/src/vault/file.rs` lines 8-53 and 134-171](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/vault/file.rs#L8-L53).

There is no application-level temporary-file-plus-rename operation in this save path. It is therefore a direct truncate/write rather than an atomic replacement. Note creation is separately guarded with `create_new(true)`, so it refuses to overwrite an existing file ([`src-tauri/src/vault/file.rs` lines 173-195](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src-tauri/src/vault/file.rs#L173-L195)).

## AutoGit checkpoint timing and configuration

AutoGit is separate from autosave. The [official guide](https://tolaria.md/guides/commit-and-push) says that it commits and pushes saved local changes after an idle pause or after the app becomes inactive.

Verified configuration and behavior:

- AutoGit is installation-local and disabled by default. The default thresholds are 90 seconds of editor inactivity while the app is active and 30 seconds when the app is inactive. Both thresholds are user-configurable positive integers ([`src/components/SettingsPanel.tsx` lines 204-230](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/components/SettingsPanel.tsx#L204-L230); [`src/components/GitSettingsSection.tsx` lines 134-180](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/components/GitSettingsSection.tsx#L134-L180)).
- A checkpoint is eligible only when AutoGit is enabled, the vault is Git-backed, saved Git work is pending, and there are no unsaved editor changes ([`src/hooks/useAutoGit.ts` lines 24-55](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAutoGit.ts#L24-L55); wiring at [`src/App.tsx` lines 1013-1049](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/App.tsx#L1013-L1049)).
- The scheduler polls once per second. Window focus/blur and document visibility select the active `idle` or inactive `inactive` threshold. Elapsed time is measured from the last recorded meaningful editor activity, not from the blur event itself ([`src/hooks/useAutoGit.ts` lines 65-89 and 100-174](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAutoGit.ts#L65-L89)).
- Each activity burst can trigger at most once until new activity is recorded; failed checkpoint attempts are also marked handled for that burst ([`src/hooks/useAutoGit.ts` lines 104-131](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAutoGit.ts#L104-L131); tests at [`src/hooks/useAutoGit.test.ts` lines 36-51 and 106-119](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useAutoGit.test.ts#L36-L51)).
- The shared automatic checkpoint path prevents overlapping checkpoints, uses deterministic `Updated N note(s)` / `Updated N file(s)` messages by default, commits locally when no remote exists, and uses the remote-aware commit/push path when a remote exists ([`docs/adr/0067-autogit-idle-and-inactive-checkpoints.md` lines 20-38](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/docs/adr/0067-autogit-idle-and-inactive-checkpoints.md#L20-L38); [`src/hooks/useCommitFlow.ts` lines 512-564](https://github.com/refactoringhq/tolaria/blob/a904e2f96ae634c05155abdf05a89456a8f54f52/src/hooks/useCommitFlow.ts#L512-L564)).

## Implications for Fumori (inference)

Tolaria's numbers should be treated as evidence, not copied as a single `1.5s`
setting: its effective rich-editor and raw-editor disk latencies include two
debounce stages. Fumori should measure the complete interval from a dirty rich
editor buffer to a durable server save and keep the meaning of its configured
debounce explicit.

Tolaria is a single-user desktop app and does not provide a base-revision save
guard or atomic replacement. Those omissions are not evidence that Fumori's
server-authoritative, multi-tab Web architecture should omit optimistic
revision checks or atomic filesystem writes. Fumori additionally needs an
explicit browser-close/crash boundary because Tolaria's inspected save path has
no blur, visibility, or unload flush and cancels its persistence timer on full
hook unmount.

Finally, AutoGit should remain a separate checkpoint policy over already-saved files. Tolaria's defaults—90 seconds active-idle and 30 seconds inactive—are useful comparison points, but they solve Git-history cadence rather than editor durability.
