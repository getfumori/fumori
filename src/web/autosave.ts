export type AutosaveClock = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
};

export type AutosaveDraft =
  | { format: "rich"; bodyMarkdown: string }
  | { format: "raw"; sourceMarkdown: string };

type SaveInput = {
  baseRevision: string | null;
  draft: AutosaveDraft;
  keepalive: boolean;
};

type AutosaveOptions = {
  clock: AutosaveClock;
  initialRevision: string | null;
  policy: {
    debounceMs: number;
    maxDirtyMs: number;
  };
  save(input: SaveInput): Promise<{ revision: string }>;
};

export type AutosaveController = {
  change(draft: AutosaveDraft): void;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  isDirty(): boolean;
};

export function createAutosaveController(
  options: AutosaveOptions
): AutosaveController {
  let draft: AutosaveDraft | undefined;
  let debounceTimer: unknown;
  let maxDirtyTimer: unknown;
  let dirty = false;
  let revision = options.initialRevision;
  let changeVersion = 0;
  let inFlight: Promise<void> | undefined;

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
    const result = await options.save({
      baseRevision: revision,
      draft,
      keepalive
    });
    revision = result.revision;
    dirty = changeVersion !== savingVersion;
  };

  const flush = async (
    flushOptions: { keepalive?: boolean } = {}
  ): Promise<void> => {
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
      if (maxDirtyTimer === undefined) {
        maxDirtyTimer = options.clock.setTimeout(() => {
          void flush().catch(() => undefined);
        }, options.policy.maxDirtyMs);
      }
      dirty = true;
      clearDebounce();
      debounceTimer = options.clock.setTimeout(() => {
        void flush().catch(() => undefined);
      }, options.policy.debounceMs);
    },
    flush,
    isDirty() {
      return dirty;
    }
  };
}

export const systemAutosaveClock: AutosaveClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (id) => globalThis.clearTimeout(id as number)
};
