import type { SaveDailyNoteRequest } from "../contracts/daily-note.js";
import type { SaveHumanNoteRequest } from "../contracts/human-note.js";
import {
  DailyNotes,
  type DailyNoteSnapshot
} from "./daily-notes.js";
import { HumanNotes } from "./human-notes.js";
import {
  InMemoryProjection,
  type ProjectedHumanNote
} from "./in-memory-projection.js";
import { loadOrganizationModel } from "./organization-model.js";
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

  private constructor(options: {
    identity: VaultIdentity;
    dailyNotes: DailyNotes;
    humanNotes: HumanNotes;
    projection: InMemoryProjection;
  }) {
    this.identity = options.identity;
    this.#dailyNotes = options.dailyNotes;
    this.#humanNotes = options.humanNotes;
    this.#projection = options.projection;
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
    await projection.rebuildDailyNotes(vault.path);
    const dailyNotes = new DailyNotes(vault.path, today, (note) => {
      projection.publishDailyNote(note);
    });
    const humanNotes = new HumanNotes(vault.path, projection, model);
    await humanNotes.rebuildProjection();
    return new VaultModule({
      identity: { id: vault.id, name: vault.name },
      dailyNotes,
      humanNotes,
      projection
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

  createHumanNote(): Promise<ProjectedHumanNote> {
    return this.#humanNotes.create();
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
}
