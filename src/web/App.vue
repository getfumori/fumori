<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";

import {
  type AppConfig,
  appConfigSchema
} from "../contracts/app-config";
import {
  type DailyNoteResponse,
  dailyNoteResponseSchema
} from "../contracts/daily-note";
import { humanNoteResponseSchema } from "../contracts/human-note";
import {
  type OrganizationModelResponse,
  organizationModelResponseSchema
} from "../contracts/organization-model";
import DocumentInspector from "./DocumentInspector.vue";
import KnowledgeApp from "./KnowledgeApp.vue";
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

const routeMatch = window.location.pathname.match(
  /^\/daily\/(\d{4}-\d{2}-\d{2})$/
);
const historicalDate = routeMatch?.[1];
const isTodayRoute =
  window.location.pathname === "/" || window.location.pathname === "/today";
const isDailyView = isTodayRoute || historicalDate !== undefined;

const config = ref<AppConfig>();
const note = ref<DailyNoteResponse>();
const model = ref<OrganizationModelResponse>();
const fatalError = ref<string>();
const saveError = ref<string>();
const saveStatus = ref<SaveStatus>("ready");
const autosave = ref<AutosaveController>();
const editorMode = ref<EditorMode>("rich");
const richEditorSafe = ref(true);
const rawDraft = ref("");
const inspectorOpen = ref(false);

const displayTitle = computed(() =>
  isTodayRoute ? "Today" : (note.value?.date ?? historicalDate ?? "")
);

const longDate = computed(() => {
  if (!note.value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${note.value.date}T12:00:00Z`));
});

const calendarDay = computed(() => note.value?.date.slice(-2) ?? "");
const calendarMonth = computed(() => {
  if (!note.value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${note.value.date}T12:00:00Z`));
});

const previousDate = computed(() => {
  if (!note.value) {
    return "";
  }
  const date = new Date(`${note.value.date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
});

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
      return note.value?.exists ? "Saved" : "Not created";
  }
});

function explainError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function configureAutosave(currentNote: DailyNoteResponse): void {
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
        const response = await fetch(`/api/v1/daily/${currentNote.date}`, {
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
              ? "This Daily Note changed elsewhere. Reload before saving again."
              : (detail?.message ?? `Save failed (${response.status})`)
          );
        }
        const saved = dailyNoteResponseSchema.parse(await response.json());
        if (draft.format === "rich") {
          note.value = {
            ...saved,
            bodyMarkdown: note.value?.bodyMarkdown ?? saved.bodyMarkdown
          };
        } else if (draft.format === "raw") {
          note.value = saved;
          if (rawDraft.value === draft.sourceMarkdown) {
            rawDraft.value = saved.sourceMarkdown!;
          }
        } else if (draft.format === "document") {
          note.value = saved;
        }
        richEditorSafe.value = isRichMarkdownRoundTripSafe(
          saved.bodyMarkdown
        );
        saveStatus.value = "saved";
        return { revision: saved.revision! };
      } catch (reason) {
        saveStatus.value = "error";
        saveError.value = explainError(reason, "This Daily Note was not saved.");
        throw reason;
      }
    }
  });
}

async function load(): Promise<void> {
  try {
    const noteEndpoint = historicalDate
      ? `/api/v1/daily/${historicalDate}`
      : "/api/v1/today";
    const [configResponse, noteResponse, modelResponse] = await Promise.all([
      fetch("/api/v1/config", { cache: "no-store" }),
      fetch(noteEndpoint, { cache: "no-store" }),
      fetch("/api/v1/model", { cache: "no-store" })
    ]);
    if (!configResponse.ok) {
      throw new Error(`Configuration request failed (${configResponse.status})`);
    }
    if (!noteResponse.ok) {
      throw new Error(`Daily Note request failed (${noteResponse.status})`);
    }
    if (!modelResponse.ok) {
      throw new Error(`Organization Model request failed (${modelResponse.status})`);
    }
    config.value = appConfigSchema.parse(await configResponse.json());
    note.value = dailyNoteResponseSchema.parse(await noteResponse.json());
    model.value = organizationModelResponseSchema.parse(
      await modelResponse.json()
    );
    rawDraft.value = note.value.sourceMarkdown ?? "";
    richEditorSafe.value =
      !note.value.exists ||
      isRichMarkdownRoundTripSafe(note.value.bodyMarkdown);
    editorMode.value = richEditorSafe.value ? "rich" : "protected";
    document.title = `${displayTitle.value} — Fumori`;
    if (isTodayRoute || note.value.exists) {
      configureAutosave(note.value);
    }
  } catch (reason) {
    fatalError.value = explainError(
      reason,
      "This Daily Note could not be opened."
    );
  }
}

function markDraftDirty(draft: AutosaveDraft): void {
  if (!note.value || !autosave.value) {
    return;
  }
  saveStatus.value = "dirty";
  saveError.value = undefined;
  autosave.value.change(draft);
}

function updateBody(bodyMarkdown: string): void {
  if (!note.value) {
    return;
  }
  note.value = { ...note.value, bodyMarkdown };
  markDraftDirty(documentDraft());
}

function documentDraft(): Extract<AutosaveDraft, { format: "document" }> {
  if (!note.value) {
    throw new Error("No Daily Note is open");
  }
  return {
    format: "document",
    bodyMarkdown: note.value.bodyMarkdown,
    type: "daily-note",
    state: note.value.state,
    tags: note.value.tags,
    aliases: note.value.aliases,
    properties: note.value.properties
  };
}

function updateMetadata(
  metadata: {
    type: string | null;
    state: string;
    tags: string[];
    aliases: string[];
    properties: DailyNoteResponse["properties"];
  }
): void {
  if (!note.value) {
    return;
  }
  note.value = { ...note.value, ...metadata, type: "daily-note" };
  markDraftDirty(documentDraft());
}

function updateRawSource(sourceMarkdown: string): void {
  rawDraft.value = sourceMarkdown;
  markDraftDirty({ format: "raw", sourceMarkdown });
}

async function createHistoricalNote(): Promise<void> {
  if (!note.value || note.value.exists) {
    return;
  }
  try {
    const response = await fetch(`/api/v1/daily/${note.value.date}`, {
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(`Create failed (${response.status})`);
    }
    const created = dailyNoteResponseSchema.parse(await response.json());
    note.value = created;
    rawDraft.value = created.sourceMarkdown ?? "";
    richEditorSafe.value = true;
    editorMode.value = "rich";
    configureAutosave(created);
    saveStatus.value = "saved";
  } catch (reason) {
    saveError.value = explainError(
      reason,
      "This historical Daily Note could not be created."
    );
    saveStatus.value = "error";
  }
}

async function switchToRaw(): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  rawDraft.value = note.value?.sourceMarkdown ?? rawDraft.value;
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

async function navigate(event: MouseEvent, destination: string): Promise<void> {
  event.preventDefault();
  await navigateTo(destination);
}

async function navigateTo(destination: string): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  window.location.assign(destination);
}

async function createStandaloneNote(): Promise<void> {
  try {
    await autosave.value?.flush();
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "global" })
    });
    if (!response.ok) {
      throw new Error(`Create failed (${response.status})`);
    }
    const created = humanNoteResponseSchema.parse(await response.json());
    window.location.assign(`/notes/${created.id}`);
  } catch (reason) {
    saveError.value = explainError(reason, "The note could not be created.");
    saveStatus.value = "error";
  }
}

async function flushNow(): Promise<void> {
  try {
    await autosave.value?.flush();
  } catch {
    // The save callback exposes the failure beside the editor.
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void flushNow();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    void navigateTo("/search");
  }
}

function flushForPageExit(): void {
  void autosave.value?.flush({ keepalive: true }).catch(() => undefined);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    flushForPageExit();
  }
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
  if (!isDailyView) {
    return;
  }
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("pagehide", flushForPageExit);
  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  await load();
});

onBeforeUnmount(() => {
  if (!isDailyView) {
    return;
  }
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("pagehide", flushForPageExit);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  flushForPageExit();
});
</script>

<template>
  <KnowledgeApp v-if="!isDailyView" />
  <main
    v-else
    class="app-shell"
    :data-app-ready="note !== undefined || fatalError !== undefined"
  >
    <PrimarySidebar
      :vault-name="note?.vault.name"
      active="today"
      @navigate="navigateTo"
      @create="createStandaloneNote"
    />

    <section
      class="context-zone"
      data-zone="context"
      aria-label="Daily Note context"
    >
      <header class="zone-header">
        <p class="eyebrow">Daily Notes</p>
        <h2>{{ displayTitle }}</h2>
      </header>

      <div class="calendar-card" aria-label="Selected date">
        <span class="calendar-month">{{ calendarMonth }}</span>
        <strong>{{ calendarDay }}</strong>
        <span class="calendar-today">{{ isTodayRoute ? "Today" : "Daily" }}</span>
      </div>

      <div class="context-section">
        <div class="section-heading">
          <span>Recent days</span>
          <span class="quiet-count">{{ note ? 1 : 0 }}</span>
        </div>
        <div v-if="note" class="recent-list">
          <a
            :href="`/daily/${previousDate}`"
            @click="navigate($event, `/daily/${previousDate}`)"
          >
            <span>{{ previousDate }}</span>
            <small>Open day</small>
          </a>
        </div>
        <div v-else class="empty-list">
          <span class="empty-list-line"></span>
          <p>Your recent Daily Notes will gather here.</p>
        </div>
      </div>

      <p class="context-footnote">Daily Notes are created only when you write.</p>
    </section>

    <article class="document-zone" data-zone="document">
      <header class="document-toolbar">
        <div class="breadcrumb">
          <span class="breadcrumb-dot" aria-hidden="true"></span>
          Daily Notes
          <span aria-hidden="true">/</span>
          {{ displayTitle }}
        </div>
        <div class="document-actions">
          <button
            v-if="note && (note.exists || isTodayRoute)"
            type="button"
            class="editor-mode-button"
            :aria-expanded="inspectorOpen"
            @click="inspectorOpen = !inspectorOpen"
          >
            Inspector
          </button>
          <button
            v-if="
              note &&
              (note.exists || isTodayRoute) &&
              editorMode === 'raw'
            "
            type="button"
            class="editor-mode-button"
            @click="switchToRich"
          >
            Rich editor
          </button>
          <button
            v-else-if="note && (note.exists || isTodayRoute)"
            type="button"
            class="editor-mode-button"
            @click="switchToRaw"
          >
            {{ editorMode === "protected" ? "Open Raw Markdown" : "Raw Markdown" }}
          </button>
          <div class="save-indicator" :data-save-state="saveStatus" role="status">
            <span aria-hidden="true"></span>
            {{ statusLabel }}
          </div>
        </div>
      </header>

      <div v-if="fatalError" class="document-error" role="alert">
        <p class="eyebrow">Could not open Daily Note</p>
        <h1>Something went quiet.</h1>
        <p>{{ fatalError }}</p>
      </div>

      <section v-else-if="note" class="document">
        <p class="document-date">{{ longDate }}</p>
        <h1>{{ displayTitle }}</h1>
        <div class="writing-rule" aria-hidden="true"></div>
        <DocumentInspector
          v-if="inspectorOpen && model && (note.exists || isTodayRoute)"
          :model="model"
          :metadata="note"
          type-locked
          @update="updateMetadata"
          @close="inspectorOpen = false"
        />

        <div
          v-if="!isTodayRoute && !note.exists"
          class="virtual-note historical-note"
        >
          <span class="seed-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M20 31V17" />
              <path d="M20 22c-7 0-10-4-10-10 7 0 10 4 10 10Z" />
              <path d="M20 17c0-6 4-9 10-9 0 6-3 9-10 9Z" />
            </svg>
          </span>
          <h2>No Daily Note for this day</h2>
          <p>Historical days stay untouched until you create them explicitly.</p>
          <button type="button" @click="createHistoricalNote">
            Create Daily Note
          </button>
        </div>

        <template v-else-if="editorMode === 'protected'">
          <div class="protected-markdown">
            <span class="protected-mark" aria-hidden="true">&lt;/&gt;</span>
            <p class="eyebrow">Exact-source protection</p>
            <h2>Protected Markdown</h2>
            <p>
              This note contains syntax outside the Foundation rich profile.
              Open Raw Markdown to inspect or edit it without silent rewriting.
            </p>
          </div>
        </template>

        <template v-else-if="editorMode === 'raw'">
          <RawMarkdownEditor
            :model-value="rawDraft"
            @update="updateRawSource"
          />
        </template>

        <template v-else>
          <div v-if="!note.exists" class="virtual-banner">
            <strong>No Daily Note yet</strong>
            <span>Begin writing below; the note is created on first save.</span>
          </div>
          <RichMarkdownEditor
            :model-value="note.bodyMarkdown"
            @update="updateBody"
          />
        </template>
        <p v-if="saveError" class="save-error" role="alert">
          {{ saveError }}
        </p>
      </section>
    </article>
  </main>
</template>
