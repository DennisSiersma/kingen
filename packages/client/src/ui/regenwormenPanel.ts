/**
 * src/ui/regenwormenPanel.ts
 * Bedieningspaneel voor de menselijke Regenwormen-speler. Toont de midden-tegels
 * (met wormen), de apart gelegde + losse stenen, en — afhankelijk van de fase —
 * knoppen om een ogenwaarde apart te leggen, door te gooien of een tegel te
 * pakken/stelen. Resolvt met de gekozen zet.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';

export type RegenwormenMoveJSON =
  | { type: 'roll' }
  | { type: 'reserve'; value: number }
  | { type: 'take'; tile: number; from: 'center' | number };

export interface RegenwormenPanelExtras {
  phase?: string;
  reserved?: number[];
  loose?: number[];
  usedValues?: number[];
  sum?: number;
  remaining?: number;
  hasWorm?: boolean;
  center?: number[];
  tops?: (number | null)[];
  takeable?: { tile: number; from: 'center' | number }[];
}

const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '🐛']; // oog 6 = worm

function wormsOfTile(tile: number): number {
  return Math.floor((tile - 21) / 4) + 1;
}
function faceLabel(v: number): string {
  return FACE[v] ?? String(v);
}

export interface RegenwormenPanel {
  toon(): void;
  verberg(): void;
  vraag(legal: RegenwormenMoveJSON[], extras: RegenwormenPanelExtras): Promise<RegenwormenMoveJSON>;
}

export function createRegenwormenPanel(root: HTMLElement): RegenwormenPanel {
  const wrap = el('div', 'kg-regenwormen');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:12px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:8px', 'align-items:center',
    'padding:12px 16px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.88)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3', 'font-family:system-ui,sans-serif',
    'max-width:min(95vw,640px)',
  ].join(';');
  root.appendChild(wrap);

  const status = el('div');
  status.style.cssText = 'font-size:13px;font-weight:700;text-align:center;';
  const hint = el('div');
  hint.style.cssText = 'font-size:12px;text-align:center;opacity:0.85;min-height:15px;';
  const middenRij = el('div');
  middenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;justify-content:center;max-width:100%;';
  const stenenRij = el('div');
  stenenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-items:center;min-height:34px;';
  const knoppenRij = el('div');
  knoppenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';
  wrap.append(status, hint, middenRij, stenenRij, knoppenRij);

  let resolver: ((m: RegenwormenMoveJSON) => void) | null = null;
  const klaar = (m: RegenwormenMoveJSON): void => {
    const r = resolver;
    resolver = null;
    if (r) r(m);
  };

  const maakKnop = (label: string, kleur: string): HTMLButtonElement => {
    const b = el('button', undefined, label) as HTMLButtonElement;
    b.style.cssText = [
      'cursor:pointer', 'border:none', 'border-radius:9px', 'padding:8px 13px',
      'font-size:13px', 'font-weight:700', 'color:#10140f', `background:${kleur}`,
    ].join(';');
    return b;
  };

  /** Eén tegel-chip (waarde + wormen); `pakActie` maakt hem klikbaar. */
  const tegelChip = (tile: number, gloed: boolean, pakActie?: () => void): HTMLElement => {
    const c = el('div');
    c.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'min-width:30px', 'padding:3px 5px', 'border-radius:7px', 'background:#caa46a', 'color:#241a07',
      'border:2px solid ' + (gloed ? '#ffffff' : 'transparent'),
      gloed ? 'box-shadow:0 0 8px rgba(255,255,255,0.8);cursor:pointer' : '',
    ].join(';');
    const num = el('div', undefined, String(tile));
    num.style.cssText = 'font-size:13px;font-weight:800;line-height:1;';
    const worms = el('div', undefined, '🐛'.repeat(wormsOfTile(tile)));
    worms.style.cssText = 'font-size:9px;line-height:1;';
    c.append(num, worms);
    if (pakActie) c.addEventListener('click', pakActie);
    return c;
  };

  const steenCel = (v: number, reserved: boolean): HTMLElement => {
    const c = el('div', undefined, faceLabel(v));
    c.style.cssText = `width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:${v === 6 ? '18' : '20'}px;background:${reserved ? '#e7c66a' : '#f3efe2'};color:#10140f;`;
    return c;
  };

  return {
    toon(): void { wrap.style.display = 'flex'; },
    verberg(): void { resolver = null; wrap.style.display = 'none'; },
    vraag(legal, extras): Promise<RegenwormenMoveJSON> {
      wrap.style.display = 'flex';
      return new Promise<RegenwormenMoveJSON>((resolve) => {
        resolver = resolve;
        middenRij.replaceChildren();
        stenenRij.replaceChildren();
        knoppenRij.replaceChildren();

        const reserved = extras.reserved ?? [];
        const loose = extras.loose ?? [];
        const center = extras.center ?? [];
        const sum = extras.sum ?? 0;
        const heeftWorm = extras.hasWorm ?? false;

        // Takeable-set (tile|from) uit de legale zetten.
        const takeMoves = legal.filter((m): m is Extract<RegenwormenMoveJSON, { type: 'take' }> => m.type === 'take');
        const centerTakeable = new Map<number, RegenwormenMoveJSON>();
        const steals: Extract<RegenwormenMoveJSON, { type: 'take' }>[] = [];
        for (const m of takeMoves) {
          if (m.from === 'center') centerTakeable.set(m.tile, m);
          else steals.push(m);
        }

        // Midden-tegels (klikbaar als takeable).
        for (const tile of center) {
          const m = centerTakeable.get(tile);
          middenRij.appendChild(tegelChip(tile, !!m, m ? () => klaar(m) : undefined));
        }
        // Steel-opties als losse chips.
        if (steals.length > 0) {
          const label = el('span', undefined, t('regenwormen.steal') + ' ');
          label.style.cssText = 'font-size:11px;opacity:0.8;align-self:center;';
          middenRij.appendChild(label);
          for (const m of steals) middenRij.appendChild(tegelChip(m.tile, true, () => klaar(m)));
        }

        // Apart gelegde stenen (goud) + losse stenen.
        for (const v of reserved) stenenRij.appendChild(steenCel(v, true));
        if (reserved.length > 0 && loose.length > 0) {
          const sep = el('div', undefined, '·');
          sep.style.cssText = 'opacity:0.5;font-size:18px;';
          stenenRij.appendChild(sep);
        }
        for (const v of loose) stenenRij.appendChild(steenCel(v, false));

        status.textContent = t('regenwormen.status', { sum: String(sum), worm: heeftWorm ? '🐛' : '—' });

        // Rollen-fase.
        if (legal.some((m) => m.type === 'roll') && legal.every((m) => m.type === 'roll')) {
          hint.textContent = t('regenwormen.yourTurn');
          const b = maakKnop(t('regenwormen.roll'), '#e7c66a');
          b.addEventListener('click', () => klaar({ type: 'roll' }));
          knoppenRij.appendChild(b);
          return;
        }

        // Deciding-fase: een ogenwaarde apart leggen.
        const reserves = legal.filter((m): m is Extract<RegenwormenMoveJSON, { type: 'reserve' }> => m.type === 'reserve');
        if (reserves.length > 0) {
          hint.textContent = t('regenwormen.pickValue');
          for (const m of reserves) {
            const n = loose.filter((d) => d === m.value).length;
            const b = maakKnop(`${faceLabel(m.value)} ×${n}`, m.value === 6 ? '#bfe3a3' : '#e7c66a');
            b.addEventListener('click', () => klaar(m));
            knoppenRij.appendChild(b);
          }
          return;
        }

        // Choosing-fase: doorgooien en/of een tegel pakken (chips hierboven).
        const rollMove = legal.find((m) => m.type === 'roll');
        if (rollMove) {
          const b = maakKnop(t('regenwormen.rollAgain'), '#bfe3a3');
          b.addEventListener('click', () => klaar(rollMove));
          knoppenRij.appendChild(b);
        }
        if (takeMoves.length > 0) hint.textContent = t('regenwormen.canTake');
        else if (!heeftWorm) hint.textContent = t('regenwormen.needWorm');
        else if (sum < 21) hint.textContent = t('regenwormen.tooLow');
        else hint.textContent = t('regenwormen.rollOn');
      });
    },
  };
}
