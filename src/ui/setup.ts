/**
 * src/ui/setup.ts
 * Setup-scherm (DOM-overlay in #ui): aantal spelers (3-5), per stoel
 * mens/computer + naam + AI-niveau, variantkeuze (standaard/dubbel + alle
 * vlaggen uit KingenVariantConfig), omgevingskeuze. Nederlandse teksten.
 */

import '../styles.css';
import type { PlayerConfig } from '../core/types.ts';
import type { KingenRoundKind, KingenVariantConfig, TrumpSelectionMode } from '../games/kingen/types.ts';
import { DEFAULT_VARIANT, NEGATIVE_ROUND_KINDS, ROUND_LABELS_NL } from '../games/kingen/types.ts';
import type { EnvironmentId } from '../render/types.ts';
import { ENVIRONMENT_IDS } from '../render/types.ts';
import type { SetupConfig, SetupScreen } from './types.ts';
import { ROUND_EXPLANATIONS_NL, el, emitUiEvent } from './uiBus.ts';

// ---------------------------------------------------------------------------
// Vaste teksten en icoontjes
// ---------------------------------------------------------------------------

const DEFAULT_NAMES = ['Jij', 'Anna', 'Bram', 'Carla', 'Daan'] as const;

const ENV_INFO: Record<EnvironmentId, { naam: string; tekst: string }> = {
  cafe: { naam: 'Bruin café', tekst: 'Warm lamplicht, hout en gezelligheid' },
  keukentafel: { naam: 'Keukentafel', tekst: 'Huiselijk potje onder de hanglamp' },
  casino: { naam: 'Casino', tekst: 'Groen vilt en gedempte spots' },
};

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

const TRUMP_MODE_LABELS: Record<TrumpSelectionMode, string> = {
  delerKiest: 'Deler kiest troef',
  laatsteKaart: 'Laatste kaart bepaalt troef',
  uitkomerKiest: 'Uitkomer kiest troef',
};

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

  function defaultPlayers(): PlayerConfig[] {
    return DEFAULT_NAMES.map((name, i): PlayerConfig =>
      i === 0
        ? { name, kind: 'human' }
        : { name, kind: 'ai', aiDifficulty: 'gemiddeld' },
    );
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
      naam.placeholder = `Speler ${i + 1}`;
      naam.addEventListener('input', () => {
        cfg.name = naam.value;
      });
      naamWrap.appendChild(naam);
      rij.appendChild(naamWrap);

      // Mens/Computer-schakelaar (stoel 1 = altijd de lokale mens).
      const soort = el('div', 'kg-soort');
      const mensKnop = el('button', 'kg-soort__knop', 'Mens');
      mensKnop.type = 'button';
      const aiKnop = el('button', 'kg-soort__knop', 'Computer');
      aiKnop.type = 'button';
      soort.append(mensKnop, aiKnop);
      rij.appendChild(soort);

      const niveau = el('select');
      niveau.title = 'Speelsterkte van de computerspeler';
      for (const d of AI_LEVELS) {
        const opt = el('option', undefined, d.charAt(0).toUpperCase() + d.slice(1));
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
        aiKnop.title = 'Stoel 1 is jouw eigen stoel';
      } else {
        // Hotseat (meerdere mensen aan één scherm) wordt nog niet ondersteund;
        // bied 'Mens' hier dus eerlijk niet aan in plaats van het stilzwijgend
        // door de computer te laten overnemen.
        cfg.kind = 'ai';
        cfg.aiDifficulty = cfg.aiDifficulty ?? 'gemiddeld';
        mensKnop.disabled = true;
        mensKnop.title = 'Meerdere menselijke spelers aan één scherm komt later';
        aiKnop.disabled = true;
        aiKnop.title = 'Deze stoel wordt door de computer gespeeld';
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
      const naam = el('span', 'kg-volgorde__naam', ROUND_LABELS_NL[kind]);
      naam.title = ROUND_EXPLANATIONS_NL[kind] ?? '';
      li.appendChild(naam);

      const omhoog = el('button', 'kg-btn kg-btn--stil kg-btn--mini', '▲');
      omhoog.type = 'button';
      omhoog.title = 'Eerder spelen';
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
      omlaag.title = 'Later spelen';
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
    const titel = el('h1', 'kg-setup__titel');
    titel.innerHTML = '<span class="kg-suit-deco">♠</span>Kingen<span class="kg-suit-deco">♥</span>';
    kop.appendChild(titel);
    kop.appendChild(el('p', 'kg-setup__ondertitel', 'Het klassieke Nederlandse kaartspel — nu in 3D'));
    panel.appendChild(kop);

    const body = el('div', 'kg-setup__body');
    panel.appendChild(body);

    // --- Linkerkolom: spelers + omgeving -------------------------------
    const links = el('div', 'kg-setup__kolom');
    body.appendChild(links);

    // Aantal spelers
    const sectieAantal = el('section', 'kg-setup__sectie');
    sectieAantal.appendChild(el('h2', 'kg-setup__sectiekop', 'Aantal spelers'));
    const aantal = el('div', 'kg-aantal');
    const aantalKnoppen = new Map<3 | 4 | 5, HTMLButtonElement>();
    const stoelen = el('div');
    for (const n of [3, 4, 5] as const) {
      const knop = el('button', 'kg-aantal__knop', `${n} spelers`);
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
    sectieAantal.appendChild(
      el('p', 'kg-hint', 'Bij 3 of 5 spelers worden enkele tweetjes uit het spel genomen zodat de kaarten gelijk opgaan.'),
    );
    links.appendChild(sectieAantal);

    // Stoelen
    const sectieStoelen = el('section', 'kg-setup__sectie');
    sectieStoelen.appendChild(el('h2', 'kg-setup__sectiekop', 'Aan tafel'));
    sectieStoelen.appendChild(stoelen);
    links.appendChild(sectieStoelen);

    // Omgeving
    const sectieOmgeving = el('section', 'kg-setup__sectie');
    sectieOmgeving.appendChild(el('h2', 'kg-setup__sectiekop', 'Omgeving'));
    const omgevingen = el('div', 'kg-omgevingen');
    const omgevingKnoppen = new Map<EnvironmentId, HTMLButtonElement>();
    for (const id of ENVIRONMENT_IDS) {
      const info = ENV_INFO[id];
      const kaart = el('button', 'kg-omgeving');
      kaart.type = 'button';
      kaart.innerHTML = ENV_ICONS[id];
      kaart.appendChild(el('div', 'kg-omgeving__naam', info.naam));
      kaart.appendChild(el('div', 'kg-omgeving__tekst', info.tekst));
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
    sectieVariant.appendChild(el('h2', 'kg-setup__sectiekop', 'Spelregels'));

    // Preset
    const preset = el('div', 'kg-preset');
    const presetTekst = el('div');
    presetTekst.appendChild(el('div', 'kg-variant-regel__label', 'Standaard (Nederlands)'));
    presetTekst.appendChild(
      el('p', 'kg-hint', '10 gevingen, deler kiest troef, hartenheer 5 punten, strikte huisregels.'),
    );
    const presetKnop = el('button', 'kg-btn kg-btn--stil', 'Herstel standaard');
    presetKnop.type = 'button';
    preset.append(presetTekst, presetKnop);
    sectieVariant.appendChild(preset);

    // Modus
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Spelmodus'));
    const modus = selectRij('Modus', '');
    const modusHint = modus.rij.querySelector<HTMLParagraphElement>('.kg-hint');
    for (const [waarde, label] of [
      ['standaard', 'Standaard (10 gevingen)'],
      ['dubbel', 'Dubbelkingen (deler kiest het spel)'],
    ] as const) {
      const opt = el('option', undefined, label);
      opt.value = waarde;
      modus.select.appendChild(opt);
    }
    sectieVariant.appendChild(modus.rij);

    // Troefbepaling
    const troef = selectRij('Troefbepaling', 'Hoe wordt in troefrondes de troefkleur gekozen?');
    for (const mode of Object.keys(TRUMP_MODE_LABELS) as TrumpSelectionMode[]) {
      const opt = el('option', undefined, TRUMP_MODE_LABELS[mode]);
      opt.value = mode;
      troef.select.appendChild(opt);
    }
    troef.select.addEventListener('change', () => {
      variant.trumpSelection = troef.select.value as TrumpSelectionMode;
    });
    sectieVariant.appendChild(troef.rij);

    // Hartenheer-punten
    const hh = selectRij(
      'Straf voor de hartenheer',
      '5 punten is gangbaar in Nederland; 4 is de klassieke telling.',
    );
    for (const p of [5, 4] as const) {
      const opt = el('option', undefined, `${p} strafpunten`);
      opt.value = String(p);
      hh.select.appendChild(opt);
    }
    hh.select.addEventListener('change', () => {
      variant.hartenheerPoints = Number(hh.select.value) === 4 ? 4 : 5;
    });
    sectieVariant.appendChild(hh.rij);

    // Troefrondes
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Troefrondes'));
    sectieVariant.appendChild(checkboxRegel(
      'Verplicht kopen',
      'Wie niet kan bekennen, moet een troefkaart spelen als hij die heeft.',
      () => variant.mustTrump,
      (v) => { variant.mustTrump = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Verplicht overtroeven',
      'Ligt er al een troef, dan moet je er met een hogere troef overheen als dat kan.',
      () => variant.mustOvertrump,
      (v) => { variant.mustOvertrump = v; },
    ));

    // Negatieve rondes
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Negatieve rondes'));
    sectieVariant.appendChild(checkboxRegel(
      'De King stopt de ronde',
      'Zodra de hartenheer gevallen is, wordt de King-ronde direct afgebroken.',
      () => variant.stopWhenKingFalls,
      (v) => { variant.stopWhenKingFalls = v; },
    ));

    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Strikt afgooien (niet kunnen bekennen)'));
    sectieVariant.appendChild(checkboxRegel(
      'Strikt bij “Geen harten”',
      'Kun je niet bekennen, dan móét je een harten afgooien als je die hebt.',
      () => variant.discardRules.geenHarten,
      (v) => { variant.discardRules.geenHarten = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Strikt bij “Geen heren en boeren”',
      'Kun je niet bekennen, dan móét je een heer of boer afgooien als je die hebt.',
      () => variant.discardRules.geenHerenBoeren,
      (v) => { variant.discardRules.geenHerenBoeren = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Strikt bij “Geen dames”',
      'Kun je niet bekennen, dan móét je een dame afgooien als je die hebt.',
      () => variant.discardRules.geenDames,
      (v) => { variant.discardRules.geenDames = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Strikt bij “De King”',
      'Kun je niet bekennen, dan móét je de hartenheer afgooien als je hem hebt.',
      () => variant.discardRules.hartenheer,
      (v) => { variant.discardRules.hartenheer = v; },
    ));

    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Uitkomen met harten'));
    sectieVariant.appendChild(checkboxRegel(
      'Hartenverbod bij “Geen harten”',
      'Niet met harten uitkomen, tenzij je alleen nog harten hebt.',
      () => variant.heartLeadBan.geenHarten,
      (v) => { variant.heartLeadBan.geenHarten = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Hartenverbod bij “De King”',
      'Niet met harten uitkomen, tenzij je alleen nog harten hebt.',
      () => variant.heartLeadBan.hartenheer,
      (v) => { variant.heartLeadBan.hartenheer = v; },
    ));

    // Overige (WK-)regels
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Overige regels'));
    const dwangRegel = checkboxRegel(
      'Derde-gift-troefdwang (dubbelkingen)',
      'Wie bij zijn derde keuzebeurt nog nooit troef koos, wordt daartoe verplicht (WK-regel).',
      () => variant.derdeGiftTroefdwang,
      (v) => { variant.derdeGiftTroefdwang = v; },
    );
    sectieVariant.appendChild(dwangRegel);
    sectieVariant.appendChild(checkboxRegel(
      'Hand afleggen toegestaan',
      'Een speler mag claimen en neemt dan in één keer alle resterende strafpunten (WK-regel).',
      () => variant.claimingAllowed,
      (v) => { variant.claimingAllowed = v; },
    ));
    sectieVariant.appendChild(checkboxRegel(
      'Alles als straf — laagste wint',
      'Ook troefslagen tellen als strafpunten; wie het laagst eindigt, wint.',
      () => variant.lowestWins,
      (v) => { variant.lowestWins = v; },
    ));

    // Rondevolgorde
    sectieVariant.appendChild(el('h3', 'kg-variant-groepkop', 'Volgorde van de negatieve rondes'));
    sectieVariant.appendChild(el('p', 'kg-hint',
      'Alleen in standaardmodus; daarna volgen de troefrondes. Hover voor uitleg per ronde.'));
    const volgordeLijst = el('ol', 'kg-volgorde');
    sectieVariant.appendChild(volgordeLijst);

    rechts.appendChild(sectieVariant);

    // Voet met startknop
    const voet = el('footer', 'kg-setup__voet');
    const start = el('button', 'kg-btn kg-btn--groot', 'Deel de kaarten');
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
          ? 'Deler kiest per geving het spel; elk negatief spel max. 2x, troef precies 2x per speler.'
          : 'Vaste volgorde: zes negatieve rondes, daarna één troefronde per speler.';
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
        const naam = p.name.trim() || `Speler ${i + 1}`;
        spelers.push(
          p.kind === 'ai'
            ? { name: naam, kind: 'ai', aiDifficulty: p.aiDifficulty ?? 'gemiddeld' }
            : { name: naam, kind: 'human' },
        );
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
