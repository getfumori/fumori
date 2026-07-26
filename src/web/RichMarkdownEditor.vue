<script setup lang="ts">
import { EditorContent, useEditor } from "@tiptap/vue-3";
import { watch } from "vue";

import { createFoundationMarkdownExtensions } from "./foundation-markdown";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  update: [bodyMarkdown: string];
}>();

const editor = useEditor({
  extensions: createFoundationMarkdownExtensions(),
  content: props.modelValue,
  contentType: "markdown",
  editorProps: {
    attributes: {
      "aria-label": "Daily Note editor",
      spellcheck: "true"
    }
  },
  onUpdate: ({ editor: currentEditor }) => {
    emit("update", currentEditor.getMarkdown());
  }
});

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
  </section>
</template>
