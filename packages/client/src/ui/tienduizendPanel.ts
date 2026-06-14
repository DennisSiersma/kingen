/**
 * src/ui/tienduizendPanel.ts
 * Bedieningspaneel voor de menselijke Tienduizend-speler. Toont de apart gelegde
 * stenen (goud) en de losse worp; je klikt scorende losse stenen aan en kiest
 * 'Gooi door' (rest opnieuw) of 'Bank' (pot vastzetten). De geselecteerde score
 * en de pot/drempel-status worden live getoond. Resolvt met de gekozen zet.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';
import { scoreDice } from '@shared/games/tienduizend/scoring.ts';

export type TienduizendMoveJSON =
  | { type: 'roll' }
  | { type: 'setAside'; keep: number[]; bank: boolean };

export interface TienduizendPanelExtras {
  phase?: string;
  loose?: number[];
  setAside?: number[];
  turnPot?: number;
  total?: number;
  entered?: boolean;
  threshold?: number;
  target?: number;
}

const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function sameMulti(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export interface TienduizendPanel {
  toon(): void;
  verberg(): void;
  vraag(legal: TienduizendMoveJSON[], extras: TienduizendPanelExtras): Promise<TienduizendMoveJSON>;
}

export function createTienduizendPanel(root: HTMLElement): TienduizendPanel {
  const wrap = el('div', 'kg-tienduizend');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:9px', 'align-items:center',
    'padding:12px 16px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.86)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3', 'font-family:system-ui,sans-serif',
    'max-width:min(94vw,600px)',
  ].join(';');
  root.appendChild(wrap);

  const status = el('div');
  status.style.cssText = 'font-size:13px;font-weight:700;text-align:center;';
  const hint = el('div');
  hint.style.cssText = 'font-size:12px;text-align:center;opacity:0.85;min-height:15px;';
  const stenenRij = el('div');
  stenenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center;min-height:36px;';
  const knoppenRij = el('div');
  knoppenRij.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  wrap.append(status, hint, stenenRij, knoppenRij);

  let resolver: ((m: TienduizendMoveJSON) => void) | null = null;

  const klaar = (m: TienduizendMoveJSON): void => {
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

  const steenCel = (v: number, klikbaar: boolean): HTMLElement => {
    const c = el('div', undefined, FACE[v] ?? String(v));
    c.style.cssText = `width:32px;height:32px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:22px;background:${klikbaar ? '#f3efe2' : '#e7c66a'};color:#10140f;border:3px solid transparent;${klikbaar ? 'cursor:pointer;' : ''}`;
    return c;
  };

  return {
    toon(): void { wrap.style.display = 'flex'; },
    verberg(): void { resolver = null; wrap.style.display = 'none'; },
    vraag(legal, extras): Promise<TienduizendMoveJSON> {
      wrap.style.display = 'flex';
      return new Promise<TienduizendMoveJSON>((resolve) => {
        resolver = resolve;
        stenenRij.replaceChildren();
        knoppenRij.replaceChildren();
        const loose = extras.loose ?? [];
        const setAside = extras.setAside ?? [];
        const pot = extras.turnPot ?? 0;
        const total = extras.total ?? 0;
        const entered = extras.entered ?? false;
        const threshold = extras.threshold ?? 350;

        // Rollen-fase: alleen de gooi-knop.
        if (legal.some((m) => m.type === 'roll')) {
          status.textContent = t('tienduizend.status', { pot: String(pot), total: String(total) });
          hint.textContent = t('tienduizend.yourTurn');
          const b = maakKnop(t('tienduizend.roll'), '#e7c66a');
          b.addEventListener('click', () => klaar({ type: 'roll' }));
          knoppenRij.appendChild(b);
          return;
        }

        // Apart gelegde stenen (goud, niet klikbaar).
        for (const v of setAside) stenenRij.appendChild(steenCel(v, false));
        if (setAside.length > 0 && loose.length > 0) {
          const sep = el('div', undefined, '·');
          sep.style.cssText = 'opacity:0.5;font-size:20px;';
          stenenRij.appendChild(sep);
        }

        // Losse stenen: aanklikken om te selecteren voor het apart leggen.
        const geselecteerd = new Set<number>();
        const cellen: HTMLElement[] = [];
        loose.forEach((v, i) => {
          const c = steenCel(v, true);
          c.addEventListener('click', () => {
            if (geselecteerd.has(i)) geselecteerd.delete(i);
            else geselecteerd.add(i);
            const sel = geselecteerd.has(i);
            c.style.borderColor = sel ? '#2e8b57' : 'transparent';
            c.style.boxShadow = sel ? '0 0 8px rgba(46,139,87,0.8)' : 'none';
            werkBij();
          });
          cellen.push(c);
          stenenRij.appendChild(c);
        });

        const doorKnop = maakKnop(t('tienduizend.rollAgain'), '#bfe3a3');
        const bankKnop = maakKnop(t('tienduizend.bank'), '#e7c66a');
        knoppenRij.append(doorKnop, bankKnop);

        const huidigeKeep = (): number[] => [...geselecteerd].map((i) => loose[i]!);

        function werkBij(): void {
          const keep = huidigeKeep();
          const selScore = keep.length > 0 ? scoreDice(keep) : null;
          const geldig = selScore !== null;
          status.textContent = t('tienduizend.status', { pot: String(pot), total: String(total) });

          const doorMove = geldig ? legal.find((m) => m.type === 'setAside' && !m.bank && sameMulti(m.keep, keep)) : undefined;
          const bankMove = geldig ? legal.find((m) => m.type === 'setAside' && m.bank && sameMulti(m.keep, keep)) : undefined;

          doorKnop.disabled = !doorMove;
          bankKnop.disabled = !bankMove;
          for (const b of [doorKnop, bankKnop]) b.style.opacity = b.disabled ? '0.4' : '1';

          if (!geldig) {
            hint.textContent = t('tienduizend.selectScoring');
          } else if (!entered && pot + selScore! < threshold) {
            hint.textContent = t('tienduizend.notIn', { score: String(selScore), need: String(threshold) });
          } else {
            hint.textContent = t('tienduizend.selScore', { score: String(selScore), potNa: String(pot + selScore!) });
          }
        }

        doorKnop.addEventListener('click', () => {
          const keep = huidigeKeep();
          const m = legal.find((x) => x.type === 'setAside' && !x.bank && sameMulti(x.keep, keep));
          if (m) klaar(m);
        });
        bankKnop.addEventListener('click', () => {
          const keep = huidigeKeep();
          const m = legal.find((x) => x.type === 'setAside' && x.bank && sameMulti(x.keep, keep));
          if (m) klaar(m);
        });

        werkBij();
      });
    },
  };
}
