# Mexen — implementatieplan

> Concreet bouwplan voor **Mexen** (de Nederlandse blufvariant met doorgeven; intl. Mäxchen/
> Mia/Meiern), gegrond in de bestaande engine-naden. Leest bovenop:
> `DICEGAME_RULES_RESEARCH.md` (regels + graphics-onderzoek) en `DICEGAME_PLAN.md`
> (dobbel-infra-haalbaarheid). Datum: 2026-06-14. Status: **plan** (nog geen code).
> Doel-branch: `claude/dobbelspellen-onderzoek`.

## 0. Samenvatting & belangrijkste ontwerpbeslissing

Mexen implementeert hetzelfde `GameDefinition<TState,TMove,TConfig>`-contract als Hartenjagen
(`packages/shared/src/core/types.ts:266`). Het is mechanisch **een fase-machine met één
actieve stoel tegelijk** (de bekerhouder) — dus *eenvoudiger* dan eerder gevreesd: het is
strikt sequentieel (geen simultane verzamelfase zoals Hartenjagen-doorgeven). De enige twee
bijzonderheden zijn (a) **verborgen worp** en (b) **een dobbel-renderlaag + beker**.

**Grondige correctie op `DICEGAME_PLAN.md` (verborgen info):** `getView(state, seat)` wordt al
**per stoel** berekend en AI's krijgen *uitsluitend* hun eigen view
(`PlayerController.chooseMove(view, ...)`, `player.ts:34`). Zolang we de geheime worp **alleen
in de `viewExtras` van de eigenaar** zetten en hem **niet** in broadcast-`custom`-events
stoppen, lekt er niets — ook niet naar AI-tegenstanders. ➡️ **De `room.personalize()`-verbouwing
is voor de Mexen-MVP niet strikt nodig.** We voegen wel een kleine, generieke
secret-strip-hook toe als hardening + voor toekomstige spellen (Perudo, geheime trekstapel),
maar de correctheid hangt er niet van af.

## 1. Hoe Mexen op de bestaande naden hangt

| Naad | Bestand | Hoe Mexen het gebruikt |
|---|---|---|
| `GameDefinition` | `core/types.ts:266` | `createMexenDefinition()` implementeert alle 8 methodes |
| Fase-machine via `currentActor` | `core/turnManager.ts` | `currentActor()` geeft de bekerhouder terug; `getLegalMoves` schakelt per `phase` |
| Generieke zetten | `PublicGameView.legalMoves` (`types.ts:240`) | `hand:[]`, `legalCards:[]`; alles via `legalMoves` + `viewExtras` (net als Hartenjagen) |
| `custom`-events | `types.ts:177` | worp/aankondiging/twijfel/onthulling/leven-kwijt als `custom`-subtypes |
| Per-stoel view | `getView(state,seat)` | geheime worp **alleen** in eigenaars `viewExtras` |
| Controller-contract | `player.ts:34` | mens + AI implementeren **alleen** `chooseMove(view, legalMoves)` |
| AI-registratie | `gameRegistry.ts:28` | `createAiController` → `MexenAi` |
| Registry | `games/registry.ts` | `registerGame(mexenGame)` |
| Render-plugin | `render/types.ts:151` | `DiceRenderPlugin.handleEvent()` vangt dobbel-events vóór de kaart-switch |
| Tween-engine | `render/animations.ts` | beker-schud + rol-animatie |
| Scoreboard/HUD | `client/ui/*`, `render/types.ts` | levens-HUD + bekerstatus (geen scorekaart) |

## 2. Verborgen-worp-ontwerp (de kern-subtiliteit)

Drie informatieklassen:
1. **Geheim (alleen eigenaar):** de werkelijke worp `actualRoll` van de huidige houder. Staat
   in `MexenState.actualRoll` en wordt in `getView` **uitsluitend** in `viewExtras.myRoll`
   gezet wanneer `seat === cupHolder`. Voor alle andere stoelen: `viewExtras.myRoll = null`.
2. **Publiek-altijd:** de **aankondiging** (`currentAnnouncement`), levens, wie aan de beurt is,
   richting, fase.
3. **Publiek-bij-onthulling:** bij `doubt` (beker optillen) wordt `actualRoll` bewust openbaar
   via een `custom:revealed { roll }`-event naar iedereen.

Events:
- `custom:diceRolled { seat }` — **geen** `roll`-veld → triggert alleen de beker-schud-animatie
  bij iedereen. De eigenaar leest zijn eigen ogen uit `viewExtras.myRoll` (komt via zijn view).
- `custom:announced { seat, value }` — publiek.
- `custom:cupPassed { from, to, unseen }` — publiek.
- `custom:doubted { doubter, announcer }` → `custom:revealed { announcer, roll, truthful }` → publiek.
- `custom:lifeLost { seat, amount, livesLeft }`, `custom:playerEliminated { seat }`,
  `custom:roundReset { starter }`.

Hardening (optioneel, generiek): breid `room.personalize()` (`server/room.ts:344`) uit met een
data-driven regel "strip veld X uit `custom`-subtype Y voor niet-bron-stoelen". Eén keer
generiek, niet per spel. **MVP werkt ook zonder**, omdat we secret niet in events stoppen.

## 3. Bestandsindeling

```
packages/shared/src/games/dice/
  dice.ts              — DieValue=1..6, rollDie/rollTwo(rng), seeded bovenop core/deck mulberry
packages/shared/src/games/mexen/
  types.ts             — MexenState, MexenMove, MexenVariantConfig, MEXEN_DEFAULT
  ranking.ts           — twoDiceRank(): canonieke ordening 31<…<65<11<…<66<21 (+ helpers)
  rules.ts             — mexenLegalMoves(state, seat) per fase
  engine.ts            — createMexenDefinition() (GameDefinition)
  ai.ts                — MexenAi (chooseMove: bluf/uitdaag-EV)
  index.ts             — mexenGame: GameEntry
  ranking.test-manual.ts, engine.test-manual.ts
packages/client/src/render/
  dice.ts              — DiceRenderer (procedurele dobbelsteen-meshes; zie graphics-research)
  diceCup.ts           — bekergeometrie + vilt-interieur (LatheGeometry)
  dicePlugin.ts        — DiceRenderPlugin (SceneRenderPlugin) — schud/rol/onthul/levens
packages/client/src/games/mexen/
  mexenHud.ts          — levens-strip + huidige aankondiging + bekerstatus
  mexenController.ts   — mens-invoer: chooseMove uit klikken (gooien/aankondigen/geloven/twijfelen)
```

## 4. Datamodel (`mexen/types.ts`)

```ts
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type Roll = readonly [DieValue, DieValue];

export type MexenPhase = 'rolling' | 'announcing' | 'responding' | 'finished';

export interface MexenVariantConfig {
  playerCount: number;          // 3..8
  startLives: number;           // default 6 (variant: 3)
  announceMode: 'strict' | 'tie'; // strikt hoger (default) vs 'mit'/gelijk toegestaan
  mexPenalty: number;           // levens-verlies bij Mäxchen-resolutie; default 2
  flatMexOnRoll: boolean;       // NL-drankvariant: 21 gooien = mexPenalty los; default false
  allowPassUnseen: boolean;     // beker ongezien doorgeven; default true
  scoreMode: 'elimination';     // v1 alleen eliminatie (strepen-variant later)
}

export const MEXEN_DEFAULT: MexenVariantConfig = {
  playerCount: 4, startLives: 6, announceMode: 'strict',
  mexPenalty: 2, flatMexOnRoll: false, allowPassUnseen: true, scoreMode: 'elimination',
};

export type MexenMove =
  | { type: 'roll' }
  | { type: 'announce'; value: number }      // value = ranking-code (zie ranking.ts)
  | { type: 'passUnseen'; value: number }    // herrollen niet, ongezien doorschuiven + aankondigen
  | { type: 'believe' }                      // geloof vorige aankondiging → ik word houder, ga rollen
  | { type: 'doubt' };                       // til de beker, onthul, reken af

export interface MexenState {
  config: MexenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: MexenPhase;
  roundIndex: number;
  lives: number[];                 // per stoel; 0 = af
  alive: boolean[];                // afgeleid gemak
  cupHolder: Seat;                 // wie nu de beker heeft / aan zet is
  direction: 1 | -1;               // met de klok mee = 1
  actualRoll: Roll | null;         // GEHEIM — alleen in eigenaars viewExtras
  rollSeen: boolean;               // heeft de houder zijn worp al bekeken (na 'roll')
  currentAnnouncement: number | null;   // ranking-code van de laatste aankondiging
  announcer: Seat | null;          // wie de huidige aankondiging deed
  lastReveal: { announcer: Seat; roll: Roll; truthful: boolean } | null;
  turn: Seat | null;
  totals: number[];                // resterende levens als "score" voor de scoreboard-UI
  scoresPerRound: number[][];
}
```

## 5. Waarde-ordening (`mexen/ranking.ts`)

Eén bron van waarheid voor de hele engine + AI + UI. Canonieke ordening (research, sterke
consensus): niet-paren oplopend `31<32<41<42<43<51<52<53<54<61<62<63<64<65`, dan paren
`11<22<33<44<55<66`, dan `21` (Mex) bovenaan.

```ts
// Rang-index 0..20 (laag→hoog). 'code' = tweecijferig getal, hoogste steen eerst.
export const RANK_ORDER: readonly number[] = [
  31,32,41,42,43,51,52,53,54,61,62,63,64,65, // 0..13 niet-paren
  11,22,33,44,55,66,                          // 14..19 paren
  21,                                         // 20 Mex
];
export function rollToCode(r: Roll): number { const [a,b]=r; const hi=Math.max(a,b), lo=Math.min(a,b); return hi*10+lo; }
export function rankOf(code: number): number { return RANK_ORDER.indexOf(code); } // -1 = ongeldig
export function isMex(code: number): boolean { return code === 21; }
export function isPair(code: number): boolean { return code % 11 === 0 && code <= 66; }
export function beats(a: number, b: number, mode: 'strict'|'tie'): boolean {
  return mode === 'strict' ? rankOf(a) > rankOf(b) : rankOf(a) >= rankOf(b);
}
```

(Let op: 21 ≠ paar; `rollToCode([2,1])=21` is een speciale code, niet "hoogste-eerst" — vandaar
een expliciete tabel i.p.v. puur rekenen. `[2,1]` en `[1,2]` geven beide code 21.)

## 6. Fase-machine & regels (`rules.ts` + `engine.ts`)

`currentActor(state)` = `state.cupHolder` (of `null` bij `finished`). `getLegalMoves(state, seat)`
(alleen als `seat === cupHolder`):

| phase | legale zetten | overgang in `applyMove` |
|---|---|---|
| `rolling` | `[{type:'roll'}]` | rol (seeded) → `actualRoll` gezet, `rollSeen=true`, emit `diceRolled{seat}` (zonder waarde) → `phase='announcing'` |
| `announcing` | alle codes met `beats(code, currentAnnouncement, mode)` als `announce`; + `passUnseen` (zelfde set) als `allowPassUnseen`; bij eerste worp v/d ronde: alle 21 codes | `announce` → `currentAnnouncement=value`, `announcer=seat`, beker naar volgende levende stoel, `phase='responding'`, emit `announced`+`cupPassed` |
| `responding` | `[{type:'believe'}, {type:'doubt'}]` | zie resolutie hieronder |
| `finished` | `[]` | — |

**`believe`:** de nieuwe houder gelooft → wordt zelf houder, `phase='rolling'` (hij gooit en moet
hoger aankondigen). `actualRoll=null` (verse worp). Geen levensverlies.

**`doubt`:** onthul `state.actualRoll` van de **announcer** (die zit nog in state tot hier).
`truthful = beats(actualRoll-code, currentAnnouncement, 'tie')` → werkelijke worp ≥ aangekondigd.
- `truthful` → **twijfelaar** verliest leven(s).
- `!truthful` → **announcer** verliest leven(s).
- Aantal = `mexPenalty` als `currentAnnouncement===21` (Mäxchen-resolutie), anders 1.
- emit `doubted`+`revealed`+`lifeLost`; check eliminatie; **nieuwe ronde** (`roundReset`),
  begonnen door de zojuist foute speler (`startRound(loser)`), `actualRoll=null`,
  `currentAnnouncement=null`, `phase='rolling'`.

**Eliminatie/einde:** `lives[seat]→0` ⇒ `alive[seat]=false`, `playerEliminated`. Als nog 1
levende stoel over: `phase='finished'`, `gameEnd{winners:[laatste]}`.

**`flatMexOnRoll`-variant:** als aan en de werkelijke worp is 21, trek bij onthulling extra
`mexPenalty` van de gooier af (los van waar/onwaar). Default uit.

**Cup-passing/richting:** `nextAliveSeat(cupHolder, direction)` slaat eliminated stoelen over.

## 7. Events (hergebruik + custom)

Hergebruikt: `gameStart`, `roundStart`(roundKind `'mexen'`), `roundEnd`(delta = levens-verlies),
`scoreUpdate`(totals = resterende levens), `gameEnd`, `turnStart`. **Geen** `deal`.
Custom-subtypes: zie §2. De `DiceRenderPlugin` mapt elk subtype op een animatie/HUD-update.

## 8. AI (`mexen/ai.ts`) — bluf/uitdaag-heuristiek

`chooseMove(view, legalMoves)` met denkvertraging (zelfde patroon als `HartenjagenAi`). Leest
`view.viewExtras.myRoll` (alleen gevuld als deze AI de houder is) en `currentAnnouncement`.

- **rolling:** altijd `roll`.
- **announcing:** als de echte worp `beats` de vereiste ondergrens → eerlijk de **laagste
  geldige waarde ≥ eigen worp** aankondigen (zo min mogelijk weggeven). Anders **bluffen**: de
  laagste verplichte waarde aankondigen (kleinste leugen). Bluf-agressie schaalt met difficulty.
- **responding:** schat P(announcement waar). Twijfel als de geëiste waarde
  onwaarschijnlijk/onmogelijk hoog is (bv. announcement is 21 of een hoog paar terwijl er al veel
  hoog geclaimd is). Drempel per difficulty. Anders `believe`. Eenvoudige kansheuristiek per
  ranking-index; geen zoekboom.

## 9. Client / render

- **`DiceRenderer`** (`render/dice.ts`): `RoundedBoxGeometry` + procedurele pip-geometrie of
  canvas-`normalMap` (zie graphics-research §7), `MeshPhysicalMaterial` (casinohars of ivoor),
  env via bestaande omgeving (`casino`-environment past). Deterministisch landen:
  eindrotatie `Quaternion.setFromUnitVectors(faceNormal, +Y)` op de door de engine bepaalde worp.
- **`diceCup.ts`**: `LatheGeometry` beker + vilt-interieur (`sheen`); schud-animatie via de
  bestaande tween-engine.
- **`DiceRenderPlugin`** (`SceneRenderPlugin`): `handleEvent` reageert op de custom-subtypes en
  geeft `true` terug (kaart-switch overslaan). **Ontwerpnoot:** het plugin-contract levert een
  `CardAnimator` mee die geen dobbel-methodes heeft → de plugin **closet over zijn eigen
  `DiceRenderer`/scene-refs** (geconstrueerd naast de `SceneManager`) en negeert de meegegeven
  animator. Alternatief: `SceneRenderPlugin` een rijker context-object geven — buiten MVP-scope.
- **`mexenHud.ts`**: per stoel een levens-indicator (6→0), de huidige aankondiging groot in
  beeld, en wiens beurt/beker. Alleen de eigenaar ziet zijn eigen ogen (uit de view).
- **`mexenController.ts`**: vertaalt klikken (schud-knop, aankondig-kiezer, geloven/twijfelen-
  knoppen) naar `chooseMove`-resultaten reference-gelijk aan een element uit `legalMoves`.

## 10. Canonieke default (uit het regelonderzoek)

2 stenen + beker · 6 levens · **strikt hoger** aankondigen · ordening niet-paren<paren<21 ·
ware claim → twijfelaar verliest, leugen → aankondiger verliest · **Mäxchen-resolutie = 2
levens** · `flatMexOnRoll` uit · beker ongezien doorgeven aan · met de klok mee · foute speler
start de nieuwe ronde, verse beker. **Géén "halve mex = 1+4"** (dat hoort bij het andere spel).
Alle afwijkingen zijn config-flags (§4) zodat varianten later aanklikbaar zijn.

## 11. Teststrategie (`*.test-manual.ts`, zelfde stijl als bestaande spellen)

- `ranking.test-manual.ts`: de volledige 21-traps ordening; `beats` strict vs tie; 21 verslaat
  66; paren verslaan niet-paren; `[1,2]`/`[2,1]`→21.
- `engine.test-manual.ts`: rolling→announcing→responding-cyclus; doubt-resolutie beide kanten;
  Mäxchen dubbele straf; eliminatie; nieuwe-ronde-starter; eerste-worp-21; determinisme (gelijke
  seed ⇒ gelijke worpen). **Lekkagetest:** `getView(state, otherSeat).viewExtras.myRoll === null`
  zolang `otherSeat !== cupHolder`, en geen `custom`-event bevat `roll` vóór `revealed`.
- Server-integratietest (à la `integration.hartenjagen.test-manual.ts`): volledige partij met AI's.

## 12. Gefaseerd bouwplan

| # | Stap | Effort | Afhankelijk van |
|---|---|---|---|
| D0a | `games/dice/dice.ts` (DieValue + seeded `rollTwo`) | 0.5 d | — |
| D0b | `DiceRenderer` + `diceCup` + `DiceRenderPlugin`-skelet (statische worp eerst) | 3-4 d | D0a |
| 1 | `mexen/ranking.ts` + test | 0.5 d | D0a |
| 2 | `mexen/types.ts` + `rules.ts` + `engine.ts` + test (headless, AI-only) | 2-3 d | 1 |
| 3 | `mexen/ai.ts` (bluf/uitdaag-heuristiek) | 1-2 d | 2 |
| 4 | `mexen/index.ts` + registratie + server-integratietest | 0.5 d | 2,3 |
| 5 | `mexenHud.ts` + `mexenController.ts` (mens speelt in de UI) | 2-3 d | D0b,2 |
| 6 | Rol-/schud-animatie + deterministisch landen + beker-onthul-polish | 2-3 d | D0b,5 |
| 7 | (optioneel) generieke `personalize()` secret-strip-hook + lekkagetest-hardening | 1 d | 2 |

**Snelste pad naar "speelbaar":** D0a → 1 → 2 → 3 → 4 levert een **volledig speelbare,
geteste Mexen headless/AI-engine** zónder render (~5-7 d). Daarna D0b → 5 → 6 voor de
grafische beleving. Dit ontkoppelt regel-correctheid van render-finetuning.

## 13. Beslissingen

**Vastgelegd (2026-06-14):**
- ✅ **Variant-defaults uit §10 akkoord:** 6 levens, **strikt-hoger** aankondigen,
  **Mäxchen-resolutie = 2 levens**, `flatMexOnRoll` uit, géén "halve mex". Overige varianten
  blijven beschikbaar als config-flag (§4), niet standaard.
- ✅ **Verborgen-worp-render: volledige 3D-dobbelbeker** met schud/optil-animatie; alleen de
  eigenaar ziet zijn stenen onder de beker. ➡️ Stap D0b + stap 6 krijgen de zwaardere scope:
  echte beker-geometrie (`LatheGeometry` + vilt-interieur), schud-animatie, en een
  optil/onthul-beweging bij `doubt`. De eigen worp wordt onder de eigen beker getoond (uit de
  view); andermans beker blijft dicht tot onthulling.

**Nog open:**
1. **Spelersbereik:** 3-8 stoelen? (Mexen werkt vanaf 3; UI-tafel-ondersteuning checken bij stap 5.)
2. **Dobbelsteen-look default:** doorschijnende casinohars of ivoor/been? (skin-keuze; cosmetisch,
   kan tijdens stap D0b bepaald worden.)
3. **Personalize-hardening (stap 7) nu of later?** MVP is correct zonder; de hook is puur
   defense-in-depth + voorbereiding op Perudo/geheime trekstapel.
