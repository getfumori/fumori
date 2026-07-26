import { ref, type Ref } from "vue";

import type { AutosaveController } from "./autosave";

export type ContentConflictState<Current> = {
  current?: Current;
  currentRevision: string;
  loadError?: string;
  loading: boolean;
  manual: boolean;
  open: boolean;
};

type ContentConflictOptions<Current> = {
  getAutosave(): AutosaveController | undefined;
  loadCurrent(): Promise<Current>;
  revision(current: Current): string | null;
  applyCurrent(current: Current): void;
  setSaveError(message: string | undefined): void;
  setSaveStatus(status: "conflict" | "dirty" | "saved"): void;
};

export function useContentConflict<Current>(
  options: ContentConflictOptions<Current>
) {
  const contentConflict = ref<ContentConflictState<Current>>() as Ref<
    ContentConflictState<Current> | undefined
  >;
  let loadSequence = 0;

  async function openContentConflict(currentRevision: string): Promise<void> {
    const sequence = ++loadSequence;
    const state: ContentConflictState<Current> = {
      currentRevision,
      loading: true,
      manual: false,
      open: true
    };
    contentConflict.value = state;
    options.setSaveStatus("conflict");
    options.setSaveError(undefined);
    try {
      const current = await options.loadCurrent();
      const loadedRevision = options.revision(current);
      if (!loadedRevision) {
        throw new Error("Current saved content has no revision.");
      }
      if (sequence !== loadSequence || !contentConflict.value) {
        return;
      }
      contentConflict.value.current = current;
      contentConflict.value.currentRevision = loadedRevision;
      contentConflict.value.loading = false;
    } catch (reason) {
      if (sequence !== loadSequence || !contentConflict.value) {
        return;
      }
      contentConflict.value.loading = false;
      contentConflict.value.loadError =
        reason instanceof Error
          ? reason.message
          : "Current saved content could not be loaded.";
      options.setSaveError(contentConflict.value.loadError);
    }
  }

  function retryContentConflict(): void {
    if (contentConflict.value) {
      void openContentConflict(contentConflict.value.currentRevision);
    }
  }

  function closeContentConflict(): void {
    if (contentConflict.value) {
      contentConflict.value.open = false;
    }
  }

  function reviewContentConflict(): void {
    if (contentConflict.value) {
      contentConflict.value.open = true;
    }
  }

  function combineContentManually(): void {
    if (contentConflict.value?.current) {
      contentConflict.value.manual = true;
      contentConflict.value.open = false;
    }
  }

  function adoptCurrentContent(): void {
    const state = contentConflict.value;
    const autosave = options.getAutosave();
    if (!state?.current || !autosave) {
      return;
    }
    autosave.resolveConflict({
      currentRevision: state.currentRevision,
      keepDraft: false
    });
    options.applyCurrent(state.current);
    contentConflict.value = undefined;
    options.setSaveError(undefined);
    options.setSaveStatus("saved");
  }

  async function saveDraftAgainstCurrent(): Promise<void> {
    const state = contentConflict.value;
    const autosave = options.getAutosave();
    if (!state?.current || !autosave) {
      return;
    }
    autosave.resolveConflict({
      currentRevision: state.currentRevision,
      keepDraft: true
    });
    contentConflict.value = undefined;
    options.setSaveStatus("dirty");
    try {
      await autosave.flush();
    } catch {
      // The save callback exposes a newer conflict or ordinary save failure.
    }
  }

  return {
    adoptCurrentContent,
    closeContentConflict,
    combineContentManually,
    contentConflict,
    openContentConflict,
    retryContentConflict,
    reviewContentConflict,
    saveDraftAgainstCurrent
  };
}
