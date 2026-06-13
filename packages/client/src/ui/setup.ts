/**
 * src/ui/setup.ts
 * Setup-scherm (DOM-overlay in #ui): aantal spelers (3-5), per stoel
 * mens/computer + naam + AI-niveau, variantkeuze (standaard/dubbel + alle
 * vlaggen uit KingenVariantConfig), omgevingskeuze en taalkeuze (NL/EN).
 * Alle teksten lopen via src/ui/i18n.ts.
 */

import '../styles.css';
import type { PlayerConfig } from '@shared/core/types.ts';
import type { KingenRoundKind, KingenVariantConfig, TrumpSelectionMode } from '@shared/games/kingen/types.ts';
import { DEFAULT_VARIANT, NEGATIVE_ROUND_KINDS } from '@shared/games/kingen/types.ts';
import type { EnvironmentId } from '../render/types.ts';
import { ENVIRONMENT_IDS } from '../render/types.ts';
import type { Lang } from './i18n.ts';
import {
  aiLevelName,
  environmentDescription,
  environmentName,
  getLang,
  onLangChange,
  roundKindExplanation,
  roundKindName,
  setLang,
  t,
  trumpModeName,
} from './i18n.ts';
import type { SetupConfig, SetupScreen } from './types.ts';
import { el, emitUiEvent } from './uiBus.ts';

// ---------------------------------------------------------------------------
// Vaste teksten en icoontjes
// ---------------------------------------------------------------------------

/**
 * Stoel 0 krijgt een taalafhankelijke naam ("Jij"/"You") in defaultPlayers().
 * Computerspelers krijgen een willekeurige naam uit deze pool (zie kiesAiNamen),
 * met uitsluiting van namen die een menselijke speler al gekozen heeft.
 */
const AI_NAME_POOL = [
  'Ada', 'Kaia', 'Chrystal', 'Casheen', 'Jameel', 'Rafique', 'Zain', 'Tillie',
  'Chris', 'Thom', 'Ali', 'Geeta', 'Myrna', 'Lola', 'Bastian',
] as const;

/**
 * Kies `aantal` unieke, willekeurige namen uit AI_NAME_POOL. Namen in `bezet`
 * (hoofdletterongevoelig) worden uitgesloten — zo botst een computernaam nooit
 * met de naam die een mens koos. Fisher-Yates-shuffle; valt netjes terug als de
 * pool ooit te klein zou zijn (komt bij max. 4 computerspelers niet voor).
 */
function kiesAiNamen(aantal: number, bezet: Iterable<string> = []): string[] {
  const verboden = new Set([...bezet].map((n) => n.trim().toLowerCase()));
  const kandidaten: string[] = AI_NAME_POOL.filter((n) => !verboden.has(n.toLowerCase()));
  for (let i = kandidaten.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = kandidaten[i]!;
    kandidaten[i] = kandidaten[j]!;
    kandidaten[j] = tmp;
  }
  const uit = kandidaten.slice(0, Math.max(0, aantal));
  let n = 1;
  while (uit.length < aantal) uit.push(`Speler ${n++}`);
  return uit;
}

/** Procedurele SVG-icoontjes (geen externe assets). */
const ENV_ICONS: Record<EnvironmentId, string> = {
  // Bierpul met schuimkraag
  cafe: `<svg viewBox="0 0 56 56" class="kg-omgeving__icoon" aria-hidden="true">
    <g fill="none" stroke="#c9a227" stroke-width="2" stroke-linejoin="round">
      <rect x="14" y="18" width="20" height="26" rx="3"/>
      <path d="M34 24h6a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-6"/>
      <path d="M14 18c-2-6 3-10 10-10s12 4 10 10" fill="rgba(232,199,90,0.18)"/>
      <line x1="20" y1="24" x2="20" y2="38" stroke-opacity="0.6"/>
      <line x1="28" y1="24" x2="28" y2="38" stroke-opacity="0.6"/>
    </g></svg>`,
  // Hanglamp boven een tafel
  keukentafel: `<svg viewBox="0 0 56 56" class="kg-omgeving__icoon" aria-hidden="true">
    <g fill="none" stroke="#c9a227" stroke-width="2" stroke-linejoin="round">
      <line x1="28" y1="4" x2="28" y2="14"/>
      <path d="M18 22a10 8 0 0 1 20 0z" fill="rgba(232,199,90,0.18)"/>
      <circle cx="28" cy="25" r="2" fill="#e8c75a" stroke="none"/>
      <line x1="8" y1="38" x2="48" y2="38"/>
      <line x1="13" y1="38" x2="11" y2="50"/>
      <line x1="43" y1="38" x2="45" y2="50"/>
    </g></svg>`,
  // Casinofiche met ruit
  casino: `<svg viewBox="0 0 56 56" class="kg-omgeving__icoon" aria-hidden="true">
    <g fill="none" stroke="#c9a227" stroke-width="2">
      <circle cx="28" cy="28" r="20"/>
      <circle cx="28" cy="28" r="13" stroke-opacity="0.6"/>
      <path d="M28 20l6 8-6 8-6-8z" fill="rgba(232,199,90,0.25)"/>
      <g stroke-width="3">
        <line x1="28" y1="8" x2="28" y2="13"/><line x1="28" y1="43" x2="28" y2="48"/>
        <line x1="8" y1="28" x2="13" y2="28"/><line x1="43" y1="28" x2="48" y2="28"/>
      </g>
    </g></svg>`,
};

const TRUMP_MODES: readonly TrumpSelectionMode[] = ['delerKiest', 'laatsteKaart', 'uitkomerKiest'];

const AI_LEVELS = ['makkelijk', 'gemiddeld', 'moeilijk'] as const;

// ---------------------------------------------------------------------------
// Setup-scherm
// ---------------------------------------------------------------------------

export function createSetupScreen(root: HTMLElement): SetupScreen {
  let overlay: HTMLDivElement | null = null;

  // Werkstate (gevuld in show()).
  let variant: KingenVariantConfig = structuredClone(DEFAULT_VARIANT);
  let omgeving: EnvironmentId = 'cafe';
  let spelerPool: PlayerConfig[] = [];
  let onStart: ((config: SetupConfig) => void) | null = null;

  // Live herrenderen bij taalwissel: het paneel volledig opnieuw opbouwen
  // vanuit de bestaande werkstate (variant/omgeving/spelers blijven behouden).
  onLangChange(() => {
    if (!overlay) return;
    const vers = build();
    overlay.replaceWith(vers);
    overlay = vers;
  });

  function defaultPlayers(): PlayerConfig[] {
    // Vier computerspelers (genoeg voor max. 5 stoelen) met willekeurige,
    // unieke namen uit de pool; stoel 0 ("Jij"/"You") staat daar los van.
    const aiNamen = kiesAiNamen(4);
    return [
      { name: t('setup.you'), kind: 'human' },
      ...aiNamen.map((name): PlayerConfig =>
        ({ name, kind: 'ai', aiDifficulty: 'gemiddeld' })),
    ];
  }

  // ------------------------------------------------------------------
  // Deelsecties
  // ------------------------------------------------------------------

  function renderStoelen(container: HTMLElement): void {
    container.innerHTML = '';
    for (let i = 0; i < variant.playerCount; i++) {
      const cfg = spelerPool[i];
      if (!cfg) continue;
      const rij = el('div', 'kg-stoel');

      rij.appendChild(el('span', 'kg-stoel__nr', String(i + 1)));

      const naamWrap = el('div', 'kg-stoel__naam kg-veld');
      const naam = el('input');
      naam.type = 'text';
      naam.maxLength = 16;
      naam.value = cfg.name;
      naam.placeholder = t('setup.playerPlaceholder', { n: i + 1 });
      naam.addEventListener('input', () => {
        cfg.name = naam.value;
      });
      naamWrap.appendChild(naam);
      rij.appendChild(naamWrap);

      // Mens/Computer-schakelaar (stoel 1 = altijd de lokale mens).
      const soort = el('div', 'kg-soort');
      const mensKnop = el('button', 'kg-soort__knop', t('setup.human'));
      mensKnop.type = 'button';
      const aiKnop = el('button', 'kg-soort__knop', t('setup.computer'));
      aiKnop.type = 'button';
      soort.append(mensKnop, aiKnop);
      rij.appendChild(soort);

      const niveau = el('select');
      niveau.title = t('setup.aiLevelTitle');
      for (const d of AI_LEVELS) {
        const opt = el('option', undefined, aiLevelName(d));
        opt.value = d;
        niveau.appendChild(opt);
      }
      niveau.value = cfg.aiDifficulty ?? 'gemiddeld';
      niveau.addEventListener('change', () => {
        cfg.aiDifficulty = niveau.value as PlayerConfig['aiDifficulty'];
      });
      rij.appendChild(niveau);

      const sync = (): void => {
        mensKnop.classList.toggle('is-actief', cfg.kind === 'human');
        aiKnop.classList.toggle('is-actief', cfg.kind === 'ai');
        niveau.style.visibility = cfg.kind === 'ai' ? 'visible' : 'hidden';
      };

      if (i === 0) {
        // De lokale gebruiker zit op stoel 0 en is altijd een mens.
        cfg.kind = 'human';
        delete cfg.aiDifficulty;
        mensKnop.disabled = true;
        aiKnop.disabled = true;
        aiKnop.title = t('setup.seat0Title');
      } else {
        // Hotseat (meerdere mensen aan één scherm) wordt nog niet ondersteund;
        // bied 'Mens' hier dus eerlijk niet aan in plaats van het stilzwijgend
        // door de computer te laten overnemen.
        cfg.kind = 'ai';
        cfg.aiDifficulty = cfg.aiDifficulty ?? 'gemiddeld';
        mensKnop.disabled = true;
        mensKnop.title = t('setup.hotseatTitle');
        aiKnop.disabled = true;
        aiKnop.title = t('setup.aiSeatTitle');
      }
      sync();
      container.appendChild(rij);
    }
  }

  function renderVolgorde(lijst: HTMLOListElement): void {
    lijst.innerHTML = '';
    lijst.classList.toggle('is-uit', variant.mode === 'dubbel');
    variant.roundOrder.forEach((kind, idx) => {
      const li = el('li');
      li.appendChild(el('span', 'kg-volgorde__nr', `${idx + 1}.`));
      const naam = el('span', 'kg-volgorde__naam', roundKindName(kind));
      naam.title = roundKindExplanation(kind);
      li.appendChild(naam);

      const omhoog = el('button', 'kg-btn kg-btn--stil kg-btn--mini', '▲');
      omhoog.type = 'button';
      omhoog.title = t('setup.moveEarlier');
      omhoog.disabled = idx === 0;
      omhoog.addEventListener('click', () => {
        const vorige = variant.roundOrder[idx - 1];
        if (vorige === undefined) return;
        variant.roundOrder[idx - 1] = kind;
        variant.roundOrder[idx] = vorige;
        renderVolgorde(lijst);
      });

      const omlaag = el('button', 'kg-btn kg-btn--stil kg-btn--mini', '▼');
      omlaag.type = 'button';
      omlaag.title = t('setup.moveLater');
      omlaag.disabled = idx === variant.roundOrder.length - 1;
      omlaag.addEventListener('click', () => {
        const volgende = variant.roundOrder[idx + 1];
        if (volgende === undefined) return;
        variant.roundOrder[idx + 1] = kind;
        variant.roundOrder[idx] = volgende;
        renderVolgorde(lijst);
      });

      li.append(omhoog, omlaag);
      lijst.appendChild(li);
    });
  }

  function checkboxRegel(
    label: string,
    hint: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): HTMLLabelElement {
    const wrap = el('label', 'kg-variant-regel');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => set(box.checked));
    const tekst = el('div', 'kg-variant-regel__tekst');
    tekst.appendChild(el('div', 'kg-variant-regel__label', label));
    tekst.appendChild(el('p', 'kg-hint', hint));
    wrap.append(box, tekst);
    return wrap;
  }

  function selectRij(
    label: string,
    hint: string,
  ): { rij: HTMLDivElement; select: HTMLSelectElement } {
    const rij = el('div', 'kg-variant-rij');
    const tekst = el('div', 'kg-variant-regel__tekst');
    tekst.appendChild(el('div', 'kg-variant-regel__label', label));
    tekst.appendChild(el('p', 'kg-hint', hint));
    const select = el('select');
    rij.append(tekst, select);
    return { rij, select };
  }

  // ------------------------------------------------------------------
  // Volledige opbouw
  // ------------------------------------------------------------------

  function build(): HTMLDivElement {
    const ov = el('div', 'kg-overlay');
    const panel = el('div', 'kg-panel kg-setup');
    ov.appendChild(panel);

    // Kop
    const kop = el('header', 'kg-setup__kop');

    // Taalschakelaar (NL/EN) rechtsboven; herrendert het hele scherm direct.
    const taal = el('div', 'kg-taalwissel');
    taal.setAttribute('role', 'group');
    taal.setAttribute('aria-label', t('setup.language'));
    for (const lang of ['nl', 'en'] as Lang[]) {
      const knop = el('button', 'kg-taalwissel__knop', lang.toUpperCase());
      knop.type = 'button';
      knop.classList.toggle('is-actief', getLang() === lang);
      knop.addEventListener('click', () => setLang(lang));
      taal.appendChild(knop);
    }
    kop.appendChild(taal);

    const titel = el('h1', 'kg-setup__titel');
    titel.innerHTML = '<span class="kg-suit-deco">♠</span>Kingen<span class="kg-suit-deco">♥</span>';
    kop.appendChild(titel);
    kop.appendChild(el('p', 'kg-setup__ondertitel', t('setup.subtitle')));

    // Duidelijke keuze: online spelen (naar de lobby) naast het lokale spel hieronder.
    const onlineKnop = el('button', 'kg-setup__online', t('setup.playOnline'));
    onlineKnop.type = 'button';
    onlineKnop.addEventListener('click', () => {
      location.search = '?online';
    });
    kop.appendChild(onlineKnop);
    panel.appendChild(kop);

    const body = el('div', 'kg-setup__body');
    panel.appendChild(body);

    // --- Linkerkolom: spelers + omgeving -------------------------------
    const links = el('div', 'kg-setup__kolom');
    body.appendChild(links);

    // Aantal spelers
    const sectieAantal = el('section', 'kg-setup__sectie');
    sectieAantal.appendChild(el('h2', 'kg-setup__sectiekop', t('setup.playerCount')));
    const aantal = el('div', 'kg-aantal');
    const aantalKnoppen = new Map<3 | 4 | 5, HTMLButtonElement>();
    const stoelen = el('div');
    for (const n of [3, 4, 5] as const) {
      const knop = el('button', 'kg-aantal__knop', t('setup.playersN', { n }));
      knop.type = 'button';
      knop.addEventListener('click', () => {
        variant.playerCount = n;
        for (const [m, k] of aantalKnoppen) k.classList.toggle('is-actief', m === n);
        renderStoelen(stoelen);
      });
      aantalKnoppen.set(n, knop);
      aantal.appendChild(knop);
    }
    sectieAantal.appendChild(aantal);
    sectieAantal.appendChild(el('p', 'kg-hint', t('setup.playerCountHint')));
    links.appendChild(sectieAantal);

    // Stoelen
    const sectieStoelen = el('section', 'kg-setup__sectie');
    sectieStoelen.appendChild(el('h2', 'kg-setup__sectiekop', t('setup.atTable')));
    sectieStoelen.appendChild(stoelen);
    links.appendChild(sectieStoelen);

    // Omgeving
    const sectieOmgeving = el('section', 'kg-setup__sectie');
    sectieOmgeving.appendChild(el('h2', 'kg-setup__sectiekop', t('setup.environment')));
    const omgevingen = el('div', 'kg-omgevingen');
    const omgevingKnoppen = new Map<EnvironmentId, HTMLButtonElement>();
    for (const id of ENVIRONMENT_IDS) {
      const kaart = el('button', 'kg-omgeving');
      kaart.type = 'button';
      kaart.innerHTML = ENV_ICONS[id];
      kaart.appendChild(el('div', 'kg-omgeving__naam', environmentName(id)));
      kaart.appendChild(el('div', 'kg-omgeving__tekst', environmentDescription(id)));
      kaart.addEventListener('click', () => {
        omgeving = id;
        for (const [m, k] of omgevingKnoppen) k.classList.toggle('is-actief', m === id);
      });
      omgevingKnoppen.set(id, kaart);
      omgevingen.appendChild(kaart);
    }
    sectieOmgeving.appendChild(omgevingen);
    links.appendChild(sectieOmgeving);

    // --- Rechterkolom: spelregels/varianten ----------------------------
    const rechts = el('div', 'kg-setup__kolom');
    body.appendChild(rechts);

    const sectieVariant = el('section', 'kg-setup__sectie');
    sectieVariant.appendChild(el('h2', 'kg-setup__sectiekop', t('setup.rules')));

    // Preset
    const preset = el('div', 'kg-preset');
    const presetTekst = el('div');
    presetTekst.appendChild(el('div', 'kg-variant-regel__label', t('setup.presetName')));
    presetTekst.appendChild(el('p', 'kg-hint', t('setup.presetHint')));
    const presetKnop = el('button', 'kg-btn kg-btn--stil', t('setup.presetRestore'));
    presetKnop.type = 'button';
    preset.append(presetTekst, presetKnop);
    sectieVariant.appendChild(preset);

    // Modus
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.modeHeading')));
    const modus = selectRij(t('setup.modeLabel'), '');
    const modusHint = modus.rij.querySelector<HTMLParagraphElement>('.kg-hint');
    for (const [waarde, label] of [
      ['standaard', t('setup.modeStandard')],
      ['dubbel', t('setup.modeDouble')],
    ] as const) {
      const opt = el('option', undefined, label);
      opt.value = waarde;
      modus.select.appendChild(opt);
    }
    sectieVariant.appendChild(modus.rij);

    // Troefbepaling
    const troef = selectRij(t('setup.trumpSelectionLabel'), t('setup.trumpSelectionHint'));
    for (const mode of TRUMP_MODES) {
      const opt = el('option', undefined, trumpModeName(mode));
      opt.value = mode;
      troef.select.appendChild(opt);
    }
    troef.select.addEventListener('change', () => {
      variant.trumpSelection = troef.select.value as TrumpSelectionMode;
    });
    sectieVariant.appendChild(troef.rij);

    // Hartenheer-punten
    const hh = selectRij(t('setup.heartKingLabel'), t('setup.heartKingHint'));
    for (const p of [5, 4] as const) {
      const opt = el('option', undefined, t('setup.penaltyPoints', { n: p }));
      opt.value = String(p);
      hh.select.appendChild(opt);
    }
    hh.select.addEventListener('change', () => {
      variant.hartenheerPoints = Number(hh.select.value) === 4 ? 4 : 5;
    });
    sectieVariant.appendChild(hh.rij);

    // Troefrondes
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.trumpRoundsHeading')));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.mustTrumpLabel'),
      t('setup.mustTrumpHint'),
      () => variant.mustTrump,
      (v) => { variant.mustTrump = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.mustOvertrumpLabel'),
      t('setup.mustOvertrumpHint'),
      () => variant.mustOvertrump,
      (v) => { variant.mustOvertrump = v; },
    ));

    // Negatieve rondes
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.negativeRoundsHeading')));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.stopKingLabel'),
      t('setup.stopKingHint'),
      () => variant.stopWhenKingFalls,
      (v) => { variant.stopWhenKingFalls = v; },
    ));

    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.strictHeading')));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.strictHeartsLabel'),
      t('setup.strictHeartsHint'),
      () => variant.discardRules.geenHarten,
      (v) => { variant.discardRules.geenHarten = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.strictKJLabel'),
      t('setup.strictKJHint'),
      () => variant.discardRules.geenHerenBoeren,
      (v) => { variant.discardRules.geenHerenBoeren = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.strictQueensLabel'),
      t('setup.strictQueensHint'),
      () => variant.discardRules.geenDames,
      (v) => { variant.discardRules.geenDames = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.strictKingLabel'),
      t('setup.strictKingHint'),
      () => variant.discardRules.hartenheer,
      (v) => { variant.discardRules.hartenheer = v; },
    ));

    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.heartLeadHeading')));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.heartLeadHeartsLabel'),
      t('setup.heartLeadHint'),
      () => variant.heartLeadBan.geenHarten,
      (v) => { variant.heartLeadBan.geenHarten = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.heartLeadKingLabel'),
      t('setup.heartLeadHint'),
      () => variant.heartLeadBan.hartenheer,
      (v) => { variant.heartLeadBan.hartenheer = v; },
    ));

    // Overige (WK-)regels
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.otherRulesHeading')));
    const dwangRegel = checkboxRegel(
      t('setup.forcedTrumpLabel'),
      t('setup.forcedTrumpHint'),
      () => variant.derdeGiftTroefdwang,
      (v) => { variant.derdeGiftTroefdwang = v; },
    );
    sectieVariant.appendChild(dwangRegel);
    sectieVariant.appendChild(checkboxRegel(
      t('setup.claimingLabel'),
      t('setup.claimingHint'),
      () => variant.claimingAllowed,
      (v) => { variant.claimingAllowed = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      t('setup.lowestWinsLabel'),
      t('setup.lowestWinsHint'),
      () => variant.lowestWins,
      (v) => { variant.lowestWins = v; },
    ));

    // Rondevolgorde
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', t('setup.orderHeading')));
    sectieVariant.appendChild(el('p', 'kg-hint', t('setup.orderHint')));
    const volgordeLijst = el('ol', 'kg-volgorde');
    sectieVariant.appendChild(volgordeLijst);

    rechts.appendChild(sectieVariant);

    // Voet met startknop
    const voet = el('footer', 'kg-setup__voet');
    const start = el('button', 'kg-btn kg-btn--groot', t('setup.start'));
    start.type = 'button';
    voet.appendChild(start);
    panel.appendChild(voet);

    // ------------------------------------------------------------------
    // Sectie-overstijgend gedrag
    // ------------------------------------------------------------------

    const syncModus = (): void => {
      modus.select.value = variant.mode;
      if (modusHint) {
        modusHint.textContent = variant.mode === 'dubbel'
          ? t('setup.modeHintDouble')
          : t('setup.modeHintStandard');
      }
      const dwangBox = dwangRegel.querySelector('input');
      if (dwangBox) dwangBox.disabled = variant.mode !== 'dubbel';
      dwangRegel.style.opacity = variant.mode === 'dubbel' ? '1' : '0.45';
      renderVolgorde(volgordeLijst);
    };

    modus.select.addEventListener('change', () => {
      variant.mode = modus.select.value === 'dubbel' ? 'dubbel' : 'standaard';
      syncModus();
    });

    presetKnop.addEventListener('click', () => {
      const count = variant.playerCount;
      variant = structuredClone(DEFAULT_VARIANT);
      variant.playerCount = count;
      // Betrouwbaarste weg: het paneel opnieuw opbouwen vanuit de state.
      const vers = build();
      ov.replaceWith(vers);
      overlay = vers;
    });

    start.addEventListener('click', () => {
      const spelers: PlayerConfig[] = [];
      for (let i = 0; i < variant.playerCount; i++) {
        const p = spelerPool[i];
        if (!p) continue;
        const naam = p.name.trim() || t('setup.playerPlaceholder', { n: i + 1 });
        spelers.push(
          p.kind === 'ai'
            ? { name: naam, kind: 'ai', aiDifficulty: p.aiDifficulty ?? 'gemiddeld' }
            : { name: naam, kind: 'human' },
        );
      }

      // Computernamen uniek houden én niet gelijk aan een mensennaam: koos een
      // mens een naam uit de pool, dan krijgt die computerspeler een andere.
      const bezetteNamen = new Set<string>();
      for (const s of spelers) {
        if (s.kind === 'human') bezetteNamen.add(s.name.trim().toLowerCase());
      }
      for (const s of spelers) {
        if (s.kind !== 'ai') continue;
        const huidig = s.name.trim().toLowerCase();
        if (huidig === '' || bezetteNamen.has(huidig)) {
          const [nieuw] = kiesAiNamen(1, bezetteNamen);
          if (nieuw) s.name = nieuw;
        }
        bezetteNamen.add(s.name.trim().toLowerCase());
      }
      const config: SetupConfig = {
        spelers,
        variant: structuredClone(variant),
        omgeving,
      };
      overlay?.remove();
      overlay = null;
      emitUiEvent(root, { type: 'setupComplete', config });
      onStart?.(config);
      onStart = null;
    });

    // Initiële sync vanuit de state.
    for (const [m, k] of aantalKnoppen) k.classList.toggle('is-actief', m === variant.playerCount);
    for (const [m, k] of omgevingKnoppen) k.classList.toggle('is-actief', m === omgeving);
    troef.select.value = variant.trumpSelection;
    hh.select.value = String(variant.hartenheerPoints);
    renderStoelen(stoelen);
    syncModus();

    return ov;
  }

  // ------------------------------------------------------------------
  // Publieke API
  // ------------------------------------------------------------------

  return {
    show(defaults?: Partial<SetupConfig>): Promise<SetupConfig> {
      variant = structuredClone(defaults?.variant ?? DEFAULT_VARIANT) as KingenVariantConfig;
      // Verdedig tegen kale defaults zonder volledige roundOrder.
      if (!Array.isArray(variant.roundOrder) || variant.roundOrder.length === 0) {
        variant.roundOrder = [...NEGATIVE_ROUND_KINDS] as KingenRoundKind[];
      }
      omgeving = defaults?.omgeving ?? 'cafe';

      spelerPool = defaultPlayers();
      if (defaults?.spelers) {
        defaults.spelers.forEach((p, i) => {
          if (i < spelerPool.length) spelerPool[i] = structuredClone(p);
        });
      }

      overlay?.remove();
      overlay = build();
      root.appendChild(overlay);

      return new Promise<SetupConfig>((resolve) => {
        onStart = resolve;
      });
    },

    hide(): void {
      overlay?.remove();
      overlay = null;
      onStart = null;
    },
  };
}
