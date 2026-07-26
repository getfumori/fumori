<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";

import {
  type AppConfig,
  appConfigSchema
} from "../contracts/app-config";
import {
  type NoteConnections,
  type ResolvedWikilink,
  noteConnectionsResponseSchema,
  wikilinkSuggestionListSchema
} from "../contracts/connections";
import { dailyNoteResponseSchema } from "../contracts/daily-note";
import {
  type HumanNoteListItem,
  type HumanNoteResponse,
  humanNoteDeletionImpactResponseSchema,
  humanNoteListResponseSchema,
  humanNoteResponseSchema
} from "../contracts/human-note";
import {
  type OrganizationModelResponse,
  type SavedViewResultResponse,
  type StructuredNoteItem,
  type TypeResultResponse,
  organizationModelResponseSchema,
  savedViewResultResponseSchema,
  typeResultResponseSchema
} from "../contracts/organization-model";
import DocumentInspector from "./DocumentInspector.vue";
import {
  type SearchResult,
  searchResponseSchema
} from "../contracts/search";
import PrimarySidebar from "./PrimarySidebar.vue";
import RawMarkdownEditor from "./RawMarkdownEditor.vue";
import RichMarkdownEditor from "./RichMarkdownEditor.vue";
import {
  type AutosaveController,
  type AutosaveDraft,
  createAutosaveController,
  systemAutosaveClock
} from "./autosave";
import { isRichMarkdownRoundTripSafe } from "./foundation-markdown";

type SaveStatus = "ready" | "dirty" | "saving" | "saved" | "error";
type EditorMode = "rich" | "raw" | "protected";
type KnowledgeMode =
  | "notes"
  | "inbox"
  | "archive"
  | "note"
  | "search"
  | "types"
  | "type"
  | "views"
  | "view";

const humanNoteMatch = window.location.pathname.match(
  /^\/notes\/([0-9a-f-]{36})$/
);
const typeMatch = window.location.pathname.match(/^\/types\/([a-z][a-z0-9_-]*)$/);
const viewMatch = window.location.pathname.match(/^\/views\/([a-z][a-z0-9_-]*)$/);
const mode: KnowledgeMode = humanNoteMatch
  ? "note"
  : typeMatch
    ? "type"
    : viewMatch
      ? "view"
  : window.location.pathname === "/inbox"
    ? "inbox"
    : window.location.pathname === "/archive"
      ? "archive"
    : window.location.pathname === "/search"
      ? "search"
      : window.location.pathname === "/types"
        ? "types"
        : window.location.pathname === "/views"
          ? "views"
      : "notes";

const config = ref<AppConfig>();
const vaultName = ref<string>();
const humanNote = ref<HumanNoteResponse>();
const noteList = ref<HumanNoteListItem[]>([]);
const model = ref<OrganizationModelResponse>();
const typeResult = ref<TypeResultResponse>();
const viewResult = ref<SavedViewResultResponse>();
const searchResults = ref<SearchResult[]>([]);
const searchQuery = ref(new URLSearchParams(window.location.search).get("q") ?? "");
const searchInput = ref<HTMLInputElement>();
const fatalError = ref<string>();
const saveError = ref<string>();
const saveStatus = ref<SaveStatus>("ready");
const autosave = ref<AutosaveController>();
const editorMode = ref<EditorMode>("rich");
const richEditorSafe = ref(true);
const rawDraft = ref("");
const inspectorOpen = ref(false);
const connections = ref<NoteConnections>();
const wikilinkSuggestions = ref<
  Array<{ target: string; title: string; url: string }>
>([]);
const deletionImpact = ref<{
  id: string;
  revision: string;
  incomingLinkCount: number;
}>();
let searchSequence = 0;
const isArchived = computed(
  () =>
    humanNote.value !== undefined &&
    model.value !== undefined &&
    humanNote.value.state === model.value.archivedState
);

const sectionTitle = computed(() => {
  if (mode === "inbox") return "Inbox";
  if (
    mode === "archive" ||
    (mode === "note" && isArchived.value)
  ) {
    return "Archive";
  }
  if (mode === "search") return "Search";
  if (mode === "types" || mode === "type") return "Types";
  if (mode === "views" || mode === "view") return "Views";
  return "Notes";
});
const activeNavigation = computed(() =>
  mode === "inbox"
    ? "inbox" as const
    : mode === "archive" || isArchived.value
      ? "archive" as const
    : mode === "types" || mode === "type"
      ? "types" as const
      : mode === "views" || mode === "view"
        ? "views" as const
        : "notes" as const
);
const statusLabel = computed(() => {
  switch (saveStatus.value) {
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Not saved";
    default:
      return "Saved";
  }
});

function explainError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function configureAutosave(currentNote: HumanNoteResponse): void {
  if (!config.value) {
    throw new Error("Autosave configuration is unavailable");
  }
  autosave.value = createAutosaveController({
    clock: systemAutosaveClock,
    initialRevision: currentNote.revision,
    policy: config.value.autosave,
    async save({ baseRevision, draft, keepalive }) {
      saveStatus.value = "saving";
      saveError.value = undefined;
      try {
        const response = await fetch(`/api/v1/notes/${currentNote.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRevision, ...draft }),
          keepalive
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => undefined)) as
            | { error?: string; message?: string }
            | undefined;
          throw new Error(
            detail?.error === "stale_revision"
              ? "This note changed elsewhere. Reload before saving again."
              : (detail?.message ?? `Save failed (${response.status})`)
          );
        }
        const saved = humanNoteResponseSchema.parse(await response.json());
        if (draft.format === "rich") {
          humanNote.value = {
            ...saved,
            bodyMarkdown: humanNote.value?.bodyMarkdown ?? saved.bodyMarkdown
          };
        } else if (draft.format === "raw") {
          humanNote.value = saved;
          if (rawDraft.value === draft.sourceMarkdown) {
            rawDraft.value = saved.sourceMarkdown;
          }
        } else if (draft.format === "document") {
          humanNote.value = saved;
        }
        richEditorSafe.value = isRichMarkdownRoundTripSafe(saved.bodyMarkdown);
        const listResponse = await fetch("/api/v1/notes", {
          cache: "no-store"
        });
        if (listResponse.ok) {
          noteList.value = humanNoteListResponseSchema.parse(
            await listResponse.json()
          );
        }
        document.title = `${saved.title} — Fumori`;
        await refreshConnections(saved.id);
        saveStatus.value = "saved";
        return { revision: saved.revision };
      } catch (reason) {
        saveStatus.value = "error";
        saveError.value = explainError(reason, "This note was not saved.");
        throw reason;
      }
    }
  });
}

async function refreshConnections(id: string): Promise<void> {
  const response = await fetch(`/api/v1/connections/${id}`, {
    cache: "no-store"
  });
  if (response.ok) {
    connections.value = noteConnectionsResponseSchema.parse(
      await response.json()
    );
  }
}

async function load(): Promise<void> {
  try {
    const [configResponse, vaultResponse, modelResponse] = await Promise.all([
      fetch("/api/v1/config", { cache: "no-store" }),
      fetch("/api/v1/today", { cache: "no-store" }),
      fetch("/api/v1/model", { cache: "no-store" })
    ]);
    if (!configResponse.ok) {
      throw new Error(`Configuration request failed (${configResponse.status})`);
    }
    if (!vaultResponse.ok) {
      throw new Error(`Vault request failed (${vaultResponse.status})`);
    }
    if (!modelResponse.ok) {
      throw new Error(`Organization Model request failed (${modelResponse.status})`);
    }
    config.value = appConfigSchema.parse(await configResponse.json());
    model.value = organizationModelResponseSchema.parse(
      await modelResponse.json()
    );
    vaultName.value = dailyNoteResponseSchema.parse(
      await vaultResponse.json()
    ).vault.name;

    if (mode === "note") {
      const [
        noteResponse,
        notesResponse,
        archiveResponse,
        connectionsResponse,
        suggestionsResponse
      ] = await Promise.all([
        fetch(`/api/v1/notes/${humanNoteMatch![1]}`, { cache: "no-store" }),
        fetch("/api/v1/notes", { cache: "no-store" }),
        fetch("/api/v1/archive", { cache: "no-store" }),
        fetch(`/api/v1/connections/${humanNoteMatch![1]}`, {
          cache: "no-store"
        }),
        fetch("/api/v1/wikilinks/suggestions", { cache: "no-store" })
      ]);
      if (!noteResponse.ok) {
        throw new Error(`Note request failed (${noteResponse.status})`);
      }
      humanNote.value = humanNoteResponseSchema.parse(await noteResponse.json());
      noteList.value = humanNoteListResponseSchema.parse(
        await (
          isArchived.value
            ? archiveResponse
            : notesResponse
        ).json()
      );
      connections.value = noteConnectionsResponseSchema.parse(
        await connectionsResponse.json()
      );
      wikilinkSuggestions.value = wikilinkSuggestionListSchema.parse(
        await suggestionsResponse.json()
      );
      rawDraft.value = humanNote.value.sourceMarkdown;
      richEditorSafe.value = isRichMarkdownRoundTripSafe(
        humanNote.value.bodyMarkdown
      );
      editorMode.value = richEditorSafe.value ? "rich" : "protected";
      document.title = `${humanNote.value.title} — Fumori`;
      configureAutosave(humanNote.value);
      return;
    }

    if (mode === "types" || mode === "views") {
      document.title = `${sectionTitle.value} — Fumori`;
      return;
    }

    if (mode === "type") {
      const response = await fetch(`/api/v1/types/${typeMatch![1]}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Type request failed (${response.status})`);
      }
      typeResult.value = typeResultResponseSchema.parse(await response.json());
      document.title = `${typeResult.value.name} — Fumori`;
      return;
    }

    if (mode === "view") {
      const response = await fetch(`/api/v1/views/${viewMatch![1]}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Saved View request failed (${response.status})`);
      }
      viewResult.value = savedViewResultResponseSchema.parse(
        await response.json()
      );
      document.title = `${viewResult.value.name} — Fumori`;
      return;
    }

    if (mode === "search") {
      document.title = "Search — Fumori";
      if (searchQuery.value) {
        await runSearch();
      }
      return;
    }

    const response = await fetch(
      mode === "inbox"
        ? "/api/v1/inbox"
        : mode === "archive"
          ? "/api/v1/archive"
          : "/api/v1/notes",
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error(`${sectionTitle.value} request failed (${response.status})`);
    }
    noteList.value = humanNoteListResponseSchema.parse(await response.json());
    document.title = `${sectionTitle.value} — Fumori`;
  } catch (reason) {
    fatalError.value = explainError(reason, "This part of the Vault could not be opened.");
  }
}

function markDraftDirty(draft: AutosaveDraft): void {
  if (!humanNote.value || !autosave.value) {
    return;
  }
  saveStatus.value = "dirty";
  saveError.value = undefined;
  autosave.value.change(draft);
}

function updateBody(bodyMarkdown: string): void {
  if (!humanNote.value) {
    return;
  }
  humanNote.value = { ...humanNote.value, bodyMarkdown };
  markDraftDirty(documentDraft());
}

function updateRawSource(sourceMarkdown: string): void {
  rawDraft.value = sourceMarkdown;
  markDraftDirty({ format: "raw", sourceMarkdown });
}

function documentDraft(): Extract<AutosaveDraft, { format: "document" }> {
  if (!humanNote.value) {
    throw new Error("No Human Note is open");
  }
  return {
    format: "document",
    bodyMarkdown: humanNote.value.bodyMarkdown,
    type: humanNote.value.type,
    state: humanNote.value.state,
    tags: humanNote.value.tags,
    aliases: humanNote.value.aliases,
    properties: humanNote.value.properties,
    relationships: humanNote.value.relationships
  };
}

function updateMetadata(
  update: (note: HumanNoteResponse) => HumanNoteResponse
): void {
  if (!humanNote.value) {
    return;
  }
  humanNote.value = update(humanNote.value);
  markDraftDirty(documentDraft());
}

function displayField(item: StructuredNoteItem, field: string): string {
  const value = item.fields[field];
  return Array.isArray(value)
    ? value.join(", ")
    : value === undefined || value === null
      ? "—"
      : String(value);
}

async function createNote(
  context: "global" | "inbox" | "type",
  type?: string
): Promise<void> {
  try {
    await autosave.value?.flush();
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context === "type" ? { context, type } : { context })
    });
    if (!response.ok) {
      throw new Error(`Create failed (${response.status})`);
    }
    const created = humanNoteResponseSchema.parse(await response.json());
    window.location.assign(`/notes/${created.id}`);
  } catch (reason) {
    fatalError.value = explainError(reason, "The note could not be created.");
  }
}

async function openWikilink(target: string): Promise<void> {
  try {
    await autosave.value?.flush();
    if (humanNote.value) {
      await refreshConnections(humanNote.value.id);
    }
    const link = connections.value?.outgoing.find(
      (candidate) => candidate.target === target
    );
    if (link?.status === "resolved" && link.url) {
      await navigateTo(link.url);
      return;
    }
    if (link?.status === "ambiguous") {
      saveError.value = `Wikilink '${target}' matches more than one note.`;
      return;
    }
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "wikilink", target })
    });
    if (!response.ok) {
      throw new Error(`Create failed (${response.status})`);
    }
    const created = humanNoteResponseSchema.parse(await response.json());
    window.location.assign(`/notes/${created.id}`);
  } catch (reason) {
    saveError.value = explainError(reason, "The missing note could not be created.");
  }
}

async function renameToTitle(): Promise<void> {
  if (!humanNote.value) return;
  try {
    await autosave.value?.flush();
    const response = await fetch(
      `/api/v1/notes/${humanNote.value.id}/rename-to-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRevision: humanNote.value.revision })
      }
    );
    if (!response.ok) {
      const detail = (await response.json().catch(() => undefined)) as
        | { message?: string }
        | undefined;
      throw new Error(detail?.message ?? `Rename failed (${response.status})`);
    }
    humanNote.value = humanNoteResponseSchema.parse(await response.json());
    rawDraft.value = humanNote.value.sourceMarkdown;
    configureAutosave(humanNote.value);
    await refreshConnections(humanNote.value.id);
    saveStatus.value = "saved";
  } catch (reason) {
    saveError.value = explainError(reason, "The note was not renamed.");
    saveStatus.value = "error";
  }
}

async function setLifecycleState(state: string): Promise<void> {
  if (!humanNote.value || !model.value) return;
  const archiving = state === model.value.archivedState;
  try {
    await autosave.value?.flush();
    updateMetadata((note) => ({ ...note, state }));
    await autosave.value?.flush();
    await navigateTo(archiving ? "/archive" : "/notes");
  } catch (reason) {
    saveError.value = explainError(
      reason,
      `The note was not ${archiving ? "archived" : "unarchived"}.`
    );
    saveStatus.value = "error";
  }
}

async function prepareDelete(): Promise<void> {
  if (!humanNote.value) return;
  try {
    await autosave.value?.flush();
    const response = await fetch(
      `/api/v1/notes/${humanNote.value.id}/deletion-impact`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error(`Delete impact request failed (${response.status})`);
    }
    deletionImpact.value = humanNoteDeletionImpactResponseSchema.parse(
      await response.json()
    );
  } catch (reason) {
    saveError.value = explainError(
      reason,
      "The note's incoming-link impact could not be checked."
    );
    saveStatus.value = "error";
  }
}

async function deleteHumanNote(): Promise<void> {
  if (!humanNote.value || !deletionImpact.value) return;
  try {
    const response = await fetch(`/api/v1/notes/${humanNote.value.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: deletionImpact.value.revision,
        confirmedIncomingLinkCount: deletionImpact.value.incomingLinkCount
      })
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => undefined)) as
        | {
            error?: string;
            currentIncomingLinkCount?: number;
          }
        | undefined;
      if (
        detail?.error === "deletion_impact_changed" &&
        detail.currentIncomingLinkCount !== undefined
      ) {
        deletionImpact.value = {
          ...deletionImpact.value,
          incomingLinkCount: detail.currentIncomingLinkCount
        };
        throw new Error(
          "Incoming links changed. Review the updated count before confirming again."
        );
      }
      throw new Error(
        detail?.error === "stale_revision"
          ? "This note changed elsewhere. Reload before deleting it."
          : `Delete failed (${response.status})`
      );
    }
    deletionImpact.value = undefined;
    window.location.assign("/notes");
  } catch (reason) {
    saveError.value = explainError(reason, "The note was not deleted.");
    saveStatus.value = "error";
  }
}

async function navigateTo(destination: string): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  window.location.assign(destination);
}

async function switchToRaw(): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  rawDraft.value = humanNote.value?.sourceMarkdown ?? rawDraft.value;
  editorMode.value = "raw";
}

async function switchToRich(): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  editorMode.value = richEditorSafe.value ? "rich" : "protected";
}

async function runSearch(): Promise<void> {
  const sequence = ++searchSequence;
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    window.history.replaceState(null, "", "/search");
    return;
  }
  window.history.replaceState(
    null,
    "",
    `/search?q=${encodeURIComponent(query)}`
  );
  const response = await fetch(
    `/api/v1/search?q=${encodeURIComponent(query)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    if (sequence === searchSequence) {
      fatalError.value = `Search failed (${response.status})`;
    }
    return;
  }
  const results = searchResponseSchema.parse(await response.json());
  if (sequence === searchSequence) {
    searchResults.value = results;
  }
}

async function openSearch(): Promise<void> {
  if (mode !== "search") {
    await navigateTo("/search");
    return;
  }
  await nextTick();
  searchInput.value?.focus();
}

async function flushNow(): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    // The save callback exposes the failure beside the editor.
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey)) {
    return;
  }
  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    void flushNow();
  }
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    void openSearch();
  }
}

function flushForPageExit(): void {
  void autosave.value?.flush({ keepalive: true }).catch(() => undefined);
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!autosave.value?.isDirty()) {
    return;
  }
  flushForPageExit();
  event.preventDefault();
  event.returnValue = true;
}

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("pagehide", flushForPageExit);
  window.addEventListener("beforeunload", handleBeforeUnload);
  await load();
  if (mode === "search") {
    await nextTick();
    searchInput.value?.focus();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("pagehide", flushForPageExit);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  flushForPageExit();
});
</script>

<template>
  <main
    class="app-shell"
    :data-app-ready="
      humanNote !== undefined ||
      mode !== 'note' ||
      fatalError !== undefined
    "
  >
    <PrimarySidebar
      :vault-name="humanNote?.vault.name ?? vaultName"
      :active="activeNavigation"
      @navigate="navigateTo"
      @create="createNote('global')"
    />

    <section
      class="context-zone knowledge-context"
      data-zone="context"
      :aria-label="`${sectionTitle} context`"
    >
      <header class="zone-header">
        <p class="eyebrow">
          {{
            mode === "search"
              ? "Find in Vault"
              : mode === "types" || mode === "type" || mode === "views" || mode === "view"
                ? "Organization Model"
                : "Human Notes"
          }}
        </p>
        <h2>{{ sectionTitle }}</h2>
      </header>

      <template v-if="mode === 'search'">
        <label class="search-field">
          <span class="sr-only">Search notes</span>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="search"
            aria-label="Search notes"
            placeholder="Title, path, metadata, or text"
            @input="runSearch"
          />
        </label>
        <p v-if="searchQuery && searchResults.length === 0" class="empty-copy">
          No matching notes.
        </p>
        <div class="knowledge-list search-results">
          <a
            v-for="result in searchResults"
            :key="`${result.kind}:${result.id}`"
            :href="result.url"
            @click.prevent="navigateTo(result.url)"
          >
            <strong>{{ result.title }}</strong>
            <small>{{ result.canonicalPath }}</small>
            <span>{{ result.snippet }}</span>
          </a>
        </div>
      </template>

      <template v-else-if="mode === 'types' || mode === 'type'">
        <button
          v-if="typeResult && typeResult.key !== 'daily-note'"
          type="button"
          class="context-create-button"
          @click="createNote('type', typeResult.key)"
        >
          New {{ typeResult.name }}
        </button>
        <div class="knowledge-list model-list">
          <a
            v-for="type in model?.types"
            :key="type.key"
            :href="`/types/${type.key}`"
            :class="{ selected: type.key === typeResult?.key }"
            @click.prevent="navigateTo(`/types/${type.key}`)"
          >
            <strong>{{ type.name }}</strong>
            <small>{{ type.key }}</small>
          </a>
        </div>
        <div v-if="typeResult" class="context-section">
          <div class="section-heading">
            <span>Matching notes</span>
            <span class="quiet-count">{{ typeResult.items.length }}</span>
          </div>
          <div class="knowledge-list">
            <a
              v-for="item in typeResult.items"
              :key="item.id"
              :href="item.url"
              @click.prevent="navigateTo(item.url)"
            >
              <strong>{{ item.title }}</strong>
              <small>{{ item.canonicalPath }}</small>
            </a>
          </div>
        </div>
      </template>

      <template v-else-if="mode === 'views' || mode === 'view'">
        <div class="knowledge-list model-list">
          <a
            v-for="view in model?.views"
            :key="view.key"
            :href="`/views/${view.key}`"
            :class="{ selected: view.key === viewResult?.key }"
            @click.prevent="navigateTo(`/views/${view.key}`)"
          >
            <strong>{{ view.name }}</strong>
            <small>{{ view.query.layout ?? "list" }}</small>
          </a>
        </div>
        <div v-if="viewResult" class="context-section">
          <div class="section-heading">
            <span>Results</span>
            <span class="quiet-count">{{ viewResult.items.length }}</span>
          </div>
          <div class="knowledge-list">
            <a
              v-for="item in viewResult.items"
              :key="item.id"
              :href="item.url"
              @click.prevent="navigateTo(item.url)"
            >
              <strong>{{ item.title }}</strong>
              <small>{{ item.canonicalPath }}</small>
            </a>
          </div>
        </div>
      </template>

      <template v-else>
        <button
          v-if="mode === 'notes' || mode === 'inbox'"
          type="button"
          class="context-create-button"
          @click="createNote(mode === 'inbox' ? 'inbox' : 'global')"
        >
          {{ mode === "inbox" ? "Capture note" : "New note" }}
        </button>
        <p v-if="noteList.length === 0" class="empty-copy">
          {{
            mode === "inbox"
              ? "Captured notes will gather here."
              : mode === "archive"
                ? "Archived notes will gather here."
              : "Your standalone notes will gather here."
          }}
        </p>
        <div class="knowledge-list">
          <a
            v-for="item in noteList"
            :key="item.id"
            :href="item.url"
            :class="{ selected: item.id === humanNote?.id }"
            @click.prevent="navigateTo(item.url)"
          >
            <strong>{{ item.title }}</strong>
            <small>{{ item.canonicalPath }}</small>
          </a>
        </div>
      </template>
    </section>

    <article class="document-zone" data-zone="document">
      <header class="document-toolbar">
        <div class="breadcrumb">
          <span class="breadcrumb-dot" aria-hidden="true"></span>
          {{ sectionTitle }}
          <template v-if="humanNote">
            <span aria-hidden="true">/</span>
            {{ humanNote.title }}
          </template>
        </div>
        <div v-if="humanNote" class="document-actions">
          <button
            type="button"
            class="editor-mode-button"
            :aria-expanded="inspectorOpen"
            @click="inspectorOpen = !inspectorOpen"
          >
            Inspector
          </button>
          <button
            type="button"
            class="editor-mode-button"
            @click="renameToTitle"
          >
            Rename file to title
          </button>
          <button
            type="button"
            class="editor-mode-button"
            @click="
              setLifecycleState(
                isArchived
                  ? model!.standaloneCreationState
                  : model!.archivedState
              )
            "
          >
            {{
              isArchived
                ? "Unarchive note"
                : "Archive note"
            }}
          </button>
          <button
            type="button"
            class="editor-mode-button danger-button"
            @click="prepareDelete"
          >
            Delete note
          </button>
          <button
            type="button"
            class="editor-mode-button"
            @click="editorMode === 'raw' ? switchToRich() : switchToRaw()"
          >
            {{
              editorMode === "raw"
                ? "Rich editor"
                : editorMode === "protected"
                  ? "Open Raw Markdown"
                  : "Raw Markdown"
            }}
          </button>
          <div class="save-indicator" :data-save-state="saveStatus" role="status">
            <span aria-hidden="true"></span>
            {{ statusLabel }}
          </div>
        </div>
      </header>

      <div v-if="fatalError" class="document-error" role="alert">
        <p class="eyebrow">Could not open knowledge</p>
        <h1>Something went quiet.</h1>
        <p>{{ fatalError }}</p>
      </div>

      <section v-else-if="humanNote" class="document human-document">
        <dialog
          :open="deletionImpact !== undefined"
          class="delete-note-dialog"
          aria-labelledby="delete-note-title"
        >
          <template v-if="deletionImpact">
            <p class="eyebrow">Permanent deletion</p>
            <h2 id="delete-note-title">Delete {{ humanNote.title }}?</h2>
            <p>
              {{
                deletionImpact.incomingLinkCount === 1
                  ? "1 incoming link will become unresolved."
                  : `${deletionImpact.incomingLinkCount} incoming links will become unresolved.`
              }}
            </p>
            <p>
              The note's canonical file will be removed. Fumori will not
              rewrite references or keep a note trash.
            </p>
            <div class="dialog-actions">
              <button type="button" @click="deletionImpact = undefined">
                Cancel
              </button>
              <button
                type="button"
                class="danger-button"
                @click="deleteHumanNote"
              >
                Delete permanently
              </button>
            </div>
          </template>
        </dialog>
        <p class="document-date">Standalone Human Note</p>
        <h1>{{ humanNote.title }}</h1>
        <p class="canonical-path">{{ humanNote.canonicalPath }}</p>
        <div class="writing-rule" aria-hidden="true"></div>
        <DocumentInspector
          v-if="inspectorOpen && model"
          :model="model"
          :metadata="humanNote"
          :connections="connections"
          @update="updateMetadata((note) => ({ ...note, ...$event }))"
          @close="inspectorOpen = false"
          @open-wikilink="openWikilink"
        />
        <div v-if="editorMode === 'protected'" class="protected-markdown">
          <span class="protected-mark" aria-hidden="true">&lt;/&gt;</span>
          <p class="eyebrow">Exact-source protection</p>
          <h2>Protected Markdown</h2>
          <p>
            This note contains syntax outside the Foundation rich profile. Open
            Raw Markdown to inspect or edit it without silent rewriting.
          </p>
        </div>
        <RawMarkdownEditor
          v-else-if="editorMode === 'raw'"
          :model-value="rawDraft"
          @update="updateRawSource"
        />
        <RichMarkdownEditor
          v-else
          :model-value="humanNote.bodyMarkdown"
          aria-label="Human Note editor"
          :wikilinks="connections?.outgoing as ResolvedWikilink[]"
          :suggestions="wikilinkSuggestions"
          @update="updateBody"
          @open-wikilink="openWikilink"
        />
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
      </section>

      <section
        v-else-if="typeResult"
        class="document empty-document model-document"
      >
        <p class="eyebrow">Type definition</p>
        <h1>{{ typeResult.name }}</h1>
        <p>{{ typeResult.items.length }} matching Human Notes.</p>
        <p>
          {{ typeResult.properties.length }}
          ordered Type-defined properties. Definitions are operator-authored
          while Fumori is stopped.
        </p>
      </section>

      <section
        v-else-if="viewResult"
        class="document model-document"
      >
        <p class="eyebrow">Saved View</p>
        <h1>{{ viewResult.name }}</h1>
        <p>{{ viewResult.items.length }} results derived from canonical Markdown.</p>
        <p>
          {{ viewResult.query.layout ?? "list" }} layout
          <template v-if="viewResult.query.groupBy">
            grouped by {{ viewResult.query.groupBy }}
          </template>
        </p>
        <table
          v-if="viewResult.query.layout === 'table'"
          class="view-table"
        >
          <thead>
            <tr>
              <th
                v-for="column in viewResult.query.visibleColumns ?? ['title']"
                :key="column"
              >
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in viewResult.items" :key="item.id">
              <td
                v-for="column in viewResult.query.visibleColumns ?? ['title']"
                :key="column"
              >
                <a
                  v-if="column === 'title'"
                  :href="item.url"
                  @click.prevent="navigateTo(item.url)"
                >
                  {{ item.title }}
                </a>
                <template v-else>{{ displayField(item, column) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
        <div
          v-else-if="viewResult.query.layout === 'board'"
          class="view-board"
        >
          <section v-for="group in viewResult.groups" :key="group.key">
            <h2>{{ group.key }}</h2>
            <a
              v-for="item in group.items"
              :key="item.id"
              :href="item.url"
              @click.prevent="navigateTo(item.url)"
            >
              {{ item.title }}
            </a>
          </section>
        </div>
        <div v-else class="view-list">
          <a
            v-for="item in viewResult.items"
            :key="item.id"
            :href="item.url"
            @click.prevent="navigateTo(item.url)"
          >
            {{ item.title }}
          </a>
        </div>
      </section>

      <section v-else-if="!fatalError" class="document empty-document">
        <p class="eyebrow">
          {{ mode === "search" ? "Search the Vault" : sectionTitle }}
        </p>
        <h1>
          {{
            mode === "search"
              ? "Find a note."
              : mode === "inbox"
                ? "Capture what matters."
                : mode === "types"
                  ? "Choose a Type."
                  : mode === "views"
                    ? "Choose a Saved View."
                : "Choose a note."
          }}
        </h1>
        <p>
          {{
            mode === "search"
              ? "Search matches canonical titles, paths, metadata, and bodies."
              : mode === "types"
                ? "Types derive matching Human Notes and provide contextual creation."
                : mode === "views"
                  ? "Saved Views evaluate canonical fields without storing membership."
                  : "Standalone notes keep stable identity while their titles evolve."
          }}
        </p>
      </section>
    </article>
  </main>
</template>
