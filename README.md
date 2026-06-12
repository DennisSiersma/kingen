# Kingen — 3D kaartspel

Een 3D-implementatie van het Nederlandse/Vlaamse slagenspel **Kingen** (ook "King" of "Koningen"), gebouwd met **Vite + TypeScript + Three.js** — zonder frameworks en zonder externe assets: alle kaartbeelden, tafels en omgevingstextures worden programmatisch gegenereerd (canvas/procedureel).

Kingen bestaat uit zes negatieve rondes (geen slagen, geen harten, geen heren/boeren, geen dames, de hartenheer, geen 7e en laatste slag) en vier positieve troefrondes. Strafpunten (−52) en troefpunten (+52) sommeren over de hele partij tot exact 0. Naast het standaardspel zijn varianten configureerbaar (dubbel/vrij kingen, 3 of 5 spelers, troefkeuzeregels, strikte afgooiverplichtingen, claimen, enz.).

## Starten

```bash
npm install
npm run dev        # ontwikkelserver (http://localhost:5173)
npm run check      # typecheck (tsc --noEmit)
npm run build      # productie-build
npm run preview    # build lokaal bekijken
```

## Taal (NL/EN)

De interface is tweetalig. Rechtsboven in het setup-scherm staat een taalschakelaar (NL / EN); tijdens het spel kun je de taal ook wisselen via het HUD-instellingenmenu (⚙). De keuze wordt onthouden in `localStorage` (`kingen.lang`, standaard Nederlands). Alle teksten staan in `src/ui/i18n.ts`; de spel-engine zelf is taalneutraal.

## Architectuur

```
src/
├── core/            Spel-onafhankelijke engine
│   ├── types.ts     Card, Suit, Rank, Seat, PlayerConfig, GameEvent,
│   │                PublicGameView, GameDefinition (generiek spelcontract)
│   ├── deck.ts      Deck bouwen, seeded schudden, delen, sorteren, slagwinnaar
│   ├── events.ts    Getypeerde EventBus (render/UI/net abonneren zich hierop)
│   ├── scoresheet.ts Per-ronde scores + totalen ("de schrijver")
│   ├── player.ts    PlayerController: HumanPlayer (UI) en AiPlayer (strategie)
│   └── turnManager.ts Spelloop: actor vragen → zet toepassen → events publiceren
├── games/kingen/    Kingen-regelimplementatie
│   ├── types.ts     KingenRoundKind, KingenVariantConfig, KingenState, KingenMove
│   ├── params.ts    Tafelparameters per spelersaantal (deck-stripping, telling)
│   ├── rules.ts     Legale kaarten/troeven/spelkeuzes (pure functies)
│   ├── scoring.ts   Rondescores (nulsom-invariant)
│   └── engine.ts    createKingenDefinition(): de GameDefinition van Kingen
├── ai/              Computerspelers (zien alleen de PublicGameView)
│   ├── types.ts     AiStrategy + moeilijkheidsgraden
│   └── strategies.ts random / heuristisch / slim (kaarttelling)
├── render/          Three.js
│   ├── types.ts     Environment, CardRenderer, CardAnimator, SceneManager
│   ├── cards.ts     High-res canvas-kaarttextures + MeshPhysicalMaterial
│   ├── environments.ts Bruin café, keukentafel, casino (procedureel)
│   ├── animations.ts Delen/spelen/slag innemen als Promise-animaties
│   └── scene.ts     Scene, camera, belichting, raycasting, render-loop
├── ui/              DOM-overlay (#ui), teksten via i18n (NL/EN)
│   ├── types.ts     SetupConfig, UiEvent, component-interfaces
│   ├── i18n.ts      Taallaag: t(), getLang/setLang, NL/EN-vertalingen
│   ├── setup.ts     Setup-scherm (spelers, variant, omgeving, taal)
│   ├── hud.ts       Ronde/troef/beurt/slagentellers
│   ├── scoreboard.ts Scorebord-overlay
│   └── notifications.ts Toasts, ronde-aankondigingen, keuzedialogen
├── net/             Transport-abstractie
│   └── transport.ts Transport-interface + LocalTransport (loopback)
└── main.ts          Entrypoint: lagen opbouwen en verbinden
```

### Kernprincipes

- **GameDefinition** (`src/core/types.ts`) is een generiek contract: state aanmaken, views afleiden, legale zetten, zetten toepassen. Kingen is de eerste implementatie; andere kaartspellen (klaverjassen, hartenjagen, barbu) implementeren hetzelfde interface zonder wijzigingen aan TurnManager, render, UI of net-laag.
- **PublicGameView**: spelers en AI's zien nooit de volledige state — alleen hun eigen hand plus openbare informatie. Daardoor kan exact dezelfde view later over een netwerk worden gestuurd.
- **Events**: elke zet levert serialiseerbare `GameEvent`s op. Render en UI zijn pure consumenten van de EventBus; de TurnManager wacht via een animatie-gate tot de visuals klaar zijn.
- **Determinisme**: schudden gebeurt met een seeded PRNG, zodat replays en server-gezag mogelijk zijn.

## Uitbreidpad: online multiplayer & chat

De net-laag is hierop voorbereid:

1. **Transport-interface** (`src/net/transport.ts`) definieert `connect/send/onMessage`, room-beheer (`createRoom/joinRoom/listRooms`) en chat (`sendChat/onChat`). Lokaal spelen gebruikt `LocalTransport` (in-memory loopback met dezelfde asynchrone semantiek als een echt netwerk).
2. **WebSocketTransport** (later): zelfde interface, berichten (`NetMessage`, JSON-serialiseerbaar) over een WebSocket naar een server die de `GameDefinition` als autoriteit draait. Clients sturen `moveRequest`-berichten; de server valideert via `getLegalMoves`, past toe via `applyMove` en broadcast de events — met per speler gefilterde `deal`-events zodat niemand andermans hand ziet.
3. **Gamerooms**: `RoomInfo` beschrijft tafels (spelers, stoelen, status); een lobby-UI kan direct op `listRooms`/`roomUpdate` bouwen.
4. **Chat**: `ChatMessage` is al onderdeel van het protocol; een chatpaneel hoeft alleen `sendChat`/`onChat` te gebruiken.

## Status

Dit is het projectskelet: alle contracten (types/interfaces) zijn definitief; implementaties dragen `// TODO(module-agent)`-markeringen en worden per module gebouwd. `npm run check` slaagt op het skelet.
