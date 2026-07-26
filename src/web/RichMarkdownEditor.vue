<script setup lang="ts">
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { computed, ref, watch } from "vue";

import type { ResolvedWikilink } from "../contracts/connections";

import { createFoundationMarkdownExtensions } from "./foundation-markdown";

const props = defineProps<{
  modelValue: string;
  ariaLabel?: string;
  wikilinks: ResolvedWikilink[] | undefined;
  suggestions: Array<{ target: string; title: string; url: string }> | undefined;
}>();

const emit = defineEmits<{
  update: [bodyMarkdown: string];
  openWikilink: [target: string];
}>();

const editor = useEditor({
  extensions: createFoundationMarkdownExtensions({
    resolveWikilink(target) {
      return (
        props.wikilinks?.find((link) => link.target === target) ?? {
          status: "unresolved",
          url: null
        }
      );
    }
  }),
  content: props.modelValue,
  contentType: "markdown",
  editorProps: {
    attributes: {
      "aria-label": props.ariaLabel ?? "Daily Note editor",
      spellcheck: "true"
    },
    handleClickOn(_view, _position, node) {
      if (node.type.name !== "wikilink") {
        return false;
      }
      emit("openWikilink", node.attrs.target);
      return true;
    }
  },
  onUpdate: ({ editor: currentEditor }) => {
    const markdown = currentEditor.getMarkdown();
    const editorText = currentEditor.getText();
    const completed = editorText.match(/\[\[([^\]\n]+)\]\]$/);
    if (completed) {
      const escaped = completed[0]
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
      if (markdown.endsWith(escaped)) {
        currentEditor.commands.setContent(
          markdown.slice(0, -escaped.length) + completed[0],
          { contentType: "markdown", emitUpdate: true }
        );
        currentEditor.commands.focus("end");
        return;
      }
    }
    activeWikilink.value = editorText.match(
      /\[\[([^\]\n|]*)(?:\|([^\]\n]*))?$/
    );
    emit("update", markdown);
  }
});
const activeWikilink = ref<RegExpMatchArray | null>(null);
const matchingSuggestions = computed(() => {
  const query = activeWikilink.value?.[1]?.trim().toLocaleLowerCase();
  if (query === undefined) {
    return [];
  }
  return (props.suggestions ?? [])
    .filter((suggestion) =>
      suggestion.title.toLocaleLowerCase().includes(query)
    )
    .slice(0, 8);
});

function selectSuggestion(target: string): void {
  if (!editor.value || !activeWikilink.value) {
    return;
  }
  const label = activeWikilink.value[2];
  const current = editor.value.getMarkdown();
  const replacement = `[[${target}${label !== undefined ? `|${label}` : ""}]]`;
  const escapedActive = activeWikilink.value[0].replace("[[", "\\[\\[");
  if (!current.endsWith(escapedActive)) {
    return;
  }
  const updated = current.slice(0, -escapedActive.length) + replacement;
  activeWikilink.value = null;
  editor.value.commands.setContent(updated, {
    contentType: "markdown",
    emitUpdate: true
  });
  editor.value.commands.focus("end");
}

watch(
  () => props.modelValue,
  (bodyMarkdown) => {
    if (!editor.value || editor.value.getMarkdown() === bodyMarkdown) {
      return;
    }
    editor.value.commands.setContent(bodyMarkdown, {
      contentType: "markdown",
      emitUpdate: false
    });
  }
);

watch(
  () => props.wikilinks,
  () => {
    if (!editor.value) return;
    editor.value.commands.setContent(editor.value.getMarkdown(), {
      contentType: "markdown",
      emitUpdate: false
    });
  }
);
</script>

<template>
  <section class="rich-editor" data-testid="rich-editor">
    <div
      class="format-toolbar"
      role="toolbar"
      aria-label="Formatting"
      @mousedown.prevent
    >
      <button
        type="button"
        :aria-pressed="editor?.isActive('paragraph')"
        aria-label="Paragraph"
        title="Paragraph"
        @click="editor?.chain().focus().setParagraph().run()"
      >
        ¶
      </button>
      <button
        v-for="level in ([1, 2, 3] as const)"
        :key="level"
        type="button"
        :aria-pressed="editor?.isActive('heading', { level })"
        :aria-label="`Heading ${level}`"
        :title="`Heading ${level}`"
        @click="editor?.chain().focus().toggleHeading({ level }).run()"
      >
        H{{ level }}
      </button>
      <span aria-hidden="true"></span>
      <button
        type="button"
        :aria-pressed="editor?.isActive('bold')"
        aria-label="Bold"
        title="Bold"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('italic')"
        aria-label="Italic"
        title="Italic"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('code')"
        aria-label="Inline code"
        title="Inline code"
        @click="editor?.chain().focus().toggleCode().run()"
      >
        &lt;/&gt;
      </button>
      <span aria-hidden="true"></span>
      <button
        type="button"
        :aria-pressed="editor?.isActive('bulletList')"
        aria-label="Bullet list"
        title="Bullet list"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        •
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('orderedList')"
        aria-label="Ordered list"
        title="Ordered list"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        1.
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('taskList')"
        aria-label="Checklist"
        title="Checklist"
        @click="editor?.chain().focus().toggleTaskList().run()"
      >
        ☑
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('blockquote')"
        aria-label="Blockquote"
        title="Blockquote"
        @click="editor?.chain().focus().toggleBlockquote().run()"
      >
        “
      </button>
      <button
        type="button"
        :aria-pressed="editor?.isActive('codeBlock')"
        aria-label="Code block"
        title="Code block"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        { }
      </button>
    </div>
    <EditorContent v-if="editor" :editor="editor" />
    <div
      v-if="matchingSuggestions.length"
      class="wikilink-autocomplete"
      role="listbox"
      aria-label="Wikilink suggestions"
    >
      <button
        v-for="suggestion in matchingSuggestions"
        :key="suggestion.url"
        type="button"
        role="option"
        @click="selectSuggestion(suggestion.target)"
      >
        {{ suggestion.title }}
      </button>
    </div>
  </section>
</template>
