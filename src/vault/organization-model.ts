import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseDocument } from "yaml";
import { z } from "zod";

const lifecycleSchema = z.object({
  states: z.array(z.string().min(1)).min(1),
  archived_state: z.string().min(1)
});

const noteTypeSchema = z.object({
  key: z.literal("note"),
  space: z.literal("human"),
  default_state: z.string().min(1)
});

const inboxViewSchema = z.object({
  key: z.literal("inbox"),
  space: z.literal("human"),
  kind: z.literal("standalone"),
  state: z.string().min(1)
});

export type OrganizationModel = {
  states: ReadonlySet<string>;
  standaloneCreationState: string;
  inboxState: string;
  archivedState: string;
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

export async function loadOrganizationModel(
  vaultPath: string
): Promise<OrganizationModel> {
  const lifecyclePath = ".second-brain/model/lifecycle.md";
  const noteTypePath = ".second-brain/model/types/note.md";
  const inboxPath = ".second-brain/model/views/inbox.md";
  const [lifecycleSource, noteTypeSource, inboxSource] = await Promise.all([
    readFile(join(vaultPath, lifecyclePath), "utf8"),
    readFile(join(vaultPath, noteTypePath), "utf8"),
    readFile(join(vaultPath, inboxPath), "utf8")
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
  return {
    states,
    standaloneCreationState: noteType.default_state,
    inboxState: inbox.state,
    archivedState: lifecycle.archived_state
  };
}
