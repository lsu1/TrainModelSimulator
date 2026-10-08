import { STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY, parseLayout } from './layout';
import type { LayoutData } from './layout';

export const SAVED_DESIGNS_KEY = 'little-railways-saved-designs-v1';
export const DESIGN_RECOVERY_PREFIX = `${SAVED_DESIGNS_KEY}-recovery-`;

export interface SavedDesign {
  id: string;
  name: string;
  updatedAt: string;
  layout: LayoutData;
}

export interface SavedDesignLibrary {
  version: 1;
  designs: SavedDesign[];
}

export interface SavedDesignsReadResult {
  library: SavedDesignLibrary;
  /** Unreadable original data must be backed up before replacing the library. */
  recoveryRaw: string | null;
  error: string | null;
  /** An unreadable store cannot be safely overwritten without knowing its data. */
  unavailable: boolean;
}

type DesignStorage = Pick<Storage, 'getItem' | 'setItem'>;
const emptyLibrary = (): SavedDesignLibrary => ({ version: 1, designs: [] });
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validateDesignName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give your design a name before saving.');
  if (trimmed.length > 60) throw new Error('Choose a design name with 60 characters or fewer.');
  return trimmed;
}

function parseDesign(value: unknown): SavedDesign {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id.trim()
    || value.id.length > 100 || typeof value.name !== 'string'
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error('This saved design is invalid.');
  }
  const name = validateDesignName(value.name);
  return { id: value.id, name, updatedAt: value.updatedAt, layout: parseLayout({
    ...(isObject(value.layout) ? value.layout : {}), name,
  }) };
}

/** Read independently of the working autosave, keeping every valid snapshot. */
export function readSavedDesigns(storage?: DesignStorage): SavedDesignsReadResult {
  let raw: string | null = null;
  try {
    raw = (storage ?? localStorage).getItem(SAVED_DESIGNS_KEY);
    if (raw === null) return { library: emptyLibrary(), recoveryRaw: null, error: null, unavailable: false };
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== 1 || !Array.isArray(value.designs)) {
      throw new Error('Unsupported design library.');
    }
    const designs: SavedDesign[] = [];
    const ids = new Set<string>();
    let damaged = false;
    for (const candidate of value.designs) {
      try {
        const design = parseDesign(candidate);
        if (ids.has(design.id)) throw new Error('Repeated design ID.');
        ids.add(design.id);
        designs.push(design);
      } catch {
        damaged = true;
      }
    }
    return {
      library: { version: 1, designs },
      recoveryRaw: damaged ? raw : null,
      error: damaged ? 'Some saved designs could not be opened. The original data is kept for recovery.' : null,
      unavailable: false,
    };
  } catch {
    return {
      library: emptyLibrary(), recoveryRaw: raw, unavailable: raw === null,
      error: raw === null
        ? 'Saved designs are unavailable because browser storage could not be read.'
        : 'Saved designs could not be opened. The original data is kept for recovery.',
    };
  }
}

/** Deep snapshots prevent later edits to the working railway from changing a save. */
export function saveDesignSnapshot(
  library: SavedDesignLibrary,
  layout: LayoutData,
  name: string,
  activeId: string | null,
  asCopy = false,
  options: { id?: string; updatedAt?: string } = {},
): { library: SavedDesignLibrary; design: SavedDesign } {
  const normalizedName = validateDesignName(name);
  const replacing = !asCopy && activeId !== null && library.designs.some((design) => design.id === activeId);
  const id = replacing ? activeId! : (options.id ?? crypto.randomUUID());
  if (!replacing && library.designs.some((design) => design.id === id)) {
    throw new Error('This design ID is already in use. Try saving again.');
  }
  const design = parseDesign({
    id, name: normalizedName,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    layout: { ...layout, name: normalizedName },
  });
  return {
    library: {
      version: 1,
      designs: replacing
        ? library.designs.map((previous) => previous.id === id ? design : previous)
        : [...library.designs, design],
    },
    design,
  };
}

export function removeDesignSnapshot(library: SavedDesignLibrary, id: string): SavedDesignLibrary {
  if (!library.designs.some((design) => design.id === id)) return library;
  return { version: 1, designs: library.designs.filter((design) => design.id !== id) };
}

/** Only report success after storage accepts the complete library. */
export function persistSavedDesigns(
  library: SavedDesignLibrary,
  recoveryRaw: string | null = null,
  storage?: DesignStorage,
): void {
  try {
    const target = storage ?? localStorage;
    if (recoveryRaw !== null) {
      // A unique key retains previous recoveries rather than overwriting them.
      target.setItem(`${DESIGN_RECOVERY_PREFIX}${crypto.randomUUID()}`, recoveryRaw);
    }
    target.setItem(SAVED_DESIGNS_KEY, JSON.stringify(library));
  } catch {
    throw new Error('Your saved designs could not be updated. Browser storage may be full or unavailable. Download a backup and try again.');
  }
}

/** Keep identity with the working layout so new presets cannot overwrite an old save. */
export function readWorkingDesignId(library: SavedDesignLibrary, storage?: DesignStorage): string | null {
  for (const key of [STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = (storage ?? localStorage).getItem(key);
      if (!raw) continue;
      const value: unknown = JSON.parse(raw);
      if (!isObject(value)) continue;
      parseLayout(value);
      // The first valid working layout wins, even when it is a new draft.
      return typeof value.savedDesignId === 'string'
        && library.designs.some((design) => design.id === value.savedDesignId)
        ? value.savedDesignId : null;
    } catch { /* Mirror loadLayout's fallback without losing an old save identity. */ }
  }
  return null;
}
