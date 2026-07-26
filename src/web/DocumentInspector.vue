<script setup lang="ts">
import { computed } from "vue";

import type {
  OrganizationModelResponse,
  OrganizationModelValue,
  TypeProperty
} from "../contracts/organization-model";

type InspectorMetadata = {
  type: string | null;
  state: string;
  tags: string[];
  aliases: string[];
  properties: Record<string, OrganizationModelValue>;
};

const props = defineProps<{
  model: OrganizationModelResponse;
  metadata: InspectorMetadata;
  typeLocked?: boolean;
}>();
const emit = defineEmits<{
  update: [metadata: InspectorMetadata];
  close: [];
}>();

const selectedType = computed(() =>
  props.model.types.find((type) => type.key === props.metadata.type)
);

function update(update: Partial<InspectorMetadata>): void {
  emit("update", { ...props.metadata, ...update });
}

function changeType(event: Event): void {
  const type = props.model.types.find(
    (candidate) => candidate.key === (event.target as HTMLSelectElement).value
  );
  update({
    type: type?.key ?? null,
    properties: Object.fromEntries(
      (type?.properties ?? [])
        .filter((property) => property.default !== undefined)
        .map((property) => [property.key, property.default!])
    )
  });
}

function changeStringList(field: "tags" | "aliases", event: Event): void {
  update({
    [field]: (event.target as HTMLInputElement).value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  });
}

function changeProperty(property: TypeProperty, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  let value: OrganizationModelValue;
  if (property.kind === "boolean") {
    value = (target as HTMLInputElement).checked;
  } else if (property.kind === "number") {
    value = Number(target.value);
  } else if (property.kind === "multi_select") {
    value = [...(target as HTMLSelectElement).selectedOptions].map(
      (option) => option.value
    );
  } else {
    value = target.value;
  }
  update({
    properties: { ...props.metadata.properties, [property.key]: value }
  });
}
</script>

<template>
  <form
    class="document-inspector"
    aria-label="Document inspector"
    @submit.prevent
  >
    <div class="inspector-heading">
      <div>
        <p class="eyebrow">Organization Model</p>
        <h2>Document inspector</h2>
      </div>
      <button type="button" aria-label="Close inspector" @click="emit('close')">
        Close
      </button>
    </div>
    <div class="inspector-grid">
      <label>
        <span>Type</span>
        <select
          :value="metadata.type ?? ''"
          :disabled="typeLocked"
          @change="changeType"
        >
          <option value="">Untyped</option>
          <option v-for="type in model.types" :key="type.key" :value="type.key">
            {{ type.name }}
          </option>
        </select>
      </label>
      <label>
        <span>State</span>
        <select
          :value="metadata.state"
          @change="
            update({ state: ($event.target as HTMLSelectElement).value })
          "
        >
          <option v-for="state in model.states" :key="state" :value="state">
            {{ state }}
          </option>
        </select>
      </label>
      <label>
        <span>Tags</span>
        <input
          type="text"
          :value="metadata.tags.join(', ')"
          placeholder="comma, separated"
          @input="changeStringList('tags', $event)"
        />
      </label>
      <label>
        <span>Aliases</span>
        <input
          type="text"
          :value="metadata.aliases.join(', ')"
          placeholder="comma, separated"
          @input="changeStringList('aliases', $event)"
        />
      </label>
    </div>
    <div v-if="selectedType?.properties.length" class="typed-properties">
      <div class="section-heading">
        <span>{{ selectedType.name }} properties</span>
      </div>
      <label
        v-for="property in selectedType.properties"
        :key="property.key"
        class="typed-property"
      >
        <span>
          {{ property.name }}
          <em v-if="property.required">Required</em>
        </span>
        <select
          v-if="property.kind === 'select'"
          :value="metadata.properties[property.key]"
          @change="changeProperty(property, $event)"
        >
          <option
            v-for="option in property.options"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
        <select
          v-else-if="property.kind === 'multi_select'"
          multiple
          :value="metadata.properties[property.key] as string[]"
          @change="changeProperty(property, $event)"
        >
          <option
            v-for="option in property.options"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
        <input
          v-else-if="property.kind === 'boolean'"
          type="checkbox"
          :checked="Boolean(metadata.properties[property.key])"
          @change="changeProperty(property, $event)"
        />
        <input
          v-else
          :type="
            property.kind === 'number'
              ? 'number'
              : property.kind === 'date'
                ? 'date'
                : 'text'
          "
          :value="metadata.properties[property.key] ?? ''"
          @input="changeProperty(property, $event)"
        />
        <small v-if="property.advisory">{{ property.advisory }}</small>
      </label>
    </div>
  </form>
</template>
