<script setup lang="ts">
defineProps<{
  currentSource: string | undefined;
  loadError: string | undefined;
  loading: boolean;
  manual: boolean;
  open: boolean;
}>();

defineEmits<{
  adopt: [];
  close: [];
  manual: [];
  replace: [];
  retry: [];
  review: [];
  saveManual: [];
}>();
</script>

<template>
  <dialog
    v-if="open"
    open
    class="content-conflict-dialog"
    aria-labelledby="content-conflict-title"
  >
    <p class="eyebrow">Autosave paused</p>
    <h2 id="content-conflict-title">Resolve newer content</h2>
    <p>
      This note was saved elsewhere after you opened it. Your complete local
      draft remains in the editor until you choose what to keep.
    </p>
    <p v-if="loading" role="status">Loading current saved content…</p>
    <div v-else-if="loadError" class="conflict-load-error" role="alert">
      <p>{{ loadError }}</p>
      <button type="button" @click="$emit('retry')">
        Retry loading current content
      </button>
    </div>
    <label class="conflict-current-source">
      <span>Current saved content</span>
      <textarea
        :value="currentSource ?? ''"
        readonly
        aria-label="Current saved content"
      ></textarea>
    </label>
    <div class="conflict-primary-actions">
      <button type="button" :disabled="!currentSource" @click="$emit('adopt')">
        Use current saved content
      </button>
      <button
        type="button"
        class="conflict-replace"
        :disabled="!currentSource"
        @click="$emit('replace')"
      >
        Replace with my draft
      </button>
    </div>
    <div class="dialog-actions">
      <button type="button" @click="$emit('close')">Close</button>
      <button
        type="button"
        :disabled="!currentSource"
        @click="$emit('manual')"
      >
        Combine manually
      </button>
    </div>
  </dialog>

  <section v-else class="content-conflict-banner" role="alert">
    <div>
      <strong>Newer saved content needs your decision.</strong>
      <span>Autosave is paused and your local draft is preserved.</span>
    </div>
    <button type="button" @click="$emit('review')">
      Review newer content
    </button>
    <button
      v-if="manual"
      type="button"
      class="conflict-replace"
      @click="$emit('saveManual')"
    >
      Save combined draft
    </button>
  </section>
</template>
