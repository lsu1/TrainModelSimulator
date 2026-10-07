import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, Check, ChevronRight, CircleHelp, FolderOpen, Leaf, Lightbulb, Maximize2, Minus, Mountain, Pause, Play, Plus, RotateCcw, Route, Sparkles, TrainFront, Trash2, Undo2, Volume2, X } from 'lucide-react';
import { TRACK_CATALOG, advanceTrain, attachTrack, closedRouteLength, connectedEndpoint, endpoints, makeStarterLayout, pointAt, sampleBehind, trackPath } from './track';
import type { Track, TrackKind, TrainPosition, Vec } from './track';
import { STORAGE_KEY, loadLayout, parseLayout } from './layout';
import type { LayoutData } from './layout';

type Anchor = { position: Vec; angle: number; trackId?: string; end?: 0 | 1 };
type Modal = 'layouts' | 'help' | null;
const initialTrain = (tracks: Track[]): TrainPosition => ({ trackId: tracks[0]?.id ?? '', distance: 35, direction: 1, laps: 0 });
const catalogEntry = (track: Track) => TRACK_CATALOG.find(c => c.kind === track.kind)!;

function PieceIllustration({ curved = false, bend = 1 }: { curved?: boolean; bend?: 1 | -1 }) {
  const d = curved ? (bend === 1 ? 'M17 13 Q17 45 63 45' : 'M17 45 Q17 13 63 13') : 'M13 29 H68';
  return <svg className="piece-illustration" viewBox="0 0 82 58" aria-hidden="true">
    <path d={d} fill="none" stroke="#cbd0c3" strokeWidth="15" strokeLinecap="butt" />
    <path d={d} fill="none" stroke="#70806c" strokeWidth="11" strokeDasharray="3 5" />
    <path d={d} fill="none" stroke="#eef0e6" strokeWidth="8" />
    <path d={d} fill="none" stroke="#7d8976" strokeWidth="4" />
  </svg>;
}

function Tree({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <ellipse cx="5" cy="17" rx="20" ry="9" fill="#ced9c5" opacity=".6" />
    <rect x="-3" y="-5" width="6" height="25" rx="2" fill="#a89574" />
    <path d="M0-47 22-13H13L27 5H-27L-13-13H-22Z" fill="#688b69" />
    <path d="M0-47 0 5H-27L-13-13H-22Z" fill="#82a27a" />
  </g>;
}

function Scenery() {
  return <g aria-hidden="true" pointerEvents="none">
    <path d="M-244 65C-300 20-321 71-297 111S-234 182-179 168-112 102-142 71-204 98-244 65Z" fill="#c4dbd9" />
    <path d="M-250 78C-290 52-304 83-286 114S-232 162-189 154" fill="none" stroke="#dce9e3" strokeWidth="5" strokeLinecap="round" />
    <path d="M-400-90C-260-34-66-28 8-24S170-35 315-112" fill="none" stroke="#dfd8c2" strokeWidth="17" strokeLinecap="round" />
    <path d="M43-190C75-100 95 20 215 92" fill="none" stroke="#dfd8c2" strokeWidth="13" strokeLinecap="round" />
    {[[-373, 17, 1], [-335, -36, .8], [-102, 144, 1], [-69, 168, .8], [314, 90, 1.1], [343, 138, .9], [368, 70, .75], [249, -136, .9], [292, -171, 1.1], [-209, -143, .7]].map(([x, y, size], i) => <Tree key={i} x={x} y={y} size={size} />)}
    <g transform="translate(50 -54)">
      <rect x="-7" y="8" width="108" height="65" rx="7" fill="#d1d9c7" />
      <rect width="88" height="61" rx="3" fill="#efe8d5" />
      <path d="M-9 4 44-31 97 4Z" fill="#b56c53" />
      <path d="M-9 4 44-31 44 4Z" fill="#c98567" />
      <rect x="12" y="19" width="17" height="17" rx="2" fill="#94b7b7" />
      <rect x="59" y="19" width="17" height="17" rx="2" fill="#94b7b7" />
      <rect x="35" y="26" width="18" height="35" rx="2" fill="#a68d6d" />
      <rect x="-8" y="55" width="104" height="7" rx="2" fill="#cfc2a3" />
    </g>
    <g transform="translate(189 -52) scale(.8)">
      <rect x="-5" y="8" width="85" height="62" rx="4" fill="#d1d9c7" />
      <rect width="71" height="57" fill="#f1e9cf" />
      <path d="M-7 3 35-29 78 3Z" fill="#879789" />
      <rect x="13" y="17" width="14" height="17" fill="#a3c2be" />
      <rect x="44" y="17" width="14" height="17" fill="#a3c2be" />
      <rect x="30" y="32" width="13" height="25" fill="#b09b7b" />
    </g>
    <g transform="translate(-18 69)">
      <rect width="40" height="28" rx="5" fill="#9cb590" /><rect x="3" y="-20" width="34" height="38" rx="10" fill="#aec6a1" />
      <circle cx="11" cy="4" r="3" fill="#dbb56f" /><circle cx="29" cy="-6" r="3" fill="#dbb56f" />
    </g>
    <text x="55" y="123" textAnchor="middle" fontSize="13" letterSpacing="3" fill="#87957b" fontWeight="600">SUNNY VALLEY</text>
    <g fill="#b7c8a7">{[[-146,-97], [-112,-75], [279,175], [-315,168], [185,147], [320,-65]].map(([x,y],i) => <g key={i} transform={`translate(${x} ${y})`}><path d="M-5 0-2-9 0 0 4-8 6 0" stroke="#b7c8a7" strokeWidth="2" fill="none" /></g>)}</g>
  </g>;
}

function TrackGraphic({ track, selected, onSelect }: { track: Track; selected: boolean; onSelect: () => void }) {
  const d = trackPath(track);
  const length = catalogEntry(track).length;
  const ties = [];
  for (let distance = 7; distance < length; distance += 13) {
    const p = pointAt(track, distance);
    ties.push(<line key={distance} x1="0" y1="-13" x2="0" y2="13" stroke="#737c6c" strokeWidth="3.5" transform={`translate(${p.x} ${p.y}) rotate(${p.angle * 180 / Math.PI})`} />);
  }
  return <g>
    {selected && <path d={d} fill="none" stroke="#e9af65" strokeWidth="38" opacity=".65" />}
    <path d={d} fill="none" stroke="#bac0b0" strokeWidth="28" />
    {ties}
    <path d={d} fill="none" stroke="#e6e9de" strokeWidth="13" />
    <path d={d} fill="none" stroke="#7c8874" strokeWidth="7" />
    <path d={d} fill="none" stroke="#dde1d4" strokeWidth="1.5" opacity=".8" />
    <path d={d} fill="none" stroke="transparent" strokeWidth="38" className="track-hit" tabIndex={0} role="button" aria-label={`Select ${catalogEntry(track).name} track`} onClick={e => { e.stopPropagation(); onSelect(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }} />
  </g>;
}

function TrainGraphic({ tracks, position, cabForward }: { tracks: Track[]; position: TrainPosition; cabForward: boolean }) {
  const physicalPosition: TrainPosition = { ...position, direction: cabForward ? position.direction : position.direction === 1 ? -1 : 1 };
  return <g pointerEvents="none" data-testid="train" aria-label="Your train">
    {[133, 68, 0].map((distance, index) => {
      const p = sampleBehind(tracks, physicalPosition, distance);
      if (!p) return null;
      const engine = index === 2;
      return <g key={index} transform={`translate(${p.x} ${p.y}) rotate(${p.angle * 180 / Math.PI})`}>
        <rect x="-54" y="-10" width="53" height="25" rx="6" fill="#596453" opacity=".22" transform="translate(2 4)" />
        <rect x="-51" y="-15" width="14" height="30" rx="3" fill="#43524c" /><rect x="-21" y="-15" width="14" height="30" rx="3" fill="#43524c" />
        <rect x="-57" y="-13" width="56" height="26" rx={engine ? 8 : 5} fill={engine ? '#cf6546' : '#f4eee0'} stroke={engine ? '#a14e3c' : '#bdc5b5'} strokeWidth="2" />
        <path d="M-51-8H-11M-51 8H-11" stroke={engine ? '#f0a07d' : '#648570'} strokeWidth="3" />
        {engine ? <><rect x="-21" y="-9" width="12" height="18" rx="3" fill="#c8e0d8" /><rect x="-46" y="-6" width="17" height="12" rx="2" fill="#b6583e" /><path d="M-35-4v8M-31-4v8" stroke="#914b39" strokeWidth="2" /><circle cx="-4" cy="-7" r="2" fill="#f8e6a9" /><circle cx="-4" cy="7" r="2" fill="#f8e6a9" /></> : <>{[-45,-33,-21].map(x => <rect key={x} x={x} y="-7" width="8" height="14" rx="2" fill="#aac8c0" />)}</>}
      </g>;
    })}
  </g>;
}

export default function App() {
  const [layout, setLayout] = useState<LayoutData>(loadLayout);
  const { tracks, name } = layout;
  const [history, setHistory] = useState<LayoutData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [tab, setTab] = useState<'straight' | 'curved'>('straight');
  const [bend, setBend] = useState<1 | -1>(1);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(55);
  const [position, setPosition] = useState<TrainPosition>(() => initialTrain(layout.tracks));
  const positionRef = useRef(position);
  const lapProgressRef = useRef(0);
  const [cabForward, setCabForward] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(true);
  const [zoom, setZoom] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const selectedTrack = tracks.find(t => t.id === selectedId);
  const routeLength = useMemo(() => closedRouteLength(tracks, position), [tracks, position.trackId, position.direction]);

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  };

  const resetTrain = (newTracks: Track[]) => {
    const next = initialTrain(newTracks);
    if (newTracks[0]) next.distance = Math.min(35, catalogEntry(newTracks[0]).length);
    positionRef.current = next;
    setPosition(next);
    setRunning(false);
    lapProgressRef.current = 0;
    setCabForward(true);
  };

  const changeLayout = (next: LayoutData) => {
    setHistory(h => [...h.slice(-49), layout]);
    setLayout(next);
    resetTrain(next.tracks);
    setSelectedId(null);
    setAnchor(null);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setLayout(previous);
    resetTrain(previous.tracks);
    setSelectedId(null);
    setAnchor(null);
    notify('Back one step. Keep building!');
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); setSaved(true); }
    catch { setSaved(false); }
  }, [layout]);

  const openEnds = useMemo(() => tracks.flatMap(track => endpoints(track).flatMap((endpoint, i) =>
    connectedEndpoint(tracks, track.id, i as 0 | 1) ? [] : [{ ...endpoint, trackId: track.id, end: i as 0 | 1 }]
  )), [tracks]);
  const activeAnchor = anchor ?? openEnds.at(-1) ?? (tracks.length === 0 ? { position: { x: -300, y: 0 }, angle: 0 } : null);
  const closed = tracks.length > 0 && openEnds.length === 0;

  const addPiece = (kind: TrackKind) => {
    if (!activeAnchor) { notify('This loop is complete! Select and remove a piece to change it, or choose a new layout.'); return; }
    if (tracks.length >= 200) { notify('Your railway has reached 200 pieces. Remove a piece to make room.'); return; }
    const next = attachTrack(kind, bend, activeAnchor, crypto.randomUUID());
    const duplicate = tracks.some(t => t.kind === next.kind && Math.hypot(t.x - next.x, t.y - next.y) < 1 && Math.abs(Math.sin(t.angle - next.angle)) < .001 && t.bend === next.bend);
    if (duplicate) { notify('There is already a track piece here. Try another end.'); return; }
    const nextTracks = [...tracks, next];
    changeLayout({ ...layout, tracks: nextTracks });
    const end = endpoints(next)[1];
    setAnchor(connectedEndpoint(nextTracks, next.id, 1) ? null : { ...end, trackId: next.id, end: 1 });
    notify(`Added ${TRACK_CATALOG.find(t => t.kind === kind)!.name.toLowerCase()}.`);
  };

  const removeSelected = () => {
    if (!selectedTrack) return;
    const nextTracks = tracks.filter(t => t.id !== selectedTrack.id);
    changeLayout({ ...layout, tracks: nextTracks });
    notify('Piece removed. Click a green + to choose where to build.');
  };

  const toggleRunning = () => {
    if (!tracks.length) { notify('Add your first track piece before running a train.'); return; }
    setRunning(r => !r);
  };

  const reverse = () => {
    const next: TrainPosition = { ...positionRef.current, direction: positionRef.current.direction === 1 ? -1 : 1 };
    positionRef.current = next;
    setPosition(next);
    setCabForward(forward => !forward);
    lapProgressRef.current = 0;
    notify('Your train is now travelling the other way.');
  };

  const horn = async () => {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      await context.resume();
      const now = context.currentTime;
      [392, 523.25].forEach(frequency => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.06, now + .03); gain.gain.setValueAtTime(.06, now + .35); gain.gain.linearRampToValueAtTime(0, now + .65);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + .7);
      });
      notify('Toot toot! 🚂');
    } catch { notify('Sound is unavailable in this browser. Your train can still run.'); }
  };

  useEffect(() => {
    if (!running || !tracks.length) return;
    let frame: number;
    let lastTime = 0;
    let accumulated = 0;
    const tick = (time: number) => {
      if (!lastTime) lastTime = time;
      accumulated += Math.min(time - lastTime, 100);
      lastTime = time;
      if (accumulated >= 30) {
        const distance = accumulated / 1000 * speed / 3.6 * 1000 / 160;
        const previous = positionRef.current;
        const result = advanceTrain(tracks, previous, distance);
        const circumference = routeLength;
        let fullLaps = 0;
        if (circumference !== null) {
          lapProgressRef.current += distance;
          fullLaps = Math.floor(lapProgressRef.current / circumference);
          lapProgressRef.current %= circumference;
        }
        result.position.laps = previous.laps + fullLaps;
        accumulated = 0;
        positionRef.current = result.position;
        setPosition(result.position);
        if (result.stopped) { setRunning(false); notify('End of the line! Reverse your train or add more track.'); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, speed, tracks, routeLength]);

  const actionsRef = useRef({ toggleRunning, undo, reverse, removeSelected });
  actionsRef.current = { toggleRunning, undo, reverse, removeSelected };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modal || (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable))) return;
      if (event.code === 'Space') {
        if (event.target instanceof Element && event.target.closest('button, [role="button"]')) return;
        event.preventDefault(); actionsRef.current.toggleRunning();
      }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); actionsRef.current.undo(); }
      else if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) actionsRef.current.reverse();
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); actionsRef.current.removeSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); void audioRef.current?.close(); }, []);

  const bounds = useMemo(() => {
    const points = tracks.flatMap(track => Array.from({ length: 17 }, (_, i) => pointAt(track, catalogEntry(track).length * i / 16)));
    if (!points.length) return { x: -680, y: -410, width: 1360, height: 820 };
    const left = Math.min(...points.map(p => p.x)) - 125;
    const top = Math.min(...points.map(p => p.y)) - 120;
    return { x: left, y: top, width: Math.max(650, Math.max(...points.map(p => p.x)) + 125 - left), height: Math.max(480, Math.max(...points.map(p => p.y)) + 120 - top) };
  }, [tracks]);
  const viewWidth = bounds.width / zoom;
  const viewHeight = bounds.height / zoom;
  const viewBox = `${bounds.x + (bounds.width - viewWidth) / 2} ${bounds.y + (bounds.height - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
  const totalLength = tracks.reduce((sum, track) => sum + catalogEntry(track).length, 0);

  const exportLayout = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'my-railway'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Your railway is saved as a file. Open it here any time.');
  };

  const importLayout = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 200000) throw new Error('This file is too large. Choose a Little Railways layout.');
      const next = parseLayout(JSON.parse(await file.text()));
      changeLayout(next); setModal(null); setZoom(1); notify(`Welcome back to ${next.name}!`);
    } catch (error) { notify(error instanceof Error ? error.message : 'We could not open that layout.'); }
    if (fileInput.current) fileInput.current.value = '';
  };

  const chooseLayout = (kind: 'oval' | 'compact' | 'empty') => {
    changeLayout({ version: 1, name: kind === 'oval' ? 'Sunny Valley' : kind === 'compact' ? 'Pocket Railway' : 'My Railway', tracks: kind === 'empty' ? [] : makeStarterLayout(kind) });
    setZoom(1); setModal(null); notify(kind === 'empty' ? 'A fresh start! Choose a straight or a curve to begin.' : 'Your railway is ready. Let’s take it for a ride!');
  };

  useEffect(() => {
    if (!modal) return;
    setRunning(false);
    const oldFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const getControls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])') ?? []);
    getControls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      if (event.key === 'Tab') {
        const controls = getControls(); const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); oldFocus?.focus(); };
  }, [modal]);

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><TrainFront size={27} strokeWidth={1.8} /></div><div><div className="brand-name">little railways</div><div className="brand-caption">BIG ADVENTURES. SMALL TRAINS.</div></div></div>
      <div className="header-actions"><span className="saved-label">{saved ? <Check size={14} /> : <ArrowDownToLine size={14} />}{saved ? 'Saved on this computer' : 'Download to save'}</span><button className="icon-button" aria-label="How to play" onClick={() => setModal('help')}><CircleHelp size={21} /></button></div>
    </header>

    <section className="hero"><div><div className="eyebrow"><span /> THE LITTLE RAILWAY CLUB</div><h1>Where will your railway go?</h1><p className="subtitle">A few tracks. A little imagination. A whole world to explore.</p></div><div className="hero-badge"><Leaf size={18} /><span>A playground for<br /><strong>Kato N Scale explorers</strong></span></div></section>

    <main className="workspace">
      <div className="workspace-main">
        <section className="railway-card" aria-label="Railway playground">
          <div className="board-header"><div className="board-title"><span>YOUR RAILWAY</span><h2>{name}<span className="status-dot" /></h2></div><div className="board-tools"><button className="icon-button" aria-label="Undo last change" disabled={!history.length} onClick={undo}><Undo2 size={19} /></button><button className="button secondary" onClick={() => setModal('layouts')}><FolderOpen size={17} />Layouts<ChevronRight size={15} /></button></div></div>
          <div className="board-wrap">
            <div className="board-chip"><span className={`status-dot ${running ? 'running' : ''}`} />{running ? 'On an adventure' : closed ? 'Loop complete · ready to ride' : tracks.length ? 'Let’s connect the tracks' : 'A world of possibilities'}</div>
            <svg className="railway-svg" viewBox={viewBox} aria-label="Interactive railway layout" onClick={() => setSelectedId(null)}>
              <defs><pattern id="board-grid" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.1" fill="#b8c5a9" opacity=".4" /></pattern></defs>
              <rect x={bounds.x - 10000} y={bounds.y - 10000} width="20000" height="20000" fill="url(#board-grid)" />
              {tracks.length > 0 && <Scenery />}
              {tracks.map(track => <TrackGraphic key={track.id} track={track} selected={track.id === selectedId} onSelect={() => { setSelectedId(track.id); setRunning(false); }} />)}
              {tracks.length > 0 && <TrainGraphic tracks={tracks} position={position} cabForward={cabForward} />}
              {openEnds.map((end, i) => <g key={`${end.trackId}-${end.end}`} transform={`translate(${end.position.x} ${end.position.y})`} role="button" tabIndex={0} aria-label={`Build from open end ${i + 1}`} className="endpoint-button" onClick={event => { event.stopPropagation(); setAnchor(end); setSelectedId(null); notify('Build from this end. Now choose a track piece.'); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setAnchor(end); setSelectedId(null); } }}><circle r="24" fill={activeAnchor?.trackId === end.trackId && activeAnchor?.end === end.end ? '#2d5745' : '#fafbf5'} stroke="#2d5745" strokeWidth="3" /><path d="M-8 0H8M0-8V8" stroke={activeAnchor?.trackId === end.trackId && activeAnchor?.end === end.end ? '#fff' : '#2d5745'} strokeWidth="3" strokeLinecap="round" /></g>)}
            </svg>
            {!tracks.length && <div className="board-empty"><Route size={44} strokeWidth={1.5} /><h3>Every adventure starts<br />with one track.</h3><p>Choose a piece from the track box to get going.</p></div>}
            <div className="board-help"><span><Mountain size={15} /> A little world, made by you</span></div>
            <div className="zoom-tools"><button aria-label="Zoom out" disabled={zoom <= .7} onClick={() => setZoom(z => Math.max(.7, z - .2))}><Minus size={16} /></button><button aria-label="Fit railway to view" onClick={() => setZoom(1)}><Maximize2 size={15} /></button><button aria-label="Zoom in" disabled={zoom >= 1.7} onClick={() => setZoom(z => Math.min(1.7, z + .2))}><Plus size={16} /></button></div>
          </div>
          <div className="train-controls">
            <button className={`play-button ${running ? 'playing' : ''}`} aria-label={running ? 'Pause train' : 'Run train'} disabled={!tracks.length} onClick={toggleRunning}>{running ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button>
            <div className="speed-control"><div className="speed-heading"><label htmlFor="train-speed">{running ? 'Off we go!' : 'Ready, conductor?'}</label><span>{speed} <small>km/h</small></span></div><input id="train-speed" aria-label="Train speed" type="range" min="5" max="100" step="5" value={speed} onChange={event => setSpeed(Number(event.target.value))} /><div className="speed-labels"><span>Easy does it</span><span>Full steam ahead</span></div></div>
            <div className="control-divider" /><button className="icon-button direction-button" aria-label="Reverse train direction" disabled={!tracks.length} onClick={reverse}><ArrowLeftRight size={21} /><span>Reverse</span></button><button className="icon-button direction-button" aria-label="Sound train horn" onClick={() => void horn()}><Volume2 size={21} /><span>Toot toot</span></button><div className="control-divider" /><div className="lap-stat"><span>{position.laps.toString().padStart(2, '0')}</span><small>{position.laps === 1 ? 'lap' : 'laps'} explored</small></div>
          </div>
        </section>

        <div className="below-board"><div className="tip-card"><span><Route size={19} /></span><div><strong>Build something brilliant</strong><p>Click a piece to select it. Connect at the green +.</p></div></div><div className="tip-card"><span><TrainFront size={19} /></span><div><strong>Take it for a spin</strong><p>Press play and let the adventure begin.</p></div></div><div className="tip-card"><span><Sparkles size={19} /></span><div><strong>Make it your own</strong><p>Try a smaller loop or start from scratch.</p></div></div></div>
      </div>

      <aside className="builder-panel" aria-label="Track builder">
        <div className="panel-eyebrow">LET’S BUILD</div><h2>Your track box <span>+</span></h2><p className="panel-intro">Little pieces. Endless possibilities.</p>
        <div className="piece-tabs" role="group" aria-label="Track categories"><button className={tab === 'straight' ? 'active' : ''} aria-pressed={tab === 'straight'} onClick={() => setTab('straight')}>Straight tracks</button><button className={tab === 'curved' ? 'active' : ''} aria-pressed={tab === 'curved'} onClick={() => setTab('curved')}>Curved tracks</button></div>
        <div className="piece-grid">{TRACK_CATALOG.filter(piece => tab === 'straight' ? !piece.radius : !!piece.radius).map(piece => <button key={piece.kind} className="piece-button" aria-label={`Add ${piece.name}`} onClick={() => addPiece(piece.kind)}><PieceIllustration curved={!!piece.radius} bend={bend} /><span className="piece-label">{piece.radius ? `R${piece.radius}` : `${piece.length} mm`}</span><span className="piece-detail">{piece.radius ? '45° curve' : piece.kind === 's248' ? 'Long straight' : piece.kind === 's124' ? 'Half straight' : 'Short straight'}</span><span className="piece-add"><Plus size={12} /></span></button>)}</div>
        {tab === 'curved' && <div className="bend-control" role="group" aria-label="Curve direction"><button aria-pressed={bend === -1} className={bend === -1 ? 'active' : ''} onClick={() => setBend(-1)}><RotateCcw size={15} />Bend left</button><button aria-pressed={bend === 1} className={bend === 1 ? 'active' : ''} onClick={() => setBend(1)}><RotateCcw size={15} style={{ transform: 'scaleX(-1)' }} />Bend right</button></div>}
        {selectedTrack ? <div className="selection-card"><div><span>SELECTED PIECE</span><strong>{catalogEntry(selectedTrack).name}</strong></div><div className="selection-actions"><button className="button secondary" onClick={removeSelected}><Trash2 size={15} />Remove</button></div></div> : <div className="hint-box"><Lightbulb size={20} /><p>{closed ? 'Want to change this loop? Click a track piece and remove it. Or choose a fresh layout!' : tracks.length ? 'Click a green +, then choose a piece. Keep joining the ends to make a loop!' : 'Pick any track piece above. Your first piece starts a brand-new railway!'}</p></div>}
        <div className="inventory"><div className="inventory-heading"><h3>On your railway</h3><span>{tracks.length} pieces</span></div>{TRACK_CATALOG.filter(piece => tracks.some(t => t.kind === piece.kind)).map(piece => <div className="inventory-row" key={piece.kind}><span>{piece.radius ? `R${piece.radius} curve` : `${piece.length} mm straight`}</span><span>× {tracks.filter(t => t.kind === piece.kind).length}</span></div>)}{!tracks.length && <p className="inventory-empty">Your track box is waiting.</p>}<div className="inventory-total"><span>Total track length</span><strong>{(totalLength / 1000).toFixed(2)} m</strong></div></div>
        <div className="sidebar-footer"><button className="export-button" onClick={exportLayout}><ArrowDownToLine size={16} />Save a layout file</button><p>Keep a copy of your little adventure.</p></div>
      </aside>
    </main>

    <footer className="footer"><span><TrainFront size={14} />Made for curious minds & little conductors.</span><div className="keyboard-shortcuts"><kbd>space</kbd> play / pause<span>·</span><kbd>R</kbd> reverse<span>·</span><kbd>⌘ Z</kbd> undo</div></footer>
    <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} aria-label="Open railway file" onChange={event => void importLayout(event.target.files?.[0])} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}

    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event => event.stopPropagation()}>
      <div className="modal-header"><div><div className="panel-eyebrow">{modal === 'layouts' ? 'THE NEXT ADVENTURE' : 'WELCOME, CONDUCTOR'}</div><h2 id="modal-title">{modal === 'layouts' ? 'Where shall we go?' : 'Your railway. Your imagination.'}</h2></div><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={21} /></button></div>
      {modal === 'layouts' ? <><p className="modal-intro">Pick a starting point. You can always undo to return to your railway.</p><div className="layout-options">
        {([{ kind: 'oval', title: 'Sunny Valley', detail: 'A roomy oval. Ready for a first ride.', curves: true }, { kind: 'compact', title: 'Pocket Railway', detail: 'A little loop with lots of possibilities.', curves: true }, { kind: 'empty', title: 'A fresh adventure', detail: 'An empty world. Make it yours.', curves: false }] as const).map(option => <button key={option.kind} className="layout-option" onClick={() => chooseLayout(option.kind)}><svg viewBox="0 0 100 65" aria-hidden="true">{option.curves ? <><rect x={option.kind === 'oval' ? 10 : 24} y="12" width={option.kind === 'oval' ? 80 : 52} height="42" rx="21" fill="#eaf0e2" stroke="#789076" strokeWidth="5" /><circle cx="50" cy="33" r="8" fill="#aec3a0" /></> : <><path d="M30 32H70M50 12V52" stroke="#8ba281" strokeWidth="3" strokeLinecap="round" /><circle cx="50" cy="32" r="27" fill="none" stroke="#c7d4bb" strokeDasharray="3 5" /></>}</svg><span><strong>{option.title}</strong><small>{option.detail}</small></span><ChevronRight size={18} /></button>)}
      </div><div className="modal-footer"><button className="button secondary" onClick={() => fileInput.current?.click()}><FolderOpen size={16} />Open a layout file</button><span>Your current layout can be restored with Undo.</span></div></> : <><div className="help-list"><div className="help-row"><span>1</span><div><h3>Build your little world</h3><p>Choose a ready-made layout, or start fresh. Click a green + to choose an open end, then click a straight or a curve from your track box.</p></div></div><div className="help-row"><span>2</span><div><h3>Make a connection</h3><p>The new piece snaps to your chosen end. Matching ends join automatically. Try left and right curves to find your way back!</p></div></div><div className="help-row"><span>3</span><div><h3>All aboard!</h3><p>Press play, change the speed, and try the horn. Your train stops safely at an open end. Reverse it to head back.</p></div></div><div className="help-row"><span>4</span><div><h3>Experiment. Then try again.</h3><p>Click a track piece to remove it. Undo brings back your last change. Your layout saves in this browser; download a file to keep a spare copy.</p></div></div></div><div className="help-note"><Leaf size={18} /><p>This first playground uses nominal N Scale track geometry. Check official Kato dimensions, train radius limits, and clearances before building or buying a physical layout. Turnouts and crossings will need a future version.</p></div><div className="modal-actions"><button className="button primary" onClick={() => setModal(null)}><Play size={16} />Let’s play</button></div></>}
    </section></div>}
  </div>;
}
