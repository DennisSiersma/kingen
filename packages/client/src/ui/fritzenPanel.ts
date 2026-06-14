/**
 * src/ui/fritzenPanel.ts
 * Bedieningspaneel voor de menselijke Fritzen-speler. Toont de vastgelegde en
 * losse stenen; je klikt losse stenen aan om ze vast te houden en kiest dan
 * 'Gooi opnieuw' (herwerp de rest) of 'Stop'. Resolvt met de gekozen zet.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';

export type FritzenMoveJSON =
  | { type: 'roll' }
  | { type: 'keep'; values: number[]; stop: boolean };

export interface FritzenPanelExtras {
  locked?: number[];
  loose?: number[];
  rollsUsed?: number;
  maxRolls?: number;
  total?: number;
}

const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function sameMulti(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export interface FritzenPanel {
  toon(): void;
  verberg(): void;
  vraag(legal: FritzenMoveJSON[], extras: FritzenPanelExtras): Promise<FritzenMoveJSON>;
}

export function createFritzenPanel(root: HTMLElement): FritzenPanel {
  const wrap = el('div', 'kg-fritzen');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:10px', 'align-items:center',
    'padding:12px 16px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.86)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3', 'font-family:system-ui,sans-serif',
    'max-width:min(92vw,560px)',
  ].join(';');
  root.appendChild(wrap);

  const hint = el('div');
  hint.style.cssText = 'font-size:13px;font-weight:600;text-align:center;';
  const stenenRij = el('div');
  stenenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;min-height:34px;';
  const knoppenRij = el('div');
  knoppenRij.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  wrap.append(hint, stenenRij, knoppenRij);

  let resolver: ((m: FritzenMoveJSON) => void) | null = null;

  const klaar = (m: FritzenMoveJSON): void => {
    const r = resolver;
    resolver = null;
    if (r) r(m);
  };

  const maakKnop = (label: string, kleur: string): HTMLButtonElement => {
    const b = el('button', undefined, label) as HTMLButtonElement;
    b.style.cssText = [
      'cursor:pointer', 'border:none', 'border-radius:9px', 'padding:8px 14px',
      'font-size:13px', 'font-weight:700', 'color:#10140f', `background:${kleur}`,
    ].join(';');
    return b;
  };

  return {
    toon(): void {
      wrap.style.display = 'flex';
    },
    verberg(): void {
      resolver = null;
      wrap.style.display = 'none';
    },
    vraag(legal, extras): Promise<FritzenMoveJSON> {
      wrap.style.display = 'flex';
      return new Promise<FritzenMoveJSON>((resolve) => {
        resolver = resolve;
        stenenRij.replaceChildren();
        knoppenRij.replaceChildren();
        const locked = extras.locked ?? [];
        const loose = extras.loose ?? [];

        if (legal.some((m) => m.type === 'roll')) {
          hint.textContent = t('fritzen.yourTurn');
          const b = maakKnop(t('fritzen.roll'), '#e7c66a');
          b.addEventListener('click', () => klaar({ type: 'roll' }));
          knoppenRij.appendChild(b);
          return;
        }

        const total = extras.total ?? 0;
        hint.textContent = t('fritzen.hint', { total: String(total) });

        // Vastgelegde stenen (niet klikbaar).
        for (const v of locked) {
          const c = el('div', undefined, FACE[v] ?? String(v));
          c.style.cssText = 'width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:20px;background:#e7c66a;color:#10140f;';
          stenenRij.appendChild(c);
        }
        // Losse stenen: aanklikken = vasthouden voor de herworp.
        const vastgehouden = new Set<number>(); // indices in loose
        const looseCellen: HTMLElement[] = [];
        loose.forEach((v, i) => {
          const c = el('div', undefined, FACE[v] ?? String(v));
          c.style.cssText = 'width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:20px;background:#f3efe2;color:#10140f;border:2px solid transparent;cursor:pointer;';
          c.addEventListener('click', () => {
            if (vastgehouden.has(i)) vastgehouden.delete(i);
            else vastgehouden.add(i);
            c.style.borderColor = vastgehouden.has(i) ? '#2e8b57' : 'transparent';
            c.style.boxShadow = vastgehouden.has(i) ? '0 0 8px rgba(46,139,87,0.8)' : 'none';
          });
          looseCellen.push(c);
          stenenRij.appendChild(c);
        });

        const heeftHerworp = legal.some((m) => m.type === 'keep' && !m.stop);
        if (heeftHerworp) {
          const rest = extras.rollsUsed !== undefined && extras.maxRolls !== undefined ? ` (${extras.rollsUsed}/${extras.maxRolls})` : '';
          const b = maakKnop(t('fritzen.reroll') + rest, '#bfe3a3');
          b.addEventListener('click', () => {
            const vals = [...vastgehouden].map((i) => loose[i]!);
            if (vals.length === 0) {
              hint.textContent = t('fritzen.holdFirst');
              return;
            }
            const move = legal.find((m) => m.type === 'keep' && !m.stop && sameMulti(m.values, vals));
            if (move) klaar(move);
          });
          knoppenRij.appendChild(b);
        }
        // Stop = alles vastleggen en de beurt beëindigen.
        const stopMove = legal.find((m) => m.type === 'keep' && m.stop && sameMulti(m.values, loose))
          ?? legal.find((m) => m.type === 'keep' && m.stop);
        const sb = maakKnop(t('fritzen.stop'), '#e7c66a');
        sb.addEventListener('click', () => {
          if (stopMove) klaar(stopMove);
        });
        knoppenRij.appendChild(sb);
      });
    },
  };
}
