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
import RichMarkdownEditor from "./RichMarkdownEditor.vue";
import {
  type AutosaveController,
  createAutosaveController,
  systemAutosaveClock
} from "./autosave";

type SaveStatus = "ready" | "dirty" | "saving" | "saved" | "error";

const routeMatch = window.location.pathname.match(
  /^\/daily\/(\d{4}-\d{2}-\d{2})$/
);
const historicalDate = routeMatch?.[1];
const isTodayRoute = historicalDate === undefined;

const config = ref<AppConfig>();
const note = ref<DailyNoteResponse>();
const fatalError = ref<string>();
const saveError = ref<string>();
const saveStatus = ref<SaveStatus>("ready");
const autosave = ref<AutosaveController>();

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
    async save({ baseRevision, bodyMarkdown, keepalive }) {
      saveStatus.value = "saving";
      saveError.value = undefined;
      try {
        const response = await fetch(`/api/v1/daily/${currentNote.date}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRevision, bodyMarkdown }),
          keepalive
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => undefined)) as
            | { error?: string }
            | undefined;
          throw new Error(
            detail?.error === "stale_revision"
              ? "This Daily Note changed elsewhere. Reload before saving again."
              : `Save failed (${response.status})`
          );
        }
        const saved = dailyNoteResponseSchema.parse(await response.json());
        note.value = {
          ...saved,
          bodyMarkdown: note.value?.bodyMarkdown ?? saved.bodyMarkdown
        };
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
    const [configResponse, noteResponse] = await Promise.all([
      fetch("/api/v1/config", { cache: "no-store" }),
      fetch(noteEndpoint, { cache: "no-store" })
    ]);
    if (!configResponse.ok) {
      throw new Error(`Configuration request failed (${configResponse.status})`);
    }
    if (!noteResponse.ok) {
      throw new Error(`Daily Note request failed (${noteResponse.status})`);
    }
    config.value = appConfigSchema.parse(await configResponse.json());
    note.value = dailyNoteResponseSchema.parse(await noteResponse.json());
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

function updateBody(bodyMarkdown: string): void {
  if (!note.value || !autosave.value) {
    return;
  }
  note.value = { ...note.value, bodyMarkdown };
  saveStatus.value = "dirty";
  saveError.value = undefined;
  autosave.value.change(bodyMarkdown);
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

async function navigate(event: MouseEvent, destination: string): Promise<void> {
  event.preventDefault();
  try {
    await autosave.value?.flush();
  } catch {
    return;
  }
  window.location.assign(destination);
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
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("pagehide", flushForPageExit);
  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  await load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("pagehide", flushForPageExit);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  flushForPageExit();
});
</script>

<template>
  <main
    class="app-shell"
    :data-app-ready="note !== undefined || fatalError !== undefined"
  >
    <aside class="primary-zone" data-zone="primary">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" role="img">
            <path d="M8 24V8h15l-3.2 4H13v3h6l-3 4h-3v5H8Z" />
            <path d="M17 8c4-3 8-2 9-2-1 4-3 7-8 7" class="brand-leaf" />
          </svg>
        </span>
        <span>
          <strong>Fumori</strong>
          <small>{{ note?.vault.name ?? "Opening Vault" }}</small>
        </span>
      </div>

      <nav aria-label="Primary" class="primary-nav">
        <a
          class="nav-item active"
          href="/today"
          :aria-current="isTodayRoute ? 'page' : undefined"
          @click="navigate($event, '/today')"
        >
          <span class="nav-glyph today-glyph" aria-hidden="true"></span>
          Today
        </a>
        <a class="nav-item" href="#notes" @click="navigate($event, '#notes')">
          <span class="nav-glyph note-glyph" aria-hidden="true"></span>
          Notes
        </a>
        <a class="nav-item" href="#inbox" @click="navigate($event, '#inbox')">
          <span class="nav-glyph inbox-glyph" aria-hidden="true"></span>
          Inbox
        </a>
        <a class="nav-item" href="#types" @click="navigate($event, '#types')">
          <span class="nav-glyph types-glyph" aria-hidden="true"></span>
          Types
        </a>
        <a class="nav-item" href="#views" @click="navigate($event, '#views')">
          <span class="nav-glyph views-glyph" aria-hidden="true"></span>
          Views
        </a>
        <a
          class="nav-item"
          href="#archive"
          @click="navigate($event, '#archive')"
        >
          <span class="nav-glyph archive-glyph" aria-hidden="true"></span>
          Archive
        </a>
      </nav>

      <div class="primary-footer">
        <button class="search-button" type="button" aria-label="Search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="5.8" />
            <path d="m15 15 4.2 4.2" />
          </svg>
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>
        <div class="local-status">
          <span aria-hidden="true"></span>
          Local Vault
        </div>
      </div>
    </aside>

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
        <div class="save-indicator" :data-save-state="saveStatus" role="status">
          <span aria-hidden="true"></span>
          {{ statusLabel }}
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

        <template v-else>
          <div v-if="!note.exists" class="virtual-banner">
            <strong>No Daily Note yet</strong>
            <span>Begin writing below; the note is created on first save.</span>
          </div>
          <RichMarkdownEditor
            :model-value="note.bodyMarkdown"
            @update="updateBody"
          />
          <p v-if="saveError" class="save-error" role="alert">
            {{ saveError }}
          </p>
        </template>
      </section>
    </article>
  </main>
</template>
