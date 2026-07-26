<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  update: [sourceMarkdown: string];
}>();

function update(event: Event): void {
  emit("update", (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <section class="raw-editor">
    <div class="raw-editor-heading">
      <strong>Exact canonical source</strong>
      <span>Frontmatter and Markdown are edited together.</span>
    </div>
    <textarea
      :value="modelValue"
      aria-label="Raw Markdown editor"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @input="update"
    ></textarea>
  </section>
</template>
