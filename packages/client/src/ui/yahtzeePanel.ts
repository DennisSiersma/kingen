/**
 * src/ui/yahtzeePanel.ts
 * Bedieningspaneel + scorekaart voor de menselijke Yahtzee-speler. Toont de vijf
 * stenen (klik om vast te houden), een gooi-/herworp-knop en de eigen scorekaart
 * met 13 categorieën in twee kolommen. Open vakken die nu te scoren zijn tonen
 * een voorbeeldscore en zijn klikbaar; resolvt met de gekozen zet.
 * Eigen, procedureel ontwerp — geen gekopieerd bordmateriaal.
 */

import { el } from './uiBus.ts';
import { t } from './i18n.ts';
import type { TranslationKey } from './i18n.ts';
import { isYahtzee, scoreCategory, upperSubtotal } from '@shared/games/yahtzee/scoring.ts';
import { LOWER_CATEGORIES, UPPER_CATEGORIES, UPPER_BONUS_THRESHOLD } from '@shared/games/yahtzee/types.ts';
import type { YahtzeeCategory } from '@shared/games/yahtzee/types.ts';

export type YahtzeeMoveJSON =
  | { type: 'roll' }
  | { type: 'reroll'; keep: number[] }
  | { type: 'score'; category: YahtzeeCategory };

interface CardView {
  scores: Record<string, number | null>;
  yahtzeeBonus: number;
  upper: number;
  bonus: boolean;
  total: number;
}
export interface YahtzeePanelExtras {
  phase?: string;
  dice?: number[];
  rollsUsed?: number;
  maxRolls?: number;
  cards?: CardView[];
}

const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const CAT_KEY: Record<YahtzeeCategory, TranslationKey> = {
  ones: 'yahtzee.cat.ones', twos: 'yahtzee.cat.twos', threes: 'yahtzee.cat.threes',
  fours: 'yahtzee.cat.fours', fives: 'yahtzee.cat.fives', sixes: 'yahtzee.cat.sixes',
  threeKind: 'yahtzee.cat.threeKind', fourKind: 'yahtzee.cat.fourKind', fullHouse: 'yahtzee.cat.fullHouse',
  smallStraight: 'yahtzee.cat.smallStraight', largeStraight: 'yahtzee.cat.largeStraight',
  yahtzee: 'yahtzee.cat.yahtzee', chance: 'yahtzee.cat.chance',
};

export interface YahtzeePanel {
  toon(): void;
  verberg(): void;
  /** Werk de scorekaart bij uit de eigen view-extra's (zonder een zet te vragen). */
  update(extras: YahtzeePanelExtras, mySeat: number): void;
  vraag(legal: YahtzeeMoveJSON[], extras: YahtzeePanelExtras, mySeat: number): Promise<YahtzeeMoveJSON>;
}

export function createYahtzeePanel(root: HTMLElement): YahtzeePanel {
  const wrap = el('div', 'kg-yahtzee');
  wrap.style.cssText = [
    'position:absolute', 'left:50%', 'bottom:12px', 'transform:translateX(-50%)',
    'display:none', 'flex-direction:column', 'gap:8px', 'align-items:stretch',
    'padding:12px 14px', 'border-radius:14px', 'pointer-events:auto', 'z-index:30',
    'background:rgba(20,24,28,0.88)', 'backdrop-filter:blur(6px)',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'color:#f4efe3',
    'font-family:system-ui,sans-serif', 'max-width:min(94vw,520px)',
  ].join(';');
  root.appendChild(wrap);

  const hint = el('div');
  hint.style.cssText = 'font-size:13px;font-weight:600;text-align:center;min-height:16px;';

  const stenenRij = el('div');
  stenenRij.style.cssText = 'display:flex;gap:6px;justify-content:center;min-height:36px;';

  const knoppenRij = el('div');
  knoppenRij.style.cssText = 'display:flex;gap:8px;justify-content:center;';

  const kaart = el('div');
  kaart.style.cssText = 'display:flex;gap:10px;justify-content:center;';
  const kolomLinks = el('div');
  const kolomRechts = el('div');
  for (const k of [kolomLinks, kolomRechts]) k.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;';
  kaart.append(kolomLinks, kolomRechts);

  const voet = el('div');
  voet.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;font-weight:600;padding:2px 2px 0;';
  const voetUpper = el('span');
  const voetTotal = el('span');
  voet.append(voetUpper, voetTotal);

  wrap.append(hint, stenenRij, knoppenRij, kaart, voet);

  // --- scorekaart-rijen (label + waardevak) per categorie ---
  const rijen = new Map<YahtzeeCategory, { row: HTMLElement; box: HTMLElement }>();
  const maakRij = (cat: YahtzeeCategory): HTMLElement => {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:2px 6px;border-radius:6px;font-size:12px;background:rgba(255,255,255,0.05);';
    const label = el('span', undefined, t(CAT_KEY[cat]));
    label.style.cssText = 'white-space:nowrap;';
    const box = el('span', undefined, '');
    box.style.cssText = 'min-width:26px;text-align:center;font-weight:700;border-radius:5px;padding:1px 4px;border:2px solid transparent;';
    box.addEventListener('click', () => {
      const m = huidigLegaalScore.get(cat);
      if (m) kies(m);
    });
    rijen.set(cat, { row, box });
    row.append(label, box);
    return row;
  };
  for (const cat of UPPER_CATEGORIES) kolomLinks.appendChild(maakRij(cat as YahtzeeCategory));
  for (const cat of LOWER_CATEGORIES) kolomRechts.appendChild(maakRij(cat as YahtzeeCategory));

  // --- stenen ---
  const stenen: HTMLElement[] = [];
  const vastgehouden = new Set<number>(); // indices in de huidige worp
  for (let i = 0; i < 5; i++) {
    const c = el('div', undefined, '');
    c.style.cssText = 'width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#f3efe2;color:#10140f;border:3px solid transparent;cursor:pointer;';
    const idx = i;
    c.addEventListener('click', () => {
      if (!stenenActief) return;
      if (vastgehouden.has(idx)) vastgehouden.delete(idx);
      else vastgehouden.add(idx);
      tekenStenen();
    });
    stenen.push(c);
    stenenRij.appendChild(c);
  }

  const knop = el('button') as HTMLButtonElement;
  knop.style.cssText = 'cursor:pointer;border:none;border-radius:9px;padding:8px 16px;font-size:13px;font-weight:700;color:#10140f;background:#e7c66a;';
  knoppenRij.appendChild(knop);

  let resolver: ((m: YahtzeeMoveJSON) => void) | null = null;
  let huidigLegaalScore = new Map<YahtzeeCategory, YahtzeeMoveJSON>();
  let huidigeDice: number[] = [];
  let stenenActief = false;
  let kanHerwerpen = false;

  const kies = (m: YahtzeeMoveJSON): void => {
    const r = resolver;
    resolver = null;
    huidigLegaalScore = new Map();
    stenenActief = false;
    tekenScoreHighlights();
    if (r) r(m);
  };

  function tekenStenen(): void {
    huidigeDice.forEach((v, i) => {
      const c = stenen[i]!;
      c.textContent = FACE[v] ?? String(v);
      c.style.display = 'flex';
      const held = vastgehouden.has(i);
      c.style.background = held ? '#e7c66a' : '#f3efe2';
      c.style.borderColor = held ? '#2e8b57' : 'transparent';
      c.style.boxShadow = held ? '0 0 8px rgba(46,139,87,0.8)' : 'none';
      c.style.cursor = stenenActief ? 'pointer' : 'default';
    });
    for (let i = huidigeDice.length; i < stenen.length; i++) stenen[i]!.style.display = 'none';
  }

  function tekenScoreHighlights(): void {
    for (const [cat, { box }] of rijen) {
      const legaal = huidigLegaalScore.has(cat);
      box.style.borderColor = legaal ? '#ffffff' : 'transparent';
      box.style.cursor = legaal ? 'pointer' : 'default';
      box.style.boxShadow = legaal ? '0 0 8px rgba(255,255,255,0.7)' : 'none';
    }
  }

  /** Vul de scorekaart-vakken: ingevuld = score (dof), open+scoorbaar = voorbeeld. */
  function vulKaart(card: CardView | undefined, dice: number[], scorable: Set<YahtzeeCategory>): void {
    const joker = dice.length === 5 && isYahtzee(dice) && card?.scores.yahtzee != null;
    for (const [cat, { row, box }] of rijen) {
      const ingevuld = card?.scores[cat];
      if (ingevuld != null) {
        box.textContent = String(ingevuld);
        box.style.background = 'rgba(255,255,255,0.10)';
        box.style.color = '#cfc8b6';
        row.style.opacity = '0.7';
      } else if (scorable.has(cat)) {
        box.textContent = String(scoreCategory(dice, cat, joker));
        box.style.background = 'rgba(231,198,106,0.22)';
        box.style.color = '#f4efe3';
        row.style.opacity = '1';
      } else {
        box.textContent = '·';
        box.style.background = 'transparent';
        box.style.color = 'rgba(244,239,227,0.45)';
        row.style.opacity = '1';
      }
    }
    if (card) {
      voetUpper.textContent = t('yahtzee.upper', { sum: String(card.upper), need: String(UPPER_BONUS_THRESHOLD) }) + (card.bonus ? ' ✓+35' : '');
      voetTotal.textContent = t('yahtzee.total', { total: String(card.total) });
    } else {
      voetUpper.textContent = '';
      voetTotal.textContent = '';
    }
  }

  function update(extras: YahtzeePanelExtras, mySeat: number): void {
    const card = extras.cards?.[mySeat];
    vulKaart(card, [], new Set());
  }

  return {
    toon(): void { wrap.style.display = 'flex'; },
    verberg(): void { resolver = null; wrap.style.display = 'none'; },
    update,
    vraag(legal, extras, mySeat): Promise<YahtzeeMoveJSON> {
      wrap.style.display = 'flex';
      return new Promise<YahtzeeMoveJSON>((resolve) => {
        resolver = resolve;
        const card = extras.cards?.[mySeat];
        huidigeDice = extras.dice ?? [];
        vastgehouden.clear();

        // Rollen-fase: alleen de gooi-knop.
        if (legal.some((m) => m.type === 'roll')) {
          stenenActief = false;
          huidigLegaalScore = new Map();
          vulKaart(card, [], new Set());
          tekenStenen();
          tekenScoreHighlights();
          hint.textContent = t('yahtzee.yourTurn');
          knop.style.display = 'inline-block';
          knop.textContent = t('yahtzee.roll');
          knop.onclick = () => kies({ type: 'roll' });
          return;
        }

        // Beslissen-fase: stenen vasthouden, herworp en/of scoren.
        stenenActief = true;
        const scoreMoves = legal.filter((m): m is Extract<YahtzeeMoveJSON, { type: 'score' }> => m.type === 'score');
        huidigLegaalScore = new Map(scoreMoves.map((m) => [m.category, m]));
        const scorable = new Set(scoreMoves.map((m) => m.category));
        vulKaart(card, huidigeDice, scorable);
        tekenStenen();
        tekenScoreHighlights();

        kanHerwerpen = legal.some((m) => m.type === 'reroll');
        const rest = extras.rollsUsed !== undefined && extras.maxRolls !== undefined ? ` (${extras.rollsUsed}/${extras.maxRolls})` : '';
        hint.textContent = t('yahtzee.hint');
        if (kanHerwerpen) {
          knop.style.display = 'inline-block';
          knop.textContent = t('yahtzee.reroll') + rest;
          knop.onclick = () => {
            if (vastgehouden.size >= huidigeDice.length) {
              hint.textContent = t('yahtzee.unholdFirst');
              return;
            }
            const keep = [...vastgehouden].map((i) => huidigeDice[i]!);
            kies({ type: 'reroll', keep });
          };
        } else {
          knop.style.display = 'none';
        }
      });
    },
  };
}
