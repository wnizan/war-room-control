// ---------------------------------------------------------------------------
// Selection store — tracks the currently selected unit ID
// Same external-store pattern as other stores in this project
// ---------------------------------------------------------------------------

type Listener = () => void;

let selectedId: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

export const selectionStore = {
  select(id: string | null): void {
    if (selectedId === id) return;
    selectedId = id;
    notify();
  },

  getSnapshot(): string | null {
    return selectedId;
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};
