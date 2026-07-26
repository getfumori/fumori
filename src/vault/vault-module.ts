import type { SaveDailyNoteRequest } from "../contracts/daily-note.js";
import type { CheckpointResponse } from "../contracts/checkpoint.js";
import type {
  DeleteHumanNoteRequest,
  SaveHumanNoteRequest
} from "../contracts/human-note.js";
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
import { RepositoryCoordinator } from "./repository-coordinator.js";

export {
  ExplicitDailyNoteCreationRequiredError,
  InvalidDailyNoteMarkdownError,
  StaleDailyNoteRevisionError
} from "./daily-notes.js";
export {
  HumanNoteDeletionImpactChangedError,
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
  readonly #coordinator: RepositoryCoordinator;

  private constructor(options: {
    identity: VaultIdentity;
    dailyNotes: DailyNotes;
    humanNotes: HumanNotes;
    projection: InMemoryProjection;
    model: OrganizationModel;
    coordinator: RepositoryCoordinator;
  }) {
    this.identity = options.identity;
    this.#dailyNotes = options.dailyNotes;
    this.#humanNotes = options.humanNotes;
    this.#projection = options.projection;
    this.#model = options.model;
    this.#coordinator = options.coordinator;
  }

  static async open(
    inputPath: string,
    today: () => string
  ): Promise<VaultModule> {
    const vault = await openVault(inputPath);
    const coordinator = await RepositoryCoordinator.open(vault.path);
    const model = await loadOrganizationModel(vault.path);
    const projection = new InMemoryProjection({
      inboxState: model.inboxState,
      archivedState: model.archivedState,
      relationships: model.relationships
    });
    const dailyNotes = new DailyNotes(
      vault.path,
      today,
      model,
      coordinator,
      (note) => {
        projection.publishDailyNote(note);
      }
    );
    await dailyNotes.rebuildProjection();
    const humanNotes = new HumanNotes(
      vault.path,
      projection,
      model,
      coordinator,
      (overrides) => dailyNotes.projectionSnapshots(overrides)
    );
    await humanNotes.rebuildProjection();
    projection.assertUniqueObjectIds();
    await coordinator.checkpoint("Recovery checkpoint");
    return new VaultModule({
      identity: { id: vault.id, name: vault.name },
      dailyNotes,
      humanNotes,
      projection,
      model,
      coordinator
    });
  }

  checkpoint(): Promise<CheckpointResponse> {
    return this.#coordinator.checkpoint();
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

  humanNote(id: string): Promise<ProjectedHumanNote | undefined> {
    return this.#humanNotes.read(id);
  }

  createHumanNote(type?: string, title?: string): Promise<ProjectedHumanNote> {
    return this.#humanNotes.create(type, title);
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

  humanNoteDeletionImpact(id: string) {
    return this.#humanNotes.deletionImpact(id);
  }

  deleteHumanNote(id: string, input: DeleteHumanNoteRequest): Promise<void> {
    return this.#humanNotes.delete(id, input);
  }

  noteConnections(id: string) {
    return this.#projection.connections(id);
  }

  wikilinkSuggestions(query: string) {
    return this.#projection.suggestions(query);
  }

  renameHumanNoteToTitle(id: string, baseRevision: string) {
    return this.#humanNotes.renameToTitle(id, baseRevision);
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
    standaloneCreationState: string;
    archivedState: string;
    types: readonly TypeDefinition[];
    relationships: OrganizationModel["relationships"];
    views: readonly SavedView[];
  } {
    return {
      states: [...this.#model.states],
      standaloneCreationState: this.#model.standaloneCreationState,
      archivedState: this.#model.archivedState,
      types: this.#model.types,
      relationships: this.#model.relationships,
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
