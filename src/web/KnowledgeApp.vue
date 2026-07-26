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
import { dailyNoteResponseSchema } from "../contracts/daily-note";
import {
  type HumanNoteListItem,
  type HumanNoteResponse,
  humanNoteListResponseSchema,
  humanNoteResponseSchema
} from "../contracts/human-note";
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
type KnowledgeMode = "notes" | "inbox" | "note" | "search";

const humanNoteMatch = window.location.pathname.match(
  /^\/notes\/([0-9a-f-]{36})$/
);
const mode: KnowledgeMode = humanNoteMatch
  ? "note"
  : window.location.pathname === "/inbox"
    ? "inbox"
    : window.location.pathname === "/search"
      ? "search"
      : "notes";

const config = ref<AppConfig>();
const vaultName = ref<string>();
const humanNote = ref<HumanNoteResponse>();
const noteList = ref<HumanNoteListItem[]>([]);
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
let searchSequence = 0;

const sectionTitle = computed(() =>
  mode === "inbox" ? "Inbox" : mode === "search" ? "Search" : "Notes"
);
const activeNavigation = computed(() =>
  mode === "inbox" ? "inbox" as const : "notes" as const
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
        } else {
          humanNote.value = saved;
          if (rawDraft.value === draft.sourceMarkdown) {
            rawDraft.value = saved.sourceMarkdown;
          }
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

async function load(): Promise<void> {
  try {
    const [configResponse, vaultResponse] = await Promise.all([
      fetch("/api/v1/config", { cache: "no-store" }),
      fetch("/api/v1/today", { cache: "no-store" })
    ]);
    if (!configResponse.ok) {
      throw new Error(`Configuration request failed (${configResponse.status})`);
    }
    if (!vaultResponse.ok) {
      throw new Error(`Vault request failed (${vaultResponse.status})`);
    }
    config.value = appConfigSchema.parse(await configResponse.json());
    vaultName.value = dailyNoteResponseSchema.parse(
      await vaultResponse.json()
    ).vault.name;

    if (mode === "note") {
      const [noteResponse, listResponse] = await Promise.all([
        fetch(`/api/v1/notes/${humanNoteMatch![1]}`, { cache: "no-store" }),
        fetch("/api/v1/notes", { cache: "no-store" })
      ]);
      if (!noteResponse.ok) {
        throw new Error(`Note request failed (${noteResponse.status})`);
      }
      humanNote.value = humanNoteResponseSchema.parse(await noteResponse.json());
      noteList.value = humanNoteListResponseSchema.parse(
        await listResponse.json()
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

    if (mode === "search") {
      document.title = "Search — Fumori";
      if (searchQuery.value) {
        await runSearch();
      }
      return;
    }

    const response = await fetch(
      mode === "inbox" ? "/api/v1/inbox" : "/api/v1/notes",
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
  markDraftDirty({ format: "rich", bodyMarkdown });
}

function updateRawSource(sourceMarkdown: string): void {
  rawDraft.value = sourceMarkdown;
  markDraftDirty({ format: "raw", sourceMarkdown });
}

async function createNote(context: "global" | "inbox"): Promise<void> {
  try {
    await autosave.value?.flush();
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context })
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
          {{ mode === "search" ? "Find in Vault" : "Human Notes" }}
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
        <p class="document-date">Standalone Human Note</p>
        <h1>{{ humanNote.title }}</h1>
        <p class="canonical-path">{{ humanNote.canonicalPath }}</p>
        <div class="writing-rule" aria-hidden="true"></div>
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
          @update="updateBody"
        />
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
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
                : "Choose a note."
          }}
        </h1>
        <p>
          {{
            mode === "search"
              ? "Search matches canonical titles, paths, metadata, and bodies."
              : "Standalone notes keep stable identity while their titles evolve."
          }}
        </p>
      </section>
    </article>
  </main>
</template>
