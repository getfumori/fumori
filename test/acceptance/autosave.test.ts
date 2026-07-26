import { describe, expect, test, vi } from "vitest";

import {
  AutosaveConflictError,
  createAutosaveController,
  type AutosaveClock
} from "../../src/web/autosave.js";

class FakeClock implements AutosaveClock {
  #nextId = 1;
  #now = 0;
  #tasks = new Map<
    number,
    { callback: () => void; dueAt: number }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId++;
    this.#tasks.set(id, { callback, dueAt: this.#now + delayMs });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.#tasks.delete(Number(id));
  }

  advanceBy(milliseconds: number): void {
    const target = this.#now + milliseconds;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) {
        break;
      }
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#now = task.dueAt;
      task.callback();
    }
    this.#now = target;
  }
}

describe("autosave policy", () => {
  test("saves after 1.5 seconds without another edit", async () => {
    const clock = new FakeClock();
    const save = vi.fn(async () => ({ revision: "a".repeat(64) }));
    const autosave = createAutosaveController({
      clock,
      initialRevision: null,
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save
    });

    autosave.change({ format: "rich", bodyMarkdown: "First" });
    clock.advanceBy(1_000);
    autosave.change({
      format: "rich",
      bodyMarkdown: "First and second"
    });
    clock.advanceBy(1_499);
    expect(save).not.toHaveBeenCalled();

    clock.advanceBy(1);
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      baseRevision: null,
      draft: {
        format: "rich",
        bodyMarkdown: "First and second"
      },
      keepalive: false
    });
  });

  test("saves at 10 seconds even while edits keep resetting the debounce", async () => {
    const clock = new FakeClock();
    const save = vi.fn(async () => ({ revision: "b".repeat(64) }));
    const autosave = createAutosaveController({
      clock,
      initialRevision: "a".repeat(64),
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save
    });

    autosave.change({ format: "rich", bodyMarkdown: "Draft at 0" });
    for (let second = 1; second <= 9; second += 1) {
      clock.advanceBy(1_000);
      autosave.change({
        format: "rich",
        bodyMarkdown: `Draft at ${second}`
      });
    }
    clock.advanceBy(999);
    expect(save).not.toHaveBeenCalled();

    clock.advanceBy(1);
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      baseRevision: "a".repeat(64),
      draft: {
        format: "rich",
        bodyMarkdown: "Draft at 9"
      },
      keepalive: false
    });
  });

  test("flushes immediately for transitions and requests keepalive on page exit", async () => {
    const clock = new FakeClock();
    const revisions = ["b".repeat(64), "c".repeat(64)];
    const save = vi.fn(async () => ({ revision: revisions.shift()! }));
    const autosave = createAutosaveController({
      clock,
      initialRevision: "a".repeat(64),
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save
    });

    autosave.change({
      format: "rich",
      bodyMarkdown: "Before navigation"
    });
    await autosave.flush();
    expect(save).toHaveBeenNthCalledWith(1, {
      baseRevision: "a".repeat(64),
      draft: {
        format: "rich",
        bodyMarkdown: "Before navigation"
      },
      keepalive: false
    });
    expect(autosave.isDirty()).toBe(false);

    autosave.change({
      format: "raw",
      sourceMarkdown: "Before page exit"
    });
    await autosave.flush({ keepalive: true });
    expect(save).toHaveBeenNthCalledWith(2, {
      baseRevision: "b".repeat(64),
      draft: {
        format: "raw",
        sourceMarkdown: "Before page exit"
      },
      keepalive: true
    });
    expect(autosave.isDirty()).toBe(false);
  });

  test("does not lose an edit made while a save is in flight", async () => {
    const clock = new FakeClock();
    let finishFirstSave: ((value: { revision: string }) => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ revision: string }>((resolve) => {
            finishFirstSave = resolve;
          })
      )
      .mockResolvedValueOnce({ revision: "b".repeat(64) });
    const autosave = createAutosaveController({
      clock,
      initialRevision: null,
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save
    });

    autosave.change({
      format: "rich",
      bodyMarkdown: "First snapshot"
    });
    const flushing = autosave.flush();
    autosave.change({
      format: "rich",
      bodyMarkdown: "Edit during save"
    });
    finishFirstSave?.({ revision: "a".repeat(64) });
    await flushing;

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, {
      baseRevision: "a".repeat(64),
      draft: {
        format: "rich",
        bodyMarkdown: "Edit during save"
      },
      keepalive: false
    });
    expect(autosave.isDirty()).toBe(false);
  });

  test("identifies whether a completion published the current draft", async () => {
    const clock = new FakeClock();
    const finishSaves: Array<
      (value: { revision: string; canonical: string }) => void
    > = [];
    const save = vi.fn(
      () =>
        new Promise<{ revision: string; canonical: string }>((resolve) => {
          finishSaves.push(resolve);
        })
    );
    const saved = vi.fn();
    const autosave = createAutosaveController({
      clock,
      initialRevision: "a".repeat(64),
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save,
      saved
    });
    const publishedDraft = {
      format: "rich" as const,
      bodyMarkdown: "Published snapshot"
    };

    autosave.change(publishedDraft);
    const flushing = autosave.flush();
    autosave.change({
      format: "rich",
      bodyMarkdown: "Newer local draft"
    });
    finishSaves[0]?.({
      revision: "b".repeat(64),
      canonical: "Published snapshot"
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(saved).toHaveBeenCalledWith({
      draft: publishedDraft,
      isCurrent: false,
      result: {
        revision: "b".repeat(64),
        canonical: "Published snapshot"
      }
    });

    finishSaves[1]?.({
      revision: "c".repeat(64),
      canonical: "Newer local draft"
    });
    await flushing;
    expect(saved).toHaveBeenLastCalledWith({
      draft: {
        format: "rich",
        bodyMarkdown: "Newer local draft"
      },
      isCurrent: true,
      result: {
        revision: "c".repeat(64),
        canonical: "Newer local draft"
      }
    });
  });

  test("pauses after a stale save and retains later edits until explicit resolution", async () => {
    const clock = new FakeClock();
    let pausedWhenReported = false;
    const save = vi
      .fn()
      .mockRejectedValueOnce(new AutosaveConflictError("b".repeat(64)))
      .mockResolvedValueOnce({ revision: "c".repeat(64) });
    let autosave: ReturnType<typeof createAutosaveController>;
    autosave = createAutosaveController({
      clock,
      initialRevision: "a".repeat(64),
      policy: { debounceMs: 1_500, maxDirtyMs: 10_000 },
      save,
      conflicted() {
        pausedWhenReported = autosave.isPaused();
      }
    });

    autosave.change({
      format: "rich",
      bodyMarkdown: "Draft that became stale"
    });
    await expect(autosave.flush()).rejects.toBeInstanceOf(
      AutosaveConflictError
    );
    expect(autosave.isPaused()).toBe(true);
    expect(pausedWhenReported).toBe(true);
    expect(autosave.isDirty()).toBe(true);

    autosave.change({
      format: "rich",
      bodyMarkdown: "Complete draft after the conflict"
    });
    clock.advanceBy(10_000);
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();

    autosave.resolveConflict({
      currentRevision: "b".repeat(64),
      keepDraft: true
    });
    await autosave.flush();

    expect(save).toHaveBeenNthCalledWith(2, {
      baseRevision: "b".repeat(64),
      draft: {
        format: "rich",
        bodyMarkdown: "Complete draft after the conflict"
      },
      keepalive: false
    });
    expect(autosave.isPaused()).toBe(false);
    expect(autosave.isDirty()).toBe(false);
  });
});
