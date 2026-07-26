import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

import {
  queryFilterSchema,
  schemaKeySchema,
  typePropertySchema,
  type QueryFilter,
  type QuerySpec,
  type SavedView,
  type TypeDefinition
} from "../contracts/organization-model.js";

const lifecycleSchema = z.object({
  _schema: z.literal("fumori.model.lifecycle"),
  _version: z.literal(1),
  states: z.array(z.string().min(1)).min(1),
  archived_state: z.string().min(1)
});

const noteTypeSchema = z.object({
  _schema: z.literal("fumori.model.type"),
  _version: z.literal(1),
  key: z.literal("note"),
  space: z.literal("human"),
  default_state: z.string().min(1)
});

const inboxViewSchema = z.object({
  _schema: z.literal("fumori.model.view"),
  _version: z.literal(1),
  key: z.literal("inbox"),
  space: z.literal("human"),
  kind: z.literal("standalone"),
  state: z.string().min(1)
});

const typeFileSchema = z.object({
  _schema: z.literal("fumori.model.type"),
  _version: z.literal(1),
  key: schemaKeySchema,
  name: z.string().min(1),
  space: z.literal("human"),
  default_state: z.string().min(1).optional(),
  properties: z.array(typePropertySchema).optional().default([])
});

const queryFileSchema = z.object({
  filter: queryFilterSchema.optional(),
  order: z
    .array(
      z.object({
        field: z.string().regex(/^[a-z_][a-z0-9_-]*$/),
        direction: z.enum(["ascending", "descending"])
      })
    )
    .optional(),
  group_by: z.string().regex(/^[a-z_][a-z0-9_-]*$/).optional(),
  layout: z.enum(["list", "table", "board"]).optional(),
  visible_columns: z
    .array(z.string().regex(/^[a-z_][a-z0-9_-]*$/))
    .optional()
});
const viewFileSchema = z.object({
  _schema: z.literal("fumori.model.view"),
  _version: z.literal(1),
  key: schemaKeySchema,
  name: z.string().min(1),
  space: z.literal("human"),
  query: queryFileSchema
});

export type OrganizationModel = {
  states: ReadonlySet<string>;
  standaloneCreationState: string;
  inboxState: string;
  archivedState: string;
  types: readonly TypeDefinition[];
  views: readonly SavedView[];
  type(key: string): TypeDefinition | undefined;
  view(key: string): SavedView | undefined;
};

function frontmatter(source: string, path: string): unknown {
  const end = source.indexOf("\n---\n", "---\n".length);
  if (!source.startsWith("---\n") || end < 0) {
    throw new Error(`Organization Model file has invalid frontmatter: ${path}`);
  }
  const document = parseDocument(source.slice("---\n".length, end), {
    uniqueKeys: true
  });
  if (document.errors.length > 0) {
    throw new Error(
      `Organization Model file has invalid frontmatter: ${path}: ${
        document.errors[0]!.message
      }`
    );
  }
  return document.toJS();
}

async function modelDocuments(
  vaultPath: string,
  directory: "types" | "views"
): Promise<Array<{ path: string; value: unknown }>> {
  const relativeDirectory = `.second-brain/model/${directory}`;
  const filenames = (await readdir(join(vaultPath, relativeDirectory)))
    .filter((filename) => filename.endsWith(".md"))
    .sort();
  return Promise.all(
    filenames.map(async (filename) => {
      const path = `${relativeDirectory}/${filename}`;
      return {
        path,
        value: frontmatter(await readFile(join(vaultPath, path), "utf8"), path)
      };
    })
  );
}

function publicType(
  value: z.infer<typeof typeFileSchema>,
  path: string
): TypeDefinition {
  if (`${value.key}.md` !== path.split("/").at(-1)) {
    throw new Error(`Type key '${value.key}' does not match its filename: ${path}`);
  }
  const keys = new Set<string>();
  for (const property of value.properties) {
    if (keys.has(property.key)) {
      throw new Error(`Type '${value.key}' repeats property '${property.key}'`);
    }
    keys.add(property.key);
  }
  return {
    key: value.key,
    name: value.name,
    ...(value.default_state ? { defaultState: value.default_state } : {}),
    properties: value.properties
  };
}

function publicView(
  value: z.infer<typeof viewFileSchema>,
  path: string
): SavedView {
  if (`${value.key}.md` !== path.split("/").at(-1)) {
    throw new Error(`Saved View key '${value.key}' does not match its filename: ${path}`);
  }
  return {
    key: value.key,
    name: value.name,
    query: {
      ...(value.query.filter
        ? { filter: value.query.filter as QueryFilter }
        : {}),
      ...(value.query.order ? { order: value.query.order } : {}),
      ...(value.query.group_by ? { groupBy: value.query.group_by } : {}),
      ...(value.query.layout ? { layout: value.query.layout } : {}),
      ...(value.query.visible_columns
        ? { visibleColumns: value.query.visible_columns }
        : {})
    } satisfies QuerySpec
  };
}

export async function loadOrganizationModel(
  vaultPath: string
): Promise<OrganizationModel> {
  const lifecyclePath = ".second-brain/model/lifecycle.md";
  const noteTypePath = ".second-brain/model/types/note.md";
  const inboxPath = ".second-brain/model/views/inbox.md";
  const [lifecycleSource, noteTypeSource, inboxSource, typeDocuments, viewDocuments] =
    await Promise.all([
    readFile(join(vaultPath, lifecyclePath), "utf8"),
    readFile(join(vaultPath, noteTypePath), "utf8"),
    readFile(join(vaultPath, inboxPath), "utf8"),
    modelDocuments(vaultPath, "types"),
    modelDocuments(vaultPath, "views")
  ]);
  const lifecycle = lifecycleSchema.parse(
    frontmatter(lifecycleSource, lifecyclePath)
  );
  const noteType = noteTypeSchema.parse(
    frontmatter(noteTypeSource, noteTypePath)
  );
  const inbox = inboxViewSchema.parse(frontmatter(inboxSource, inboxPath));
  const states = new Set(lifecycle.states);
  for (const [source, state] of [
    [noteTypePath, noteType.default_state],
    [inboxPath, inbox.state],
    [lifecyclePath, lifecycle.archived_state]
  ] as const) {
    if (!states.has(state)) {
      throw new Error(`State '${state}' from ${source} is absent from ${lifecyclePath}`);
    }
  }
  const types = typeDocuments.map(({ path, value }) =>
    publicType(typeFileSchema.parse(value), path)
  );
  const customViews = viewDocuments
    .filter(({ path }) => path !== inboxPath)
    .map(({ path, value }) => publicView(viewFileSchema.parse(value), path));
  for (const type of types) {
    if (type.defaultState && !states.has(type.defaultState)) {
      throw new Error(
        `State '${type.defaultState}' from Type '${type.key}' is absent from ${lifecyclePath}`
      );
    }
  }
  const inboxView: SavedView = {
    key: "inbox",
    name: "Inbox",
    query: {
      filter: {
        all: [
          { field: "kind", operator: "equals", value: "standalone" },
          { field: "state", operator: "equals", value: inbox.state }
        ]
      },
      layout: "list"
    }
  };
  const views = [inboxView, ...customViews];
  const typeByKey = new Map(types.map((type) => [type.key, type]));
  const viewByKey = new Map(views.map((view) => [view.key, view]));
  return {
    states,
    standaloneCreationState: noteType.default_state,
    inboxState: inbox.state,
    archivedState: lifecycle.archived_state,
    types,
    views,
    type: (key) => typeByKey.get(key),
    view: (key) => viewByKey.get(key)
  };
}
