import { Building2, Check, CircleDashed, Mountain, RefreshCw, Sparkles, Trees, X } from 'lucide-react';
import type { SceneryController } from './useScenery';
import type { SceneryFeature, SceneryTheme } from './sceneryTypes';
import { SCENERY_LIMITS } from './sceneryTypes';
import './scenery.css';

const THEMES = [
  { value: 'city' as const, label: 'City', icon: Building2 },
  { value: 'countryside' as const, label: 'Countryside', icon: Trees },
  { value: 'hills' as const, label: 'Hills', icon: Mountain },
];
const FEATURES: { value: SceneryFeature; label: string }[] = [
  { value: 'buildings', label: 'Buildings' }, { value: 'roads', label: 'Roads' },
  { value: 'cars', label: 'Cars' }, { value: 'people', label: 'People' },
  { value: 'trees', label: 'Trees' }, { value: 'parks', label: 'Parks' },
  { value: 'river', label: 'River' },
];
const EXAMPLES: Record<SceneryTheme, { label: string; prompt: string }[]> = {
  city: [
    { label: 'Shops & apartments', prompt: 'A city with apartments, shops, roads, cars, people and trees.' },
    { label: 'A playground', prompt: 'A playground and a park with trees.' },
    { label: 'A quiet neighbourhood', prompt: 'A quiet city with small houses, shops and trees.' },
  ],
  countryside: [
    { label: 'A village', prompt: 'A countryside village with small houses, roads, cars and trees.' },
    { label: 'A river', prompt: 'Countryside with a river, trees and a small village.' },
    { label: 'A green park', prompt: 'A park with trees and people.' },
  ],
  hills: [
    { label: 'Green hills', prompt: 'Hills with trees and a park.' },
    { label: 'Hill village', prompt: 'Hills with small houses, trees and a road with cars.' },
  ],
};

export function SceneryActions({ scenery }: { scenery: SceneryController }) {
  const title = scenery.area ? 'Change this area'
    : scenery.theme === 'city' ? 'Build my city'
      : scenery.theme === 'countryside' ? 'Build my countryside' : 'Build my hills';
  const keepTitle = scenery.area ? 'Keep this change'
    : scenery.preview?.theme === 'city' ? 'Keep this city' : 'Keep these surroundings';
  return <div className="scenery-actions">
    {scenery.hasPreview ? <>
      <button className="button primary scenery-keep" disabled={scenery.busy || scenery.generating} onClick={scenery.keep}>
        <Check size={15} /> {keepTitle}
      </button>
      <button className="button secondary" disabled={scenery.busy || scenery.generating} onClick={scenery.regenerate}>
        <RefreshCw size={15} /> Try another
      </button>
      <button className="button secondary" disabled={scenery.busy} onClick={scenery.cancel}><X size={15} /> Cancel</button>
    </> : <button className="button primary scenery-generate" disabled={scenery.busy || scenery.generating} onClick={scenery.generate}>
      <Sparkles size={15} /> {scenery.generating ? 'Building your preview…' : title}
    </button>}
    {scenery.generating && <button className="button secondary" onClick={scenery.cancel}>Cancel preview</button>}
  </div>;
}

export default function SceneryPanel({ scenery }: { scenery: SceneryController }) {
  const { busy, generating } = scenery;
  const locked = busy || generating;
  return <section className="scenery-panel" aria-label="Scenery builder">
    <h3><Sparkles size={17} /> Build the surroundings</h3>
    <p className="scenery-intro">Give any railway its own world. Preview it, then keep what you like.</p>
    <fieldset className="scenery-fields" disabled={locked}>
      <legend className="scenery-label">Choose a feeling</legend>
      <div className="scenery-themes" role="group" aria-label="Scenery theme">
        {THEMES.map(({ value, label, icon: Icon }) => <button key={value} type="button"
          className="scenery-theme" aria-pressed={scenery.theme === value} onClick={() => scenery.setTheme(value)}>
          <Icon size={20} /><span>{label}</span>
        </button>)}
      </div>
      <div className="scenery-features" role="group" aria-label="Scenery choices">
        {FEATURES.map(({ value, label }) => <label key={value} className="scenery-feature">
          <input type="checkbox" checked={scenery.features.includes(value)} onChange={() => scenery.toggleFeature(value)} />
          <span>{label}</span>
        </label>)}
      </div>
      <label className="scenery-density" htmlFor="scenery-density">How much scenery?
        <select id="scenery-density" value={scenery.density} onChange={(event) => scenery.setDensity(event.target.value as typeof scenery.density)}>
          <option value="quiet">Quiet · more open space</option>
          <option value="balanced">Balanced</option>
          <option value="busy">Busy · a lively place</option>
        </select>
      </label>
      <div className={`scenery-area${scenery.marking ? ' scenery-area-marking' : ''}`}>
        <div className="scenery-area-heading"><CircleDashed size={16} /><strong>{scenery.area ? 'Changing this area' : 'Choose a place'}</strong></div>
        <p>{scenery.marking ? 'Click the ground to place a circle, or drag to draw a bigger area. Drag elsewhere after marking to move the view.'
          : scenery.area ? 'The outlined circle shows where your next change will go. The rest of your surroundings stay in place.'
            : 'Build the whole setting, or mark a patch of ground for a local change.'}</p>
        <div className="scenery-area-buttons">
          <button type="button" className="button secondary" aria-pressed={scenery.marking}
            onClick={scenery.marking ? scenery.stopMarking : scenery.startMarking}>
            <CircleDashed size={14} /> {scenery.marking ? 'Done marking' : scenery.area ? 'Mark another area' : 'Mark an area'}
          </button>
          {scenery.area && <button type="button" className="button secondary" onClick={scenery.clearArea}>Clear area</button>}
        </div>
        <div className="scenery-area-sizes" role="group" aria-label="Area size">
          {(['small', 'medium', 'large'] as const).map((size) => <button type="button" key={size}
            aria-pressed={scenery.areaSize === size} onClick={() => scenery.setAreaSize(size)}>{size[0].toUpperCase() + size.slice(1)}</button>)}
        </div>
      </div>
      <label className="scenery-prompt-label" htmlFor="scenery-prompt">{scenery.area ? 'What should go here?' : 'What would you like around your railway?'}</label>
      <textarea id="scenery-prompt" rows={3} value={scenery.prompt} maxLength={SCENERY_LIMITS.prompt}
        placeholder={scenery.area ? 'A park with trees and a playground…' : 'A city with shops, apartments, roads and cars…'}
        onChange={(event) => scenery.setPrompt(event.target.value)} />
      <div className="scenery-examples" aria-label="Scenery prompt examples">
        {EXAMPLES[scenery.theme].map((example) => <button key={example.label} type="button" onClick={() => scenery.setPrompt(example.prompt)}>{example.label}</button>)}
      </div>
      <p className="scenery-guidance">Try these words in English or Chinese: city / 城市, countryside / 乡村, buildings / 建筑, roads / 道路, cars / 汽车, people / 行人, trees / 树, park / 公园, river / 河流. Choose buttons or use your device’s dictation.</p>
    </fieldset>
    <div className={`scenery-status${scenery.hasPreview ? ' scenery-status-preview' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {scenery.hasPreview && <strong>Preview · not saved yet</strong>}
      {scenery.previewMessage && <p>{scenery.previewMessage}</p>}
      {busy && <p>Finish placing pieces or connecting your trains before changing the surroundings.</p>}
      {scenery.hasPreview && <p>Rotate and zoom to explore. Keep accepts the whole change; Cancel returns to your saved scene.</p>}
    </div>
    {(scenery.existing || scenery.hasPreview) && <div className="scenery-saved-controls">
      <label className="scenery-traffic"><input type="checkbox" checked={scenery.trafficPlaying}
        disabled={locked || !scenery.hasCars} onChange={(event) => scenery.setTrafficPlaying(event.target.checked)} /> Moving road traffic</label>
      <p>Cars follow their roads. Pause them here without stopping your trains.</p>
      {!scenery.hasCars && <p>Add roads and cars to bring traffic into your scene.</p>}
      {scenery.existing && <button type="button" className="button secondary scenery-remove" disabled={locked} onClick={scenery.removeSurroundings}>Remove surroundings</button>}
    </div>}
    <details className="scenery-help"><summary>What can I ask for?</summary>
      <p>This guided generator uses the scenery words above and fits lightweight buildings, greenery, roads and people around your railway. Your tracks and trains stay in place.</p>
      <p>Mark an area for “here.” Roads stay clear of railway tracks. Draw-your-own road routes, tunnels and walking pedestrians can come later.</p>
      <p>Surroundings are saved with your layout. Undo restores the previous accepted scene.</p>
    </details>
  </section>;
}
