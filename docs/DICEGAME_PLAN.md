# Kingen → Dobbelspellen: haalbaarheids- en uitbreidingsonderzoek

> Onderzoek naar wat er nodig is om **dobbelspellen** toe te voegen aan de bestaande
> (kaartspel-)engine. Gebaseerd op een grondige codebase-analyse van de Phase-0-naden
> (`core/types.ts`, `turnManager.ts`, `gameRegistry.ts`, `protocol.ts`, server-loop en
> client-render). Datum: 2026-06-14. Status: **verkenning** — nog geen code.

## Conclusie vooraf

De engine is na Phase 0 **verrassend goed voorbereid** op niet-kaartspellen. De spelloop,
het zet-protocol, de registry en de server-afhandeling zijn al volledig spel-agnostisch.
Een dobbelspel hangt zichzelf op aan dezelfde naden die Pesten/Jokeren gebruiken
(`legalMoves`, `viewExtras`, `custom`-events, `SceneRenderPlugin`), **zonder** de kern te
hoeven verbouwen. Ruwe inschatting: **~85-95% van de infra is herbruikbaar**; het echte
werk zit in (a) een nieuw dobbelsteen-rendermodel en (b) de per-spel regels/scoring.

De enige twee kern-aanpassingen die écht nodig zijn betreffen **één archetype**
(bluf-/verborgen-dobbelspellen zoals Mexen): de `room.personalize()`-filter en de
3D-render. De overige archetypes (Yahtzee, Tienduizend) hebben **geen** kern-wijziging nodig.

## Hergebruik-matrix (uit codebase-analyse)

| Component | Bestand | Status | Toelichting |
|---|---|---|---|
| Spelloop | `core/turnManager.ts:61-86` | ✅ klaar | `currentActor → getView → getLegalMoves → applyMove → publish`; geen kaart-aannames |
| Multi-actie-beurt | `core/turnManager.ts:62` | ✅ klaar | Eén speler mag worp→houden→herworp→scoren; `currentActor()` blijft dezelfde stoel, `getLegalMoves()` schakelt per fase |
| Zet-dispatch | `core/player.ts:28-34` | ✅ klaar | `chooseMove(view, legalMoves: unknown[]): unknown` is volledig open |
| Zet-type | `core/player.ts:56-62` | ✅ klaar | `{type:string}` + optionele velden; kaart-velden worden genegeerd door generieke spellen |
| Protocol | `net/protocol.ts:85-93` | ✅ klaar | `moveType:string` (hint) + `legalMoves:unknown[]`; serialiseerbaar voor elke zet-vorm |
| Server move-loop | `server/remotePlayer.ts:62-80` | ✅ klaar | Validatie via JSON-gelijkheid; fallback = eerste legale zet; geen kaart-begrip |
| GameHost | `server/gameHost.ts:45-74` | ✅ klaar | Registry-gedreven controller-keuze; per-spel AI via `createAiController` |
| RoomManager | `server/roomManager.ts:42-65` | ✅ klaar | min/maxPlayers uit de registry |
| GameRegistry | `core/gameRegistry.ts:12-34` | ✅ klaar | Volledig geparametriseerd `GameEntry<TState,TMove,TConfig>` |
| GameDefinition | `core/types.ts:266-296` | ✅ klaar | Puur generiek contract; nergens kaart/slag/kleur |
| Seeded RNG | `core/deck.ts:85-94` | ✅ klaar | `createRng()` (mulberry32) **direct** herbruikbaar voor deterministische worpen |
| Shuffle | `core/deck.ts` | ✅ klaar | Fisher-Yates; bruikbaar voor willekeurige dobbel-subsetkeuzes |
| ScoreSheet | `core/scoresheet.ts:22-69` | ✅ klaar | `ScoreRow[]` is generiek; werkt 1-op-1 voor dobbel-categorieën |
| Scoreboard (UI) | `client/ui/scoreboard.ts` | ✅ klaar | Rendert elke `ScoreRow[]`; alleen `roundKind`-styling is Kingen-getint |
| Setup (UI) | `client/ui/setup.ts` | ✅ klaar | Variant/omgeving/spelers; geen kaart-aannames |
| Toasts/dialogen | `client/ui/notifications.ts` | ✅ klaar | Generiek; eigen dobbel-dialogen toevoegen |
| Tween-engine | `client/render/animations.ts:14-86` | ✅ klaar | Easing/tweening volledig herbruikbaar voor rol-animaties |
| TableLayout | `client/render/animations.ts:104-162` | ✅ klaar | Parametrisch op stoelen; nieuwe dobbel-zones toevoegen |
| Render-event-plugin | `client/render/types.ts:151-153` | ✅ klaar | `SceneRenderPlugin.handleEvent()` vangt custom-events vóór de kaart-switch |
| **PublicGameView** | `core/types.ts:190-243` | ⚠️ deels | `hand`/`legalCards` zijn `Card[]`-getypeerd; gebruik `legalMoves` + `viewExtras` i.p.v. |
| **GameEvent** | `core/types.ts:149-177` | ⚠️ deels | `deal/playCard/trickWon` zijn kaart-getint; gebruik `custom`-events voor worp/houd/score |
| **room.personalize()** | `server/room.ts:344-350` | ⚠️ aanpassen | Filtert nu alleen `'deal'`-events; verborgen worpen (Mexen) vereisen uitbreiding |
| **AiStrategy** | `ai/types.ts:18-39` | ⚠️ n.v.t. | Kingen-legacy (chooseCard/chooseTrump); omzeil via eigen `createAiController` met `chooseMove` |
| CardRenderer | `client/render/cards.ts` | ❌ nieuw | Dobbelsteen heeft eigen renderer nodig (`DiceRenderer`) |
| CardAnimator | `client/render/types.ts:115-143` | ❌ nieuw | `animateDeal/Play/CollectTrick` zijn slag-only; dobbel heeft eigen animaties |
| Kingen engine/rules | `games/kingen/*` | ❌ nieuw | Per-spel; dient alleen als structuurtemplate |

## Het multi-actie-beurt-vraagstuk (opgelost)

Het mechanische hart van vrijwel elk dobbelspel is: **één speler doet meerdere acties per
beurt** (gooien → stenen vasthouden → opnieuw gooien → categorie kiezen / banken). De vraag
was of `TurnManager`/`currentActor` dat aankan zonder hack.

**Antwoord: ja, out-of-the-box.** De loop (`turnManager.ts:61-86`) vraagt per iteratie
opnieuw `currentActor(state)`. Door in de `DiceState` een `phase` (`'rolling'`,
`'choosingKeep'`, `'scoring'`) bij te houden, geeft `currentActor()` simpelweg dezelfde
stoel terug tot de beurt klaar is, en levert `getLegalMoves()` per fase andere zetten:

```ts
getLegalMoves(state, seat): DiceMove[] {
  if (state.phase === 'rolling')      return [{ type: 'roll' }];
  if (state.phase === 'choosingKeep') return alleSubsets(state.currentRoll).map(idx => ({ type: 'keep', indices: idx }));
  if (state.phase === 'scoring')      return state.openCategories.map(c => ({ type: 'score', category: c }));
  return [];
}
```

`applyMove()` zet de volgende fase en publiceert een `custom`-event per stap. Geen enkele
wijziging aan de kern. Dit dekt Yahtzee, Tienduizend en Chicago volledig.

## Dobbelspel-archetypes en wat ze van de infra vragen

| # | Archetype | NL-spellen | Verborgen info? | Simultaan? | Kern-impact |
|---|---|---|---|---|---|
| A | **Roll-keep-score** (vaste scorekaart) | Yahtzee/Yatzy, Generala, Kniffel | nee (open worp) | nee | **geen** — puur `viewExtras`+`legalMoves` |
| B | **Push-your-luck** (accumuleren + banken/bust) | Tienduizend (10.000), Farkle | nee | nee | **geen** — extra `bank`/`continue`-zetten |
| C | **Vaste-doel-per-ronde** | Chicago, Zilvervloot | nee | nee | **geen** |
| D | **Bluf/verborgen worp + uitdagen** | Mexen (Mäxchen), Bluffpoker (Perudo) | **ja** | nee | `personalize()` uitbreiden; verborgen worp + challenge-zet |
| E | **Markeer-eigen-blad** (gedeelde worp, ieder vult zelf) | Qwixx, Qwingo | nee | **deels** | multi-actor/verzamel-fase (zelfde infra als Ezelen/Hartenjagen-doorgeven) |

**Aanbeveling voor de bouwvolgorde:** begin met **archetype A (Yahtzee)** als eerste klant
— het is het bekendst, heeft géén kern-impact, en bouwt de gedeelde dobbel-infra
(DiceRenderer, DiceRenderPlugin, scorekaart-HUD) die alle andere archetypes erven. Daarna
**B (Tienduizend)** voor de NL-herkenbaarheid (push-your-luck op dezelfde render). **D (Mexen)**
pas later, want het is de enige die de `personalize()`-verbouwing en verborgen-worp-render
afdwingt. **E (Qwixx)** als laatst — dat deelt de simultane-fase-problematiek met Ezelen en
hoort eerder bij die kern-uitbreiding dan bij de dobbel-laag.

## Benodigde nieuwe infra (gedeeld, eenmalig: "Phase D0")

1. **Dobbelsteen-model** (`packages/shared/src/games/dice/dice.ts`): `type DieValue = 1|2|3|4|5|6`
   (configureerbaar voor afwijkende stenen), `interface Die { value: DieValue; kept: boolean }`,
   en een seeded `rollDice(rng, n)`-helper bovenop het bestaande `createRng()`. Additief —
   raakt het kaartmodel niet.
2. **DiceRenderer** (`packages/client/src/render/dice.ts`): procedurele dobbelsteen-meshes met
   pip-textures (zelfde aanpak als de canvas-kaarttextures), in lijn met het "geen externe
   assets"-principe. Een geronde kubus + 1-6 pips per vlak; herbruikt de bestaande
   `MeshPhysicalMaterial`-stijl.
3. **DiceRenderPlugin** (`SceneRenderPlugin`): vangt `custom:diceRolled` (rol-animatie met de
   tween-engine), `custom:diceKept` (vastgehouden stenen blijven, rest "verdwijnt"),
   `custom:diceScored`. Geeft `true` terug zodat de kaart-switch wordt overgeslagen.
4. **Dobbel-HUD-plugin**: vervangt troef/slagen-badges door een scorekaart-overlay (Yahtzee:
   13 categorieën × stoelen) of een ronde-pot-teller (Tienduizend). De `hud.ts`-troefbadge en
   slagenteller zijn de enige Kingen-getinte HUD-stukken; de rest (beurt-indicator, namen,
   ronde-label) is herbruikbaar.
5. **Dobbel-invoer-controller** (mens): `chooseMove(view, legalMoves)` die klikken op
   3D-stenen (vasthouden) en op scorekaart-cellen (categorie kiezen) vertaalt naar de juiste
   `legalMoves`-keuze.

## Kern-aanpassingen (alleen voor archetype D — verborgen worp)

- **`room.personalize()`** (`server/room.ts:344-350`) filtert nu alleen `event.type === 'deal'`.
  Voor Mexen/Bluffpoker moet de worp van een speler verborgen blijven voor anderen. Uitbreiden
  naar een per-event/per-bron-filter (dezelfde verbouwing die het multi-game-plan al voorziet
  voor Pesten/Jokeren geheime trekstapel). **Niet** nodig voor Yahtzee/Tienduizend (open worp).
- **Challenge-/uitdaag-zet**: een tweede-actor-interactie (speler X daagt de claim van speler Y
  uit). Past binnen `getLegalMoves`/`applyMove`, maar leunt op dezelfde "per-stoel pending /
  multi-actor"-helper die Hartenjagen-doorgeven en Toepen-respons ook nodig hebben.

## Voorgestelde bestandsindeling

```
packages/shared/src/games/dice/
  dice.ts          — Die/DieValue + seeded rollDice() (gedeeld over alle dobbelspellen)
  yahtzee/
    types.ts       — YahtzeeState, YahtzeeMove, YahtzeeConfig
    engine.ts      — YahtzeeDefinition (GameDefinition)
    rules.ts       — legalMoves per fase (roll/keep/score)
    scoring.ts     — 13 categorieën + bonus
    index.ts       — GameEntry + createAiController
packages/client/src/render/
  dice.ts          — DiceRenderer (procedurele meshes)
  dicePlugin.ts    — DiceRenderPlugin (SceneRenderPlugin)
packages/client/src/games/dice/
  diceHud.ts       — scorekaart/pot-overlay
  diceController.ts— mens-invoer (chooseMove)
```

## Gefaseerd bouwplan

| # | Stap | Effort (grof) | Reden |
|---|---|---|---|
| 1 | **Phase D0** — dobbel-infra (Die-model, DiceRenderer, DiceRenderPlugin, HUD-/invoer-seam) | 4-6 d | Eenmalig fundament; alle dobbelspellen erven dit |
| 2 | **Yahtzee** (archetype A) | 3-5 d | Bekendst, geen kern-impact, bewijst de dobbel-assembly-line |
| 3 | **Tienduizend** (archetype B) | 3-5 d | NL-herkenbaar; push-your-luck op dezelfde render |
| 4 | **Mexen** (archetype D) | 5-7 d | Dwingt `personalize()`-verbouwing + verborgen worp + challenge af |
| 5 | (optioneel) **Qwixx** (archetype E) | 6-9 d | Simultane fase; koppelen aan de Ezelen-tick-/verzamel-infra |

(Schattingen zijn indicatief en exclusief volledige regel-/varianten-research per spel — dat
volgt als aparte stap, vergelijkbaar met de per-spel-secties in `MULTIGAME_PLAN.md`.)

## Grootste risico's / aandachtspunten

- **PublicGameView blijft kaart-getint in zijn verplichte velden** (`hand: Card[]`,
  `legalCards: Card[]`). Dobbelspellen laten die leeg (`[]`) en leven in `viewExtras` +
  `legalMoves`. Werkt, maar het is "lege kaart-velden meeslepen". Overweeg op termijn een
  generiekere view-kern (zoals het multi-game-plan al voorstelt) als er meerdere niet-kaart-
  families bij komen.
- **`viewExtras: unknown` is ongetypeerd.** Per dobbelspel een eigen `DiceViewExtras`-type
  definiëren en bij `getView`/HUD/AI consistent casten, anders lekt `any` door de client.
- **Verborgen worp (archetype D)** raakt dezelfde info-verberg-naad als de geheime trekstapel
  uit het multi-game-plan; bouw die filter één keer generiek, niet per spel.
- **Render-esthetiek**: rollende 3D-dobbelstenen vragen een geloofwaardige tween (stuiteren/
  tollen). De tween-engine kan het, maar het "echt" laten ogen is finetune-werk; een
  vereenvoudigde "fade-naar-eindwaarde" is een goedkope v1.
- **AI**: archetype A/B vragen een EV-/kansheuristiek (welke categorie, wanneer banken); geen
  zoekboom nodig. Archetype D (bluf) vraagt een bluf-/uitdaag-EV-model — los, maar licht.

## Open beslissingen (voor jou)

- **Welke dobbelspellen wil je écht?** Mijn aanname: start Yahtzee + Tienduizend (samen dekken
  ze archetype A+B en 90% van de gedeelde infra). Mexen/Bluffpoker en Qwixx zijn duurder
  (verborgen info resp. simultane fase).
- **Doen we dit ná de kaartspellen uit `MULTIGAME_PLAN.md`, of ertussendoor?** Phase D0 is
  onafhankelijk van de resterende kaartspellen; Yahtzee is een goede "quick win" zodra je
  bandbreedte hebt.
- **Hoe ver gaat de variantmatrix per dobbelspel?** (Yahtzee: joker-regels/forced-Yahtzee;
  Tienduizend: drempel, openingsregel 350/500, bust-regels.) Eén canonieke variant eerst,
  net als bij de kaartspellen.
- **Verborgen-worp-render**: een 3D-beker met "alleen jij ziet je stenen" is de leukste maar
  duurste optie voor Mexen; een 2D-privé-overlay is goedkoper. Bepaalt de scope van archetype D.
