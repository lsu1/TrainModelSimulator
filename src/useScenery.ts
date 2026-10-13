import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlacedAccessory } from './layout';
import type { Track } from './track';
import { generateScenery, sceneryGeometryKey } from './sceneryGeneration';
import type { SceneryArea, SceneryDensity, SceneryFeature, SceneryPlan, SceneryTheme } from './sceneryTypes';

export type SceneryAreaSize = 'small' | 'medium' | 'large';
const AREA_RADII: Record<SceneryAreaSize, number> = { small: 230, medium: 400, large: 650 };
const THEME_FEATURES: Record<SceneryTheme, SceneryFeature[]> = {
  city: ['buildings', 'roads', 'cars', 'people', 'trees', 'parks'],
  countryside: ['buildings', 'roads', 'cars', 'trees', 'parks'],
  hills: ['trees', 'parks'],
};

interface SceneryOptions {
  tracks: Track[];
  accessories: PlacedAccessory[];
  existing: SceneryPlan | undefined;
  /** A replacement/open/import, rather than an ordinary track edit. */
  layoutRevision: number;
  busy: boolean;
  apply: (plan: SceneryPlan | undefined, expectedGeometryKey: string) => boolean;
  notify: (message: string, error?: boolean) => void;
}

/** Owns drafts and previews; only Keep (or an explicit saved-scene action) writes a layout. */
export function useScenery(options: SceneryOptions) {
  const { tracks, accessories, existing, layoutRevision, busy } = options;
  const [theme, setThemeValue] = useState<SceneryTheme>(existing?.theme ?? 'city');
  const [density, setDensity] = useState<SceneryDensity>(existing?.density ?? 'balanced');
  const [features, setFeatures] = useState<SceneryFeature[]>(existing?.features ?? THEME_FEATURES.city);
  const [prompt, setPrompt] = useState(existing?.prompt ?? '');
  const [preview, setPreview] = useState<SceneryPlan | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [area, setAreaValue] = useState<SceneryArea | null>(null);
  const [areaSize, setAreaSizeValue] = useState<SceneryAreaSize>('medium');
  const [generating, setGenerating] = useState(false);
  const geometryKey = useMemo(() => sceneryGeometryKey(tracks, accessories), [tracks, accessories]);
  const previewGeometry = useRef<string | null>(null);
  const previewRevision = useRef<number | null>(null);
  const seed = useRef((existing?.seed ?? Date.now()) >>> 0);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousGeometry = useRef(geometryKey);
  const previousRevision = useRef(layoutRevision);
  const current = useRef({ options, geometryKey, theme, density, features, prompt, area, preview });
  current.current = { options, geometryKey, theme, density, features, prompt, area, preview };

  const cancelPending = useCallback(() => {
    requestId.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setGenerating(false);
  }, []);

  // Tabs only hide this controller. A genuinely different railway clears its draft.
  useEffect(() => {
    if (previousRevision.current === layoutRevision) return;
    previousRevision.current = layoutRevision;
    previousGeometry.current = geometryKey;
    cancelPending();
    setPreview(null);
    previewGeometry.current = null;
    previewRevision.current = null;
    setPreviewMessage(null);
    setAreaValue(null);
    setMarking(false);
    setThemeValue(existing?.theme ?? 'city');
    setDensity(existing?.density ?? 'balanced');
    setFeatures(existing?.features ?? THEME_FEATURES.city);
    setPrompt(existing?.prompt ?? '');
    seed.current = (existing?.seed ?? Date.now()) >>> 0;
  }, [layoutRevision, geometryKey, existing, cancelPending]);

  useEffect(() => {
    if (previousGeometry.current === geometryKey) return;
    previousGeometry.current = geometryKey;
    cancelPending();
    setPreview(null);
    previewGeometry.current = null;
    previewRevision.current = null;
    setMarking(false);
    setAreaValue(null);
    setPreviewMessage('Your railway changed. Build a fresh preview to fit its new shape.');
  }, [geometryKey, cancelPending]);

  useEffect(() => {
    if (!busy) return;
    if (timer.current !== null) setPreviewMessage('Preview cancelled while you place pieces or connect trains. You can try again afterwards.');
    cancelPending();
    setMarking(false);
  }, [busy, cancelPending]);
  useEffect(() => () => {
    requestId.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const setTheme = (next: SceneryTheme) => {
    if (next === theme) return;
    // An old theme word in a saved prompt must not silently undo this choice.
    setPrompt('');
    setThemeValue(next);
    setFeatures([...THEME_FEATURES[next]]);
  };
  const toggleFeature = (feature: SceneryFeature) => {
    setFeatures((values) => values.includes(feature)
      ? values.filter((value) => value !== feature) : [...values, feature]);
  };
  const setArea = (next: SceneryArea | null) => {
    if (current.current.options.busy) return;
    if (next && (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.radius))) return;
    cancelPending();
    setAreaValue(next ? { ...next, radius: Math.max(20, Math.min(2000, next.radius)) } : null);
    setMarking(false);
    setPreview(null);
    previewGeometry.current = null;
    previewRevision.current = null;
    setPreviewMessage(next ? 'This outlined area is ready. Tell us what should go here.' : null);
  };
  const setAreaSize = (next: SceneryAreaSize) => {
    setAreaSizeValue(next);
    if (area) setArea({ ...area, radius: AREA_RADII[next] });
  };
  const startMarking = () => {
    if (current.current.options.busy || generating) return;
    setMarking(true);
  };
  const stopMarking = () => setMarking(false);

  const generate = () => {
    const snapshot = current.current;
    if (snapshot.options.busy || generating) return;
    cancelPending();
    setGenerating(true);
    setMarking(false);
    setPreviewMessage('Arranging your surroundings…');
    const id = requestId.current;
    const revision = snapshot.options.layoutRevision;
    const key = snapshot.geometryKey;
    seed.current = (seed.current + 1) >>> 0;
    const nextSeed = seed.current;
    // Give the controls a frame to show their busy state before bounded generation.
    timer.current = setTimeout(() => {
      timer.current = null;
      const now = current.current;
      if (id !== requestId.current || now.options.busy || now.geometryKey !== key || now.options.layoutRevision !== revision) return;
      try {
        const result = generateScenery(snapshot.options.tracks, snapshot.options.accessories, {
          theme: snapshot.theme, density: snapshot.density, features: snapshot.features,
          prompt: snapshot.prompt, seed: nextSeed, area: snapshot.area, existing: snapshot.options.existing,
        });
        setPreview(result.plan);
        previewGeometry.current = result.plan ? key : null;
        previewRevision.current = result.plan ? revision : null;
        setPreviewMessage(result.message);
        if (result.plan) {
          setThemeValue(result.plan.theme);
          setDensity(result.plan.density);
          setFeatures(result.plan.features);
        }
      } catch {
        setPreview(null);
        previewGeometry.current = null;
        previewRevision.current = null;
        setPreviewMessage('We could not arrange this preview. Try a smaller area or fewer scenery choices.');
      }
      setGenerating(false);
    }, 0);
  };

  const keep = () => {
    const now = current.current;
    if (now.options.busy || !now.preview || generating) return;
    if (previewGeometry.current !== now.geometryKey || previewRevision.current !== now.options.layoutRevision) {
      setPreview(null);
      setPreviewMessage('Your railway changed. Build a fresh preview before keeping it.');
      return;
    }
    if (now.options.apply(now.preview, now.geometryKey)) {
      setPreview(null);
      previewGeometry.current = null;
      previewRevision.current = null;
      setPreviewMessage('Surroundings kept! You can change an area or Undo this whole change.');
      now.options.notify('Surroundings kept. Undo returns to the previous scene.');
    } else {
      setPreview(null);
      previewGeometry.current = null;
      previewRevision.current = null;
      setPreviewMessage('This preview could not be kept. Build a fresh preview and try again.');
    }
  };
  const cancel = () => {
    cancelPending();
    setPreview(null);
    previewGeometry.current = null;
    previewRevision.current = null;
    setMarking(false);
    setPreviewMessage('Preview cancelled. Your saved surroundings are back.');
  };
  const removeSurroundings = () => {
    const now = current.current;
    if (now.options.busy || generating || !now.options.existing) return;
    if (now.options.apply(undefined, now.geometryKey)) {
      cancelPending();
      setPreview(null);
      previewGeometry.current = null;
      previewRevision.current = null;
      setMarking(false);
      setAreaValue(null);
      setPreviewMessage('Surroundings removed. Undo brings them back.');
    }
  };
  const setTrafficPlaying = (playing: boolean) => {
    const now = current.current;
    if (now.options.busy || generating) return;
    if (now.preview) {
      setPreview({ ...now.preview, trafficPlaying: playing });
    } else if (now.options.existing && now.options.existing.trafficPlaying !== playing) {
      now.options.apply({ ...now.options.existing, trafficPlaying: playing }, now.geometryKey);
    }
  };
  const activePreview = previewGeometry.current === geometryKey && previewRevision.current === layoutRevision ? preview : null;
  const shown = activePreview ?? existing;

  return {
    theme, setTheme, density, setDensity, features, toggleFeature, prompt, setPrompt,
    preview: activePreview, previewMessage, marking, startMarking, stopMarking,
    area, setArea, clearArea: () => setArea(null), areaSize, setAreaSize,
    areaRadius: AREA_RADII[areaSize], generate, regenerate: generate, generating,
    keep, cancel, removeSurroundings, setTrafficPlaying, existing, busy,
    hasPreview: activePreview !== null, geometryKey,
    trafficPlaying: shown?.trafficPlaying ?? true,
    hasCars: (shown?.cars.length ?? 0) > 0,
  };
}

export type SceneryController = ReturnType<typeof useScenery>;
