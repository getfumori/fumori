import type { SaveDailyNoteRequest } from "../contracts/daily-note.js";
import type { SaveHumanNoteRequest } from "../contracts/human-note.js";
import type {
  QuerySpec,
  SavedView,
  StructuredNoteItem,
  TypeDefinition
} from "../contracts/organization-model.js";
import {
  DailyNotes,
  type DailyNoteSnapshot
} from "./daily-notes.js";
import { HumanNotes } from "./human-notes.js";
import {
  InMemoryProjection,
  type ProjectedHumanNote
} from "./in-memory-projection.js";
import {
  loadOrganizationModel,
  type OrganizationModel
} from "./organization-model.js";
import { openVault } from "./open.js";

export {
  ExplicitDailyNoteCreationRequiredError,
  InvalidDailyNoteMarkdownError,
  StaleDailyNoteRevisionError
} from "./daily-notes.js";
export {
  HumanNoteNotFoundError,
  InvalidHumanNoteMarkdownError,
  StaleHumanNoteRevisionError
} from "./human-notes.js";

type VaultIdentity = {
  id: string;
  name: string;
};

export class VaultModule {
  readonly identity: VaultIdentity;
  readonly #dailyNotes: DailyNotes;
  readonly #humanNotes: HumanNotes;
  readonly #projection: InMemoryProjection;
  readonly #model: OrganizationModel;

  private constructor(options: {
    identity: VaultIdentity;
    dailyNotes: DailyNotes;
    humanNotes: HumanNotes;
    projection: InMemoryProjection;
    model: OrganizationModel;
  }) {
    this.identity = options.identity;
    this.#dailyNotes = options.dailyNotes;
    this.#humanNotes = options.humanNotes;
    this.#projection = options.projection;
    this.#model = options.model;
  }

  static async open(
    inputPath: string,
    today: () => string
  ): Promise<VaultModule> {
    const vault = await openVault(inputPath);
    const model = await loadOrganizationModel(vault.path);
    const projection = new InMemoryProjection({
      inboxState: model.inboxState,
      archivedState: model.archivedState
    });
    const dailyNotes = new DailyNotes(vault.path, today, model, (note) => {
      projection.publishDailyNote(note);
    });
    await dailyNotes.rebuildProjection();
    const humanNotes = new HumanNotes(vault.path, projection, model);
    await humanNotes.rebuildProjection();
    return new VaultModule({
      identity: { id: vault.id, name: vault.name },
      dailyNotes,
      humanNotes,
      projection,
      model
    });
  }

  readDailyNote(date: string): Promise<DailyNoteSnapshot> {
    return this.#dailyNotes.read(date);
  }

  saveDailyNote(
    date: string,
    input: SaveDailyNoteRequest
  ): Promise<DailyNoteSnapshot> {
    return this.#dailyNotes.save(date, input);
  }

  createDailyNote(
    date: string
  ): Promise<{ created: boolean; note: DailyNoteSnapshot }> {
    return this.#dailyNotes.create(date);
  }

  humanNote(id: string): ProjectedHumanNote | undefined {
    return this.#humanNotes.read(id);
  }

  createHumanNote(type?: string): Promise<ProjectedHumanNote> {
    return this.#humanNotes.create(type);
  }

  saveHumanNote(
    id: string,
    input: SaveHumanNoteRequest
  ): Promise<ProjectedHumanNote> {
    return this.#humanNotes.save(id, input);
  }

  humanNoteLists(): ReturnType<HumanNotes["lists"]> {
    return this.#humanNotes.lists();
  }

  search(query: string) {
    return this.#projection.search(query);
  }

  types(): readonly TypeDefinition[] {
    return this.#model.types;
  }

  views(): readonly SavedView[] {
    return this.#model.views;
  }

  modelSummary(): {
    states: string[];
    types: readonly TypeDefinition[];
    views: readonly SavedView[];
  } {
    return {
      states: [...this.#model.states],
      types: this.#model.types,
      views: this.#model.views
    };
  }

  typeResult(key: string):
    | (TypeDefinition & {
        items: StructuredNoteItem[];
      })
    | undefined {
    const type = this.#model.type(key);
    return type
      ? {
          ...type,
          items: this.#projection.queryHumanNotes({
            filter: { field: "type", operator: "equals", value: key }
          })
        }
      : undefined;
  }

  viewResult(key: string):
    | (SavedView & {
        groups: Array<{ key: string; items: StructuredNoteItem[] }>;
        items: StructuredNoteItem[];
      })
    | undefined {
    const view = this.#model.view(key);
    if (!view) {
      return undefined;
    }
    const items = this.#projection.queryHumanNotes(view.query);
    return {
      ...view,
      groups: groupedItems(items, view.query),
      items
    };
  }
}

function groupedItems(
  items: StructuredNoteItem[],
  query: QuerySpec
): Array<{ key: string; items: StructuredNoteItem[] }> {
  if (!query.groupBy) {
    return [];
  }
  const groups = new Map<string, StructuredNoteItem[]>();
  for (const item of items) {
    const value = item.fields[query.groupBy];
    const key = Array.isArray(value)
      ? value.join(", ")
      : value === undefined || value === null
        ? "Unspecified"
        : String(value);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups].map(([key, grouped]) => ({ key, items: grouped }));
}
