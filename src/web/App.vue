<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  type TodayResponse,
  todayResponseSchema
} from "../contracts/today";

const today = ref<TodayResponse>();
const error = ref<string>();

const longDate = computed(() => {
  if (!today.value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${today.value.date}T12:00:00Z`));
});

const calendarDay = computed(() => today.value?.date.slice(-2) ?? "");
const calendarMonth = computed(() => {
  if (!today.value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${today.value.date}T12:00:00Z`));
});

onMounted(async () => {
  try {
    const response = await fetch("/api/v1/today", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Today request failed (${response.status})`);
    }
    today.value = todayResponseSchema.parse(await response.json());
  } catch (reason) {
    error.value =
      reason instanceof Error ? reason.message : "Today could not be opened.";
  }
});
</script>

<template>
  <main
    class="app-shell"
    :data-app-ready="today !== undefined || error !== undefined"
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
          <small>{{ today?.vault.name ?? "Opening Vault" }}</small>
        </span>
      </div>

      <nav aria-label="Primary" class="primary-nav">
        <a class="nav-item active" href="/today" aria-current="page">
          <span class="nav-glyph today-glyph" aria-hidden="true"></span>
          Today
        </a>
        <a class="nav-item" href="#notes">
          <span class="nav-glyph note-glyph" aria-hidden="true"></span>
          Notes
        </a>
        <a class="nav-item" href="#inbox">
          <span class="nav-glyph inbox-glyph" aria-hidden="true"></span>
          Inbox
        </a>
        <a class="nav-item" href="#types">
          <span class="nav-glyph types-glyph" aria-hidden="true"></span>
          Types
        </a>
        <a class="nav-item" href="#views">
          <span class="nav-glyph views-glyph" aria-hidden="true"></span>
          Views
        </a>
        <a class="nav-item" href="#archive">
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

    <section class="context-zone" data-zone="context" aria-label="Today context">
      <header class="zone-header">
        <p class="eyebrow">Daily Notes</p>
        <h2>Today</h2>
      </header>

      <div class="calendar-card" aria-label="Selected date">
        <span class="calendar-month">{{ calendarMonth }}</span>
        <strong>{{ calendarDay }}</strong>
        <span class="calendar-today">Today</span>
      </div>

      <div class="context-section">
        <div class="section-heading">
          <span>Recent days</span>
          <span class="quiet-count">0</span>
        </div>
        <div class="empty-list">
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
          Today
        </div>
        <button type="button" class="more-button" aria-label="More options">
          <span></span><span></span><span></span>
        </button>
      </header>

      <div v-if="error" class="document-error" role="alert">
        <p class="eyebrow">Could not open Today</p>
        <h1>Something went quiet.</h1>
        <p>{{ error }}</p>
      </div>

      <section v-else class="document">
        <p class="document-date">{{ longDate }}</p>
        <h1>Today</h1>
        <div class="writing-rule" aria-hidden="true"></div>
        <div class="virtual-note">
          <span class="seed-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <path d="M20 31V17" />
              <path d="M20 22c-7 0-10-4-10-10 7 0 10 4 10 10Z" />
              <path d="M20 17c0-6 4-9 10-9 0 6-3 9-10 9Z" />
            </svg>
          </span>
          <h2>No Daily Note yet</h2>
          <p>Today is here when you need it. Nothing is created until you begin writing.</p>
        </div>
      </section>
    </article>
  </main>
</template>
