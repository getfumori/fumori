export type AutosaveClock = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
};

export type AutosaveDraft =
  | { format: "rich"; bodyMarkdown: string }
  | { format: "raw"; sourceMarkdown: string }
  | {
      format: "metadata";
      type: string | null;
      state: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, string | number | boolean | string[]>;
      relationships?: Record<string, string | string[]>;
    }
  | {
      format: "document";
      bodyMarkdown: string;
      type: string | null;
      state: string;
      tags: string[];
      aliases: string[];
      properties: Record<string, string | number | boolean | string[]>;
      relationships?: Record<string, string | string[]>;
    };

type SaveInput = {
  baseRevision: string | null;
  draft: AutosaveDraft;
  keepalive: boolean;
};

type AutosaveOptions<Saved extends { revision: string }> = {
  clock: AutosaveClock;
  initialRevision: string | null;
  policy: {
    debounceMs: number;
    maxDirtyMs: number;
  };
  save(input: SaveInput): Promise<Saved>;
  saved?(event: {
    draft: AutosaveDraft;
    isCurrent: boolean;
    result: Saved;
  }): void;
  conflicted?(event: {
    draft: AutosaveDraft;
    error: AutosaveConflictError;
  }): void;
};

export class AutosaveConflictError extends Error {
  constructor(readonly currentRevision: string) {
    super("Newer canonical content requires resolution.");
    this.name = "AutosaveConflictError";
  }
}

export type AutosaveController = {
  change(draft: AutosaveDraft): void;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  isDirty(): boolean;
  isPaused(): boolean;
  resolveConflict(options: {
    currentRevision: string;
    keepDraft: boolean;
  }): void;
};

export function createAutosaveController<Saved extends { revision: string }>(
  options: AutosaveOptions<Saved>
): AutosaveController {
  let draft: AutosaveDraft | undefined;
  let debounceTimer: unknown;
  let maxDirtyTimer: unknown;
  let dirty = false;
  let revision = options.initialRevision;
  let changeVersion = 0;
  let inFlight: Promise<void> | undefined;
  let pausedConflict: AutosaveConflictError | undefined;

  const clearDebounce = () => {
    if (debounceTimer !== undefined) {
      options.clock.clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };

  const clearMaxDirty = () => {
    if (maxDirtyTimer !== undefined) {
      options.clock.clearTimeout(maxDirtyTimer);
      maxDirtyTimer = undefined;
    }
  };

  const saveSnapshot = async (keepalive: boolean): Promise<void> => {
    clearDebounce();
    clearMaxDirty();
    const savingVersion = changeVersion;
    if (!draft) {
      return;
    }
    const publishedDraft = draft;
    let result: Saved;
    try {
      result = await options.save({
        baseRevision: revision,
        draft: publishedDraft,
        keepalive
      });
    } catch (reason) {
      if (reason instanceof AutosaveConflictError) {
        pausedConflict = reason;
        options.conflicted?.({
          draft: publishedDraft,
          error: reason
        });
      }
      throw reason;
    }
    revision = result.revision;
    dirty = changeVersion !== savingVersion;
    options.saved?.({
      draft: publishedDraft,
      isCurrent: !dirty,
      result
    });
  };

  const flush = async (
    flushOptions: { keepalive?: boolean } = {}
  ): Promise<void> => {
    if (pausedConflict) {
      throw pausedConflict;
    }
    while (dirty || inFlight) {
      if (inFlight) {
        await inFlight;
        continue;
      }
      const pending = saveSnapshot(flushOptions.keepalive ?? false);
      inFlight = pending;
      try {
        await pending;
      } finally {
        if (inFlight === pending) {
          inFlight = undefined;
        }
      }
    }
  };

  return {
    change(nextDraft) {
      draft = nextDraft;
      changeVersion += 1;
      dirty = true;
      if (pausedConflict) {
        clearDebounce();
        clearMaxDirty();
        return;
      }
      if (maxDirtyTimer === undefined) {
        maxDirtyTimer = options.clock.setTimeout(() => {
          void flush().catch(() => undefined);
        }, options.policy.maxDirtyMs);
      }
      clearDebounce();
      debounceTimer = options.clock.setTimeout(() => {
        void flush().catch(() => undefined);
      }, options.policy.debounceMs);
    },
    flush,
    isDirty() {
      return dirty;
    },
    isPaused() {
      return pausedConflict !== undefined;
    },
    resolveConflict({ currentRevision, keepDraft }) {
      clearDebounce();
      clearMaxDirty();
      revision = currentRevision;
      pausedConflict = undefined;
      if (!keepDraft) {
        draft = undefined;
        dirty = false;
      } else {
        dirty = draft !== undefined;
      }
    }
  };
}

export const systemAutosaveClock: AutosaveClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (id) => globalThis.clearTimeout(id as number)
};
