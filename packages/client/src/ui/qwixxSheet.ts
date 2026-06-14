/**
 * src/ui/qwixxSheet.ts
 * Eigen, procedureel Qwixx-scorebord (DOM-overlay) voor de menselijke speler:
 * vier kleurrijen (rood/geel oplopend, groen/blauw aflopend), slotvakjes en
 * strafvakken. Toont de eigen kruisjes, licht legale cellen op en resolvt met de
 * gekozen zet. Origineel ontwerp — geen gekopieerd bordmateriaal.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';
import { QWIXX_COLORS, lockNumber, rowNumbers } from '@shared/games/qwixx/types.ts';
import type { QwixxColor } from '@shared/games/qwixx/types.ts';

export type QwixxMoveJSON =
  | { type: 'roll' }
  | { type: 'markWhite'; color: QwixxColor; value: number }
  | { type: 'markColor'; color: QwixxColor; value: number }
  | { type: 'pass' };

interface SheetView {
  rows: Record<QwixxColor, { marks: number[]; locked: boolean }>;
  penalties: number;
}
export interface QwixxSheetExtras {
  phase?: string;
  whiteSum?: number;
  lockedColors?: QwixxColor[];
  sheets?: SheetView[];
}

const CELL_BG: Record<QwixxColor, string> = {
  red: '#c0392b', yellow: '#d4ac0d', green: '#27ae60', blue: '#2e6fb0',
};
const TEXT_ON: Record<QwixxColor, string> = {
  red: '#fff', yellow: '#2a2118', green: '#fff', blue: '#fff',
};

export interface QwixxSheet {
  toon(): void;
  verberg(): void;
  /** Werk de kruisjes/strafvakken bij uit de eigen view-extra's. */
  update(extras: QwixxSheetExtras, mySeat: number): void;
  /** Vraag een zet; resolvt met één van `legal`. */
  vraag(legal: QwixxMoveJSON[], extras: QwixxSheetExtras, mySeat: number): Promise<QwixxMoveJSON>;
}

export function createQwixxSheet(root: HTMLElement): QwixxSheet {
  const wrap = el('div', 'kg-qwixx');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:12px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:6px', 'align-items:stretch',
    'padding:12px 14px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.88)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3',
    'font-family:system-ui,sans-serif',
  ].join(';');
  root.appendChild(wrap);

  const hint = el('div');
  hint.style.cssText = 'font-size:13px;font-weight:600;text-align:center;min-height:16px;';
  wrap.appendChild(hint);

  const cellen = new Map<string, HTMLElement>();
  let huidigLegaal = new Map<string, QwixxMoveJSON>();
  let resolver: ((m: QwixxMoveJSON) => void) | null = null;

  const kies = (m: QwixxMoveJSON): void => {
    const r = resolver;
    resolver = null;
    huidigLegaal = new Map();
    tekenHighlights();
    if (r) r(m);
  };

  const maakCel = (color: QwixxColor, value: number, isLock: boolean): HTMLElement => {
    const c = el('div', undefined, isLock ? '🔒' : String(value));
    c.style.cssText = [
      'width:26px', 'height:26px', 'border-radius:6px', 'display:flex',
      'align-items:center', 'justify-content:center', 'font-size:12px', 'font-weight:700',
      `background:${CELL_BG[color]}`, `color:${TEXT_ON[color]}`, 'cursor:default',
      'user-select:none', 'border:2px solid transparent', 'position:relative',
    ].join(';');
    const key = isLock ? `${color}:lock` : `${color}:${value}`;
    c.addEventListener('click', () => {
      const m = huidigLegaal.get(key);
      if (m) kies(m);
    });
    cellen.set(key, c);
    return c;
  };

  // Bouw de vier rijen.
  for (const color of QWIXX_COLORS) {
    const rij = el('div');
    rij.style.cssText = 'display:flex;gap:4px;align-items:center;';
    for (const v of rowNumbers(color)) rij.appendChild(maakCel(color, v, false));
    rij.appendChild(maakCel(color, lockNumber(color), true));
    wrap.appendChild(rij);
  }

  // Strafvakken + pass/gooi-knop.
  const onder = el('div');
  onder.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:4px;';
  const strafWrap = el('div');
  strafWrap.style.cssText = 'display:flex;gap:4px;align-items:center;font-size:12px;';
  const strafLabel = el('span');
  strafWrap.appendChild(strafLabel);
  const strafVakken: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const b = el('div', undefined, '✗');
    b.style.cssText = 'width:20px;height:20px;border-radius:5px;border:2px solid #e7a3a3;display:flex;align-items:center;justify-content:center;color:transparent;font-weight:700;';
    strafVakken.push(b);
    strafWrap.appendChild(b);
  }
  const actieKnop = el('button') as HTMLButtonElement;
  actieKnop.style.cssText = 'cursor:pointer;border:none;border-radius:9px;padding:7px 14px;font-size:13px;font-weight:700;color:#10140f;background:#e7c66a;';
  onder.append(strafWrap, actieKnop);
  wrap.appendChild(onder);

  let rolModus = false;
  actieKnop.addEventListener('click', () => {
    if (rolModus) kies({ type: 'roll' });
    else kies({ type: 'pass' });
  });

  function tekenHighlights(): void {
    for (const [key, cel] of cellen) {
      const legaal = huidigLegaal.has(key);
      cel.style.borderColor = legaal ? '#ffffff' : 'transparent';
      cel.style.cursor = legaal ? 'pointer' : 'default';
      cel.style.boxShadow = legaal ? '0 0 8px rgba(255,255,255,0.7)' : 'none';
    }
  }

  function update(extras: QwixxSheetExtras, mySeat: number): void {
    const sheet = extras.sheets?.[mySeat];
    const locked = extras.lockedColors ?? [];
    for (const color of QWIXX_COLORS) {
      const row = sheet?.rows[color];
      const dicht = locked.includes(color);
      for (const v of rowNumbers(color)) {
        const cel = cellen.get(`${color}:${v}`)!;
        const gekruist = row?.marks.includes(v) ?? false;
        cel.style.opacity = dicht && !gekruist ? '0.35' : '1';
        cel.style.textDecoration = gekruist ? 'line-through' : 'none';
        cel.textContent = gekruist ? '✗' : String(v);
      }
      const lockCel = cellen.get(`${color}:lock`)!;
      lockCel.style.opacity = row?.locked ? '1' : dicht ? '0.35' : '0.7';
      lockCel.style.outline = row?.locked ? '2px solid #fff' : 'none';
    }
    strafLabel.textContent = t('qwixx.penalty');
    const pen = sheet?.penalties ?? 0;
    strafVakken.forEach((b, i) => (b.style.color = i < pen ? '#e7a3a3' : 'transparent'));
  }

  return {
    toon(): void {
      wrap.style.display = 'flex';
    },
    verberg(): void {
      wrap.style.display = 'none';
    },
    update,
    vraag(legal, extras, mySeat): Promise<QwixxMoveJSON> {
      update(extras, mySeat);
      wrap.style.display = 'flex';
      return new Promise<QwixxMoveJSON>((resolve) => {
        resolver = resolve;
        const heeftRoll = legal.some((m) => m.type === 'roll');
        rolModus = heeftRoll;
        huidigLegaal = new Map();
        if (!heeftRoll) {
          for (const m of legal) {
            if (m.type === 'markWhite' || m.type === 'markColor') huidigLegaal.set(`${m.color}:${m.value}`, m);
          }
        }
        tekenHighlights();
        if (heeftRoll) {
          actieKnop.textContent = t('qwixx.roll');
          hint.textContent = t('qwixx.yourTurn');
        } else {
          actieKnop.textContent = t('qwixx.pass');
          hint.textContent =
            (extras.phase === 'color' ? t('qwixx.colorHint') : t('qwixx.whiteHint', { sum: String(extras.whiteSum ?? 0) }));
        }
      });
    },
  };
}
