<script setup lang="ts">
defineProps<{
  vaultName: string | undefined;
  active: "today" | "notes" | "inbox" | "types" | "views" | "archive";
}>();

const emit = defineEmits<{
  navigate: [destination: string];
  create: [];
}>();

function navigate(event: MouseEvent, destination: string): void {
  event.preventDefault();
  emit("navigate", destination);
}
</script>

<template>
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
        <small>{{ vaultName ?? "Opening Vault" }}</small>
      </span>
    </div>

    <button class="new-note-button" type="button" @click="emit('create')">
      <span aria-hidden="true">+</span>
      New note
    </button>

    <nav aria-label="Primary" class="primary-nav">
      <a
        class="nav-item"
        :class="{ active: active === 'today' }"
        href="/today"
        :aria-current="active === 'today' ? 'page' : undefined"
        @click="navigate($event, '/today')"
      >
        <span class="nav-glyph today-glyph" aria-hidden="true"></span>
        Today
      </a>
      <a
        class="nav-item"
        :class="{ active: active === 'notes' }"
        href="/notes"
        :aria-current="active === 'notes' ? 'page' : undefined"
        @click="navigate($event, '/notes')"
      >
        <span class="nav-glyph note-glyph" aria-hidden="true"></span>
        Notes
      </a>
      <a
        class="nav-item"
        :class="{ active: active === 'inbox' }"
        href="/inbox"
        :aria-current="active === 'inbox' ? 'page' : undefined"
        @click="navigate($event, '/inbox')"
      >
        <span class="nav-glyph inbox-glyph" aria-hidden="true"></span>
        Inbox
      </a>
      <a
        class="nav-item"
        href="#types"
        @click="navigate($event, '#types')"
      >
        <span class="nav-glyph types-glyph" aria-hidden="true"></span>
        Types
      </a>
      <a
        class="nav-item"
        href="#views"
        @click="navigate($event, '#views')"
      >
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
      <button
        class="search-button compact"
        type="button"
        aria-label="Search notes"
        title="Search notes"
        @click="emit('navigate', '/search')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="5.8" />
          <path d="m15 15 4.2 4.2" />
        </svg>
        <kbd>⌘ K</kbd>
      </button>
      <div class="local-status">
        <span aria-hidden="true"></span>
        Local Vault
      </div>
    </div>
  </aside>
</template>
