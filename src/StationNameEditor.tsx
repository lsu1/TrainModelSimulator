import { useEffect, useId, useState } from 'react';
import type { PlacedAccessory } from './layout';
import { defaultStationName, MAX_STATION_NAME_LENGTH, normalizeStationName } from './stationName';

export default function StationNameEditor({ accessory, accessoryType, onApply }: {
  accessory: PlacedAccessory;
  accessoryType?: string;
  onApply: (name: string) => boolean;
}) {
  const fallback = defaultStationName(accessoryType);
  const savedName = accessory.stationName ?? fallback;
  const [draft, setDraft] = useState(savedName);
  const [error, setError] = useState('');
  const descriptionId = useId();
  useEffect(() => {
    setDraft(savedName);
    setError('');
  }, [accessory.id, savedName]);

  const apply = () => {
    try {
      const normalized = normalizeStationName(draft);
      if (onApply(draft)) {
        setDraft(normalized ?? fallback);
        setError('');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Choose a valid station name.');
    }
  };

  return (
    <form className="station-name-editor" onSubmit={event => { event.preventDefault(); apply(); }}>
      <label>
        Station name
        <input
          aria-label="Station name"
          aria-describedby={descriptionId}
          aria-invalid={error ? true : undefined}
          type="text"
          maxLength={MAX_STATION_NAME_LENGTH}
          value={draft}
          onChange={event => { setDraft(event.target.value); setError(''); }}
        />
      </label>
      <p id={descriptionId}>Shown on this piece’s sign. Up to {MAX_STATION_NAME_LENGTH} characters.</p>
      <div className="station-name-actions">
        <button type="submit" className="button primary" aria-label="Apply station name" disabled={draft === savedName}>Apply name</button>
        <button type="button" className="button secondary" aria-label="Reset station name" disabled={accessory.stationName === undefined && draft === fallback} onClick={() => {
          if (onApply('')) { setDraft(fallback); setError(''); }
        }}>Reset to default</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
