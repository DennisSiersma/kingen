/**
 * src/ui/mexenPanel.ts
 * DOM-actiepaneel voor de menselijke Mexen-speler. Toont, afhankelijk van de
 * aangeboden legale zetten, de juiste knoppen: gooien, een waarde aankondigen
 * (met de eigen verborgen worp erbij), of reageren (geloven / twijfelen /
 * ongezien doorschuiven). Resolvt met de gekozen zet; de online-laag stuurt die
 * ONGEWIJZIGD terug zodat de server hem op waarde matcht.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';
import { codeLabel } from '@shared/games/mexen/ranking.ts';

/** Mexen-zetvormen zoals de server ze in legalMoves aanlevert (geserialiseerd). */
export type MexenMoveJSON =
  | { type: 'roll' }
  | { type: 'announce'; value: number }
  | { type: 'believe' }
  | { type: 'doubt' }
  | { type: 'passUnseen'; value: number };

/** Unicode-dobbelstenen voor de eigen-worp-weergave. */
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export interface MexenPanel {
  /** Vraag een zet; resolvt met één van `legal`. `myRoll` = eigen verborgen worp (of null). */
  vraag(legal: MexenMoveJSON[], myRoll: [number, number] | null): Promise<MexenMoveJSON>;
  verberg(): void;
}

export function createMexenPanel(root: HTMLElement): MexenPanel {
  const wrap = el('div', 'kg-mexen-paneel');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:18px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:10px', 'align-items:center',
    'padding:14px 18px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.82)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3',
    'font-family:system-ui,sans-serif', 'max-width:min(92vw,720px)',
  ].join(';');
  root.appendChild(wrap);

  const titel = el('div');
  titel.style.cssText = 'font-size:15px;font-weight:600;text-align:center;letter-spacing:0.2px;';
  const knoppenRij = el('div');
  knoppenRij.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';
  wrap.append(titel, knoppenRij);

  let actief: ((move: MexenMoveJSON) => void) | null = null;

  const maakKnop = (label: string, kleur: string): HTMLButtonElement => {
    const b = el('button', undefined, label) as HTMLButtonElement;
    b.style.cssText = [
      'cursor:pointer', 'border:none', 'border-radius:10px', 'padding:9px 14px',
      'font-size:14px', 'font-weight:600', 'color:#10140f', `background:${kleur}`,
      'transition:transform 0.08s ease',
    ].join(';');
    b.addEventListener('pointerdown', () => (b.style.transform = 'scale(0.95)'));
    b.addEventListener('pointerup', () => (b.style.transform = 'scale(1)'));
    return b;
  };

  const leeg = (): void => {
    knoppenRij.replaceChildren();
  };

  const kies = (move: MexenMoveJSON): void => {
    const cb = actief;
    actief = null;
    wrap.style.display = 'none';
    cb?.(move);
  };

  return {
    vraag(legal, myRoll): Promise<MexenMoveJSON> {
      return new Promise<MexenMoveJSON>((resolve) => {
        actief = resolve;
        leeg();
        wrap.style.display = 'flex';

        const rolls = legal.filter((m) => m.type === 'roll');
        const announces = legal.filter(
          (m): m is Extract<MexenMoveJSON, { type: 'announce' }> => m.type === 'announce',
        );
        const passes = legal.filter(
          (m): m is Extract<MexenMoveJSON, { type: 'passUnseen' }> => m.type === 'passUnseen',
        );
        const believe = legal.find((m) => m.type === 'believe');
        const doubt = legal.find((m) => m.type === 'doubt');

        if (rolls.length > 0) {
          titel.textContent = t('mexen.yourCup');
          const b = maakKnop(t('mexen.roll'), '#e7c66a');
          b.addEventListener('click', () => kies({ type: 'roll' }));
          knoppenRij.appendChild(b);
          return;
        }

        if (announces.length > 0) {
          const worp = myRoll
            ? t('mexen.youRolled', { dice: `${DICE_FACES[myRoll[0]] ?? ''}${DICE_FACES[myRoll[1]] ?? ''}` })
            : '';
          titel.textContent = t('mexen.announceTitle') + worp;
          // Oplopend, zodat de laagste (eerlijke) keuze links staat.
          for (const m of [...announces].sort((a, b) => a.value - b.value)) {
            const knop = maakKnop(codeLabel(m.value), '#bfe3a3');
            knop.addEventListener('click', () => kies(m));
            knoppenRij.appendChild(knop);
          }
          return;
        }

        // Reageren op de aankondiging van de vorige speler.
        titel.textContent = t('mexen.doubtTitle');
        if (believe) {
          const b = maakKnop(t('mexen.believe'), '#bfe3a3');
          b.addEventListener('click', () => kies(believe));
          knoppenRij.appendChild(b);
        }
        if (doubt) {
          const b = maakKnop(t('mexen.doubt'), '#e7a3a3');
          b.addEventListener('click', () => kies(doubt));
          knoppenRij.appendChild(b);
        }
        if (passes.length > 0) {
          const laagste = [...passes].sort((a, b) => a.value - b.value)[0]!;
          const b = maakKnop(t('mexen.passUnseen', { value: codeLabel(laagste.value) }), '#cdbfe3');
          b.addEventListener('click', () => kies(laagste));
          knoppenRij.appendChild(b);
        }
      });
    },
    verberg(): void {
      actief = null;
      wrap.style.display = 'none';
    },
  };
}
