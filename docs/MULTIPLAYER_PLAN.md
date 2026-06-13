# Kingen — Plan voor online multiplayer

Status: **ontwerp** (nog niet geïmplementeerd). Dit document beschrijft de volledige
opzet voor online spelen: architectuur, repo-structuur, server, client, protocol,
Docker/VPS-deploy, teststrategie en een gefaseerde planning.

Gekozen uitgangspunten (afgesproken met de eigenaar):

- **Identiteit v1:** gastnaam + roomcode (geen wachtwoorden/database).
- **Scope v1:** lobby met meerdere rooms, wachtkamer, stoelen claimen, AI-fill, chat.
- **Draaien:** lokaal testen (zonder Docker) → productie als Docker-container op de eigen VPS.

---

## 1. Doel & niet-doel

**Doel (v1)**
- Meerdere mensen spelen via internet samen Kingen in afzonderlijke tafels (rooms).
- Lobby: tafel maken of joinen via code, spelers zien elkaar, host start de partij.
- Lege stoelen worden gevuld door (server-side) computerspelers.
- Tekstchat per tafel, tijdens wachten én tijdens het spel.
- Verborgen handen blijven verborgen (server is autoritatief; geen valsspelen).

**Bewust nog NIET in v1**
- Accounts/wachtwoorden, vriendenlijsten, persistente scorehistorie.
- Horizontaal schalen over meerdere serverprocessen (Redis pub/sub).
- Spectators, replays, ELO/matchmaking.
- Meerdere kaartspellen (architectuur houdt er wel rekening mee).

Deze komen terug in §12 (toekomst).

---

## 2. Architectuurprincipe: autoritatieve server, dunne clients

De codebase is hier al op ontworpen:

- `GameDefinition` (`src/core/types.ts`) is een puur, UI-loos, deterministisch
  contract: `createInitialState(players, config, seed)`, `applyMove`,
  `getView(state, seat)`, `getLegalMoves`, `currentActor`, `isFinished`.
- `TurnManager` (`src/core/turnManager.ts`) draait de partij via abstracte
  `PlayerController`s en publiceert `GameEvent`s op een bus.
- `Transport` (`src/net/transport.ts`) heeft al `moveRequest` (client→host,
  "host valideert"), `gameEvent`, rooms en chat.
- De `deal`-event documenteert al: *"hands wordt per speler gefilterd bij
  verzending over een transport"*.

**Het model:**

```
   Client A (browser)                    Server (Node)                  Client B (browser)
   ┌───────────────┐   moveRequest   ┌──────────────────────┐   moveRequest   ┌───────────────┐
   │ render + UI   │ ──────────────▶ │  RoomManager         │ ◀────────────── │ render + UI   │
   │ WebSocket-    │                 │   └ GameHost (room)   │                 │ WebSocket-    │
   │ Transport     │ ◀────────────── │      └ TurnManager    │ ──────────────▶ │ Transport     │
   └───────────────┘  gameEvent(*)   │         └ Definition  │  gameEvent(*)   └───────────────┘
        (eigen PublicGameView)       │         └ Controllers │     (eigen PublicGameView)
                                     └──────────────────────┘
                                       draait de ENIGE echte
                                       (geheime) spelstate
```

- De **server** bezit de enige echte `TState` per room en draait er een
  `TurnManager` op.
- Menselijke stoelen krijgen een **`RemotePlayerController`**: zijn
  `chooseCard/chooseTrump/chooseRoundKind` blokkeren tot de bijbehorende client
  een `moveRequest` stuurt (gevalideerd tegen `getLegalMoves`).
- AI-stoelen krijgen de bestaande **`AiPlayer`** — die draait server-side, zodat
  lege stoelen altijd spelen, ongeacht wie verbonden is.
- Na elke zet **personaliseert** de server de resulterende events per stoel
  (vooral `deal`: alleen de eigen hand) en stuurt ze naar de juiste client.
- De **client** wordt dun: hij rendert events en stuurt zetten. De engine draait
  daar niet meer mee voor online partijen (lokaal vs online is alleen een andere
  `Transport` + controller-bron).

**Belangrijk inzicht:** lokaal spelen blijft bestaan en verandert functioneel
niet. Online is "dezelfde app met een andere `Transport` en server-side
spelloop". UI en render-laag blijven ongewijzigd.

---

## 3. Repo-herstructurering: npm workspaces

Om dezelfde engine op client én server te draaien zonder duplicatie, splitsen we
in een **monorepo met npm workspaces**:

```
kingen/
├─ package.json                # workspaces: ["packages/*"]
├─ packages/
│  ├─ shared/                  # @kingen/shared — engine, geen DOM
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ core/             # ← huidige src/core (types, deck, events, turnManager, player, scoresheet, speed)
│  │     ├─ games/kingen/     # ← huidige src/games/kingen
│  │     ├─ ai/               # ← huidige src/ai
│  │     └─ net/protocol.ts   # ← NetMessage/RoomInfo/ChatMessage-typen (los van transport-impl)
│  ├─ client/                  # @kingen/client — huidige Vite-app
│  │  ├─ package.json
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  └─ src/
│  │     ├─ render/           # ← huidige src/render
│  │     ├─ ui/               # ← huidige src/ui
│  │     ├─ net/
│  │     │  ├─ localTransport.ts   # ← huidige LocalTransport
│  │     │  └─ wsTransport.ts      # NIEUW: WebSocketTransport
│  │     ├─ styles.css
│  │     └─ main.ts
│  └─ server/                  # @kingen/server — Node + ws
│     ├─ package.json
│     └─ src/
│        ├─ index.ts          # http+ws bootstrap, static serving
│        ├─ wsHub.ts          # verbindingen, sessies, routering
│        ├─ roomManager.ts    # lobby: create/list/join/leave, roomcodes
│        ├─ gameHost.ts       # autoritatieve partij per room
│        ├─ remotePlayer.ts   # PlayerController die op moveRequests wacht
│        └─ eventFilter.ts    # personaliseer GameEvents per stoel
├─ Dockerfile                  # multi-stage (build client+server → runtime)
├─ docker-compose.yml          # app + Caddy (TLS) voor de VPS
└─ docs/MULTIPLAYER_PLAN.md
```

**Waarom workspaces:** `client` en `server` importeren beide `@kingen/shared`.
Eén bron van waarheid voor de spelregels; de server kan nooit "uit sync" raken
met de client.

**Migratie-aanpak (mechanisch, gedragsbehoudend):**
1. `git mv` van `src/core`, `src/games`, `src/ai` → `packages/shared/src/...`.
2. `git mv` van `src/render`, `src/ui`, `src/main.ts`, `src/styles.css`,
   `index.html`, `vite.config.ts` → `packages/client/...`.
3. `src/net/transport.ts` splitsen: protocol-typen → `shared/src/net/protocol.ts`;
   `LocalTransport` → `client/src/net/localTransport.ts`.
4. Imports ombouwen naar `@kingen/shared/...` waar client/server de engine raken;
   binnen `shared` blijven relatieve imports.
5. Root-`package.json` met `workspaces` + scripts (`dev:client`, `dev:server`,
   `build`, `check`). Per package een eigen `tsconfig` dat extend't van een
   `tsconfig.base.json`.
6. **Acceptatie:** `npm run build` en de bestaande browser-smoke-test slagen; de
   lokale (offline) app speelt identiek als nu.

> Alternatief (lichter, niet aanbevolen): geen workspaces, server importeert de
> engine via relatieve paden `../../client/src/...`. Sneller op te zetten maar
> rommelig en breekbaar bij verdere groei. We kiezen workspaces.

---

## 4. `@kingen/shared` (engine)

Inhoud = de huidige spel-onafhankelijke kern, ongewijzigd in gedrag:

- `core/`: `types.ts` (Card, GameEvent, PublicGameView, GameDefinition),
  `deck.ts`, `events.ts` (EventBus), `turnManager.ts`, `player.ts`
  (PlayerController, AiPlayer), `scoresheet.ts`, `speed.ts`.
- `games/kingen/`: engine, regels, scoring, params, types.
- `ai/`: strategieën.
- `net/protocol.ts`: `NetMessage`, `RoomInfo`, `ChatMessage`, `ConnectionState`
  (puur typen + helpers; geen transport-implementatie, geen DOM).

Eis: `@kingen/shared` mag **geen** DOM- of Three.js-imports bevatten (zodat het
in Node draait). De engine voldoet hier al aan.

---

## 5. Server-ontwerp (`@kingen/server`)

### 5.1 Stack
- **Node 22+ (LTS) + TypeScript.**
- **`ws`** voor WebSockets (lichtgewicht; we hebben onze eigen room-/chatlaag al).
- **Geen** Express nodig: Node's `http`-module serveert de statische client
  (`dist/`) en doet de WS-upgrade. (Optioneel later `sirv`/`fastify-static`.)
- Geen database in v1 (rooms in-memory).

### 5.2 Verbindings- en sessiemodel
- Eén WebSocket per browser-tab. Bij verbinden krijgt de client een
  `connectionId` (server-uniek) en stuurt een `hello { name }` (gastnaam).
- **Gastidentiteit:** een willekeurige `clientId` (UUID) die de client in
  `localStorage` bewaart en bij `hello` meestuurt. Dat geeft een lichtgewicht
  herkenning bij **reconnect** (zelfde stoel terugkrijgen) zonder accounts.
- Geen wachtwoorden. Een tafel kan optioneel een **roomcode** vereisen om te
  joinen (de "sleutel" om binnen te komen).

### 5.3 RoomManager (lobby)
- `createRoom(naam, gameId, maxPlayers, variantConfig, omgeving, zichtbaarheid)` →
  genereert een korte, deelbare **roomcode** (bijv. `KING-7F3Q`) en `RoomInfo`.
- **Open vs privé tafels (besloten):** een tafel is `open` (verschijnt in de
  lobbylijst, joinbaar met één klik) óf `prive` (alleen joinbaar via de roomcode,
  niet in de lijst). De code werkt in beide gevallen als directe deel-link.
- `listRooms()` → alleen **open**, niet-volle, niet-gestarte tafels (voor de
  lobbylijst).
- `joinRoom(code, player)` → wijst de laagste vrije stoel toe, broadcast
  `roomUpdate`. Werkt voor open én privé tafels.
- **Limiet (besloten):** max **4** tafels tegelijk (`MAX_ROOMS=4`); bij vol een
  nette `error`-melding "maximaal aantal tafels bereikt".
- `leaveRoom` / disconnect → stoel markeren als "niet verbonden"; als alle mensen
  weg zijn → room na een time-out opruimen.
- **Stoelen & AI-fill:** in de wachtkamer claimen mensen stoelen; resterende
  stoelen worden door de host op AI gezet (met niveau). Bij start instantieert de
  host `AiPlayer` voor die stoelen.
- **Host-rol:** de maker van de tafel is host (kan variant/omgeving/AI instellen
  en starten). Vertrekt de host, dan gaat de rol naar de volgende mens.

### 5.4 GameHost (autoritatieve partij per room)
- Bouwt `controllers[]`: per stoel een `AiPlayer` (AI) of `RemotePlayerController`
  (mens).
- Draait een `TurnManager` met `definition = createKingenDefinition()`,
  `config = variant`, een **server-gegenereerde `seed`** (deterministisch delen),
  en een `afterEvent`-gate die niet op animaties wacht maar wel de juiste
  per-stoel events verstuurt.
- **`RemotePlayerController`**: implementeert `PlayerController`. `chooseCard(view)`
  stuurt de client een "jij bent aan zet"-signaal (impliciet via de events +
  `turnStart`) en retourneert een `Promise` die resolvet zodra een geldige
  `moveRequest` van de juiste `connectionId`/stoel binnenkomt. Validatie tegen
  `getLegalMoves`; ongeldige of te late zetten worden geweigerd (en bij time-out
  speelt de host een veilige legale zet of zet de stoel tijdelijk op AI — zie
  §5.6).
- Bij partij-einde (`gameEnd`): scores blijven in de room, host kan "opnieuw"
  starten.

### 5.5 Per-stoel event-filtering (kernpunt verborgen info)
De `TurnManager` publiceert events op een bus. De host abonneert zich en stuurt
**per verbonden client een gepersonaliseerde stroom**:

- `deal`: vervang `hands` door **alleen** `{ [eigenStoel]: hand }`; `handSizes`
  blijft volledig (aantallen zijn openbaar).
- Alle overige events (`playCard`, `trickWon`, `roundStart`, `trumpChosen`,
  `roundEnd`, `scoreUpdate`, `gameEnd`, …) zijn openbaar en gaan ongefilterd.
- `illegalMove` blijft lokaal (gaat niet de lijn over, behalve als gerichte
  fout-feedback naar de speler die het betrof).
- Naast de event-stroom kan de host op aanvraag (join/reconnect) een **volledige
  `PublicGameView`-snapshot** per stoel sturen via `definition.getView(state,
  seat)`, zodat een (her)verbindende client direct de juiste toestand toont.

`eventFilter.ts` bevat deze personalisatie als pure functie
`personalize(event, seat) → GameEvent`.

### 5.6 Reconnect & robuustheid
- **Reconnect:** zelfde `clientId` binnen de time-out → herneem de stoel, stuur
  een verse `PublicGameView`-snapshot + lopende chathistorie.
- **Disconnect tijdens je beurt:** korte grace-periode; daarna speelt de host een
  veilige legale zet (of zet de stoel tijdelijk op AI) zodat de tafel niet
  vastloopt. Komt de speler terug, dan neemt hij de stoel weer over.
- **Time-outs & rate limiting:** max berichtfrequentie per verbinding; zet-time-out
  per beurt (configureerbaar). Alles server-side afgedwongen.
- **Input-validatie:** elk binnenkomend bericht wordt streng geparsed
  (discriminated union + schema-check) vóór verwerking.

### 5.7 Protocol-uitbreidingen
`NetMessage` (in `shared/net/protocol.ts`) breidt licht uit t.o.v. nu:

- Client→server: `hello { clientId, name }`, `createRoom {...}`, `listRooms`,
  `joinRoom { code, name }`, `leaveRoom`, `setSeatKind { seat, kind, aiLevel }`
  (host), `setRoomConfig { variant, omgeving }` (host), `startGame` (host),
  `moveRequest { roomId, seat, move }`, `chat { roomId, tekst }`,
  `requestSnapshot { roomId }`.
- Server→client: `hello-ok { connectionId }`, `roomList { rooms }`,
  `roomUpdate { room }`, `joinedRoom { room, yourSeat, code }`, `leftRoom`,
  `gameEvent { roomId, event }` (gepersonaliseerd), `snapshot { roomId, view }`,
  `chat { message }`, `error { code, melding }`.

Het bestaande `Transport`-interface dekt het grootste deel al; we voegen
`setSeatKind/setRoomConfig/startGame/requestSnapshot` toe en houden alles
JSON-serialiseerbaar.

---

## 6. Client-wijzigingen (`@kingen/client`)

### 6.1 `WebSocketTransport implements Transport`
- Eén nieuwe implementatie naast `LocalTransport`. Opent `wss://host/ws`, mapt de
  `Transport`-methodes op `NetMessage`-verkeer, beheert reconnect/backoff en
  `ConnectionState`.
- De rest van de app praat ongewijzigd met `Transport`; offline = `LocalTransport`,
  online = `WebSocketTransport`.

### 6.2 Nieuwe schermen (lobby + wachtkamer)
- **Startkeuze:** "Lokaal spelen" (huidige flow) of "Online spelen".
- **Lobby (online):** gastnaam invullen → lijst open tafels + "Nieuwe tafel".
  Nieuwe tafel = variant/omgeving/max spelers/naam kiezen → roomcode + deelbare
  link.
- **Wachtkamer:** stoelenoverzicht (wie zit waar, verbonden-status), host stelt
  lege stoelen op AI in en kan variant/omgeving wijzigen, "Start" als host.
  Chatpaneel actief.
- Deze schermen hergebruiken de stijl van het bestaande setup-scherm (i18n NL/EN).

### 6.3 Online spelloop
- Voor online partijen draait de client **geen** `TurnManager`. In plaats daarvan:
  een dunne `OnlineGameController` die binnenkomende `gameEvent`s naar dezelfde
  bus/animatiegate voert die de render/HUD nu al gebruiken, en die bij
  "jij aan zet" de bestaande kaart-klik/keuze-UI toont en het resultaat als
  `moveRequest` verstuurt.
- De bestaande `LokaleMens`-interactie (klikbare legale kaarten, troef/spelkeuze)
  wordt hergebruikt; alleen de "uitkomst" gaat nu naar het transport i.p.v. een
  lokale `Promise`.

### 6.4 Chat activeren
- Het al gereserveerde (verborgen) chat-tabblad in het zijpaneel wordt live:
  invoer → `sendChat`; `onChat` → berichtenlijst (met afzendernaam, eigen vs
  anderen, systeemberichten zoals "X heeft de tafel verlaten").

### 6.5 Verbindingsstatus & fouten
- Zichtbare status (verbonden/herverbinden/los), nette foutmeldingen
  (`error`-codes → i18n-teksten), en een "opnieuw verbinden"-pad.

---

## 7. Beveiliging & anti-cheat

- **Server autoritatief:** clients sturen alleen intenties; de server beslist.
- **Per-stoel views:** een client krijgt nooit andermans hand (zie §5.5).
- **Zetvalidatie:** elke `moveRequest` wordt getoetst aan `getLegalMoves` voor de
  juiste stoel + dat het werkelijk jouw beurt is; anders geweigerd.
- **Identiteitsbinding:** een `moveRequest` voor stoel N wordt alleen geaccepteerd
  van de `connectionId` die stoel N bezit.
- **Rate limiting & payload-limieten** per verbinding; strikte JSON-validatie.
- **Geen geheimen in de client-bundle.** TLS (wss) via de reverse proxy.
- Chat: lengte-limiet, basis-sanitization (tekst wordt als tekst gerenderd, geen
  HTML-injectie).

---

## 8. Docker & VPS-deploy

### 8.1 Multi-stage image (één artefact)
```dockerfile
# Stage 1 — build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY . .
RUN npm run build            # bouwt client (vite → dist) en compileert server

# Stage 2 — runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/server/dist ./server
COPY --from=build /app/packages/client/dist ./public
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "server/index.js"]
```
- De server serveert `./public` (statische client) **en** de `/ws`-WebSocket op
  dezelfde poort (8080). Eén container, geen CORS-gedoe.

### 8.2 docker-compose met Caddy (automatische HTTPS)
```yaml
services:
  kingen:
    build: .
    restart: unless-stopped
    environment:
      - PORT=8080
      - MAX_ROOMS=4
      - MOVE_TIMEOUT_MS=60000
      - RECONNECT_GRACE_MS=120000
    expose: ["8080"]
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
volumes:
  caddy_data:
```
`Caddyfile`:
```
siersma.farcon.cloud {
    reverse_proxy kingen:8080      # TLS + WebSocket-upgrade automatisch
}
```

**Domein & Cloudflare** (`siersma.farcon.cloud`, subdomein onder `farcon.cloud`):
- DNS: een `A`/`AAAA`-record voor `siersma.farcon.cloud` → de VPS, via Cloudflare.
- **TLS-model:** Caddy doet op de origin een echt certificaat; zet Cloudflare's
  SSL-modus op **Full (strict)**. Alternatief: een **Cloudflare Origin
  Certificate** op Caddy en de Cloudflare-proxy ervoor. (Niet "Flexible" — dat
  breekt `wss` en is onveilig.)
- **WebSockets:** Cloudflare ondersteunt WebSockets out-of-the-box op de
  geproxyde (oranje wolk) record; geen extra config nodig.
- **Let's Encrypt achter de proxy:** als de Cloudflare-proxy aanstaat, gebruikt
  Caddy de **DNS-challenge** (Cloudflare API-token) i.p.v. de HTTP-challenge —
  in de `Caddyfile`/build meenemen. Of: tijdens eerste uitrol de proxy even op
  "DNS only" (grijze wolk) zetten, cert laten ophalen, dan proxy aan.
- **Toegangsbeperking later:** **Cloudflare Access** (Zero Trust) vóór de app
  plaatsen geeft een inlog-/allowlist-laag zonder appwijziging — handig zolang we
  nog geen eigen accounts hebben. Past naadloos op dit subdomein.
- Updaten = `docker compose build && docker compose up -d`.
- Past in een Proxmox-LXC/VM met Docker. (Aandachtspunt: WebSockets willen sticky
  verbindingen; bij later >1 instance komt Redis erbij — niet nu.)
- **Omgevingen (besloten):** de Proxmox-server is **dev** (lokaal/intern testen);
  **productie** draait online op `siersma.farcon.cloud`. Zelfde Docker-image, andere
  compose/env per omgeving.

### 8.3 Config via env
- `PORT` (8080), `PUBLIC_DIR`, `MAX_ROOMS` (**4**), `MOVE_TIMEOUT_MS` (**60000**;
  daarna AI-overname), `RECONNECT_GRACE_MS` (**120000**; stoel 2 min
  gereserveerd), `ROOM_IDLE_TTL_MS`. Defaults gericht op één VPS-instance.

---

## 9. Lokale dev-workflow (zonder Docker)

- `npm run dev:server` → `tsx watch packages/server/src/index.ts` (hot-reload).
- `npm run dev:client` → Vite-dev op 5173, met proxy van `/ws` naar de
  dev-server (`server.proxy` in `vite.config.ts`).
- Twee browser-tabs (of twee profielen) = twee spelers tegen elkaar + AI-fill.
- Engine-wijzigingen gelden meteen voor client én server (shared package).

---

## 10. Teststrategie

- **Engine (bestaat):** `engine.test-manual.ts` blijft de regel-/scoringtest in
  `shared`.
- **Server-integratie (nieuw):** een headless testscript met twee in-proces
  "fake clients" die een hele partij spelen via het echte protocol; assert dat
  niemand andermans hand ontvangt, zetten correct gevalideerd worden, en de
  eindstand klopt.
- **E2E (nieuw):** Playwright met twee browsercontexten die samen een online
  potje spelen (lobby → join → start → een paar slagen → chat).
- **Regressie:** de bestaande offline-smoke-test blijft draaien (lokaal spelen
  mag niet breken).

---

## 11. Gefaseerde planning (met acceptatiecriteria)

**Fase 0 — Workspaces-refactor (fundament)**
- Engine → `packages/shared`, client → `packages/client`, protocol gesplitst.
- ✔ Acceptatie: `npm run build` slaagt; offline app speelt identiek; smoke-test groen.

**Fase 1 — Verticale plak (één room, end-to-end)**
- Minimale server: `ws`-hub + één GameHost + `RemotePlayerController` + AI-fill +
  per-stoel `deal`-filtering. `WebSocketTransport` in de client. Eén hardgecodeerde
  room.
- ✔ Acceptatie: twee browsers spelen samen een volledig potje (+AI), niemand ziet
  andermans hand, eindstand klopt.

**Fase 2 — Lobby + meerdere rooms**
- `RoomManager` (create/list/join via code), wachtkamer-UI, stoelen claimen,
  host-instellingen (variant/omgeving/AI-niveau), `startGame`.
- ✔ Acceptatie: twee tafels tegelijk, mensen joinen via code, host start; lijst
  ververst live.

**Fase 3 — Chat + verbindingskwaliteit**
- Chat live (wachtkamer + in-game), verbindingsstatus, foutafhandeling, basis
  reconnect (snapshot bij terugkomst), zet-time-out/AI-overname.
- ✔ Acceptatie: chatten werkt; een tab verversen herstelt de juiste toestand; een
  weggevallen speler laat de tafel niet vastlopen.

**Fase 4 — Docker + VPS**
- Multi-stage `Dockerfile`, `docker-compose.yml` + `Caddyfile`, env-config,
  deploy-instructie.
- ✔ Acceptatie: `docker compose up` draait lokaal op één poort (client+ws); op de
  VPS bereikbaar via `https://…` met werkende `wss://`.

**Fase 5 — Polish & hardening**
- Rate limiting, payload-limieten, edge cases (host vertrekt, room leeg, partij
  opnieuw), i18n van alle nieuwe teksten, toegankelijkheid.
- ✔ Acceptatie: een test-sessie met 3–4 mensen verloopt soepel zonder handmatig
  ingrijpen.

Elke fase is afzonderlijk te bouwen, te verifiëren en (op jouw teken) te pushen.

---

## 12. Toekomst (na v1)

- **Accounts & persistentie:** echte login (e-mail/wachtwoord of OAuth), opgeslagen
  profielen, scorehistorie, vriendenlijsten → database (SQLite/Postgres).
- **Schalen:** meerdere serverinstances achter een load balancer met sticky
  sessions + Redis pub/sub voor room-state.
- **Spectators & replays.**
- **Meer kaartspellen:** dankzij `GameDefinition` is een tweede spel (klaverjassen,
  hartenjagen, barbu) toe te voegen zonder server/transport/UI-herbouw.
- **Mobiele layout & PWA.**

---

## 13. Vastgelegde beslissingen

1. **Domein:** `siersma.farcon.cloud` (subdomein onder het eigen `farcon.cloud`),
   via Cloudflare. TLS-model Full (strict) met Caddy op de origin; **Cloudflare
   Access** later als toegangslaag vóór eigen accounts er zijn. Zie §8.2.
2. **Open én privé tafels:** open tafels staan in de lobbylijst (joinbaar met één
   klik), privé tafels alleen via roomcode. Zie §5.3.
3. **Max 4 tafels** tegelijk (`MAX_ROOMS=4`). Zie §5.3/§8.3.
4. **Zet-time-out 60s**, daarna AI-overname tot de speler terug is. Zie §5.6/§8.3.
5. **Reconnect-venster 2 minuten** (stoel gereserveerd na disconnect). Zie
   §5.6/§8.3.

Geen openstaande vragen meer; het plan is besluitvaardig en klaar om gefaseerd
uit te voeren (§11).
