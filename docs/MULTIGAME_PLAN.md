# Kingen → Multi-game: uitbreidingsplan (8 kaartspellen)

> Gegenereerd uit grondig multi-agent onderzoek (25 agents, web-research × 8, regels adversarieel kruisgecheckt). Datum: 2026-06-13.

Doel: 8 nieuwe spellen op de bestaande Kingen-engine via een **pluggable framework**, met sterke AI per spel (mix: zoekgebaseerd voor diepe slagenspellen, heuristiek voor de rest).

## Vastgelegde keuzes (v1, 2026-06-13)

1. **Ezelen → latere aparte fase.** v1 = de 7 beurt-gebaseerde spellen; Ezelen (simultaan/real-time) komt apart na v1.
2. **AI heuristiek-eerst.** v1 levert sterke heuristische AI voor álle spellen; het gedeelde determinisatie/ISMCTS-skelet voor de diepe biedslagenspellen (Hartenjagen, Klaverjassen, Rikken) volgt als fast-follow-upgrade van 'moeilijk'.
3. **Volle variantmatrix — variant-bewuste engine, gefaseerd per spel.** De engine wordt meteen variant-bewust gebouwd (varianten als config-toggles), maar elk spel start met de **meest gangbare variant als default** zodat het snel speelbaar is; de extra varianten (Hartenjagen A+B, Rikken huiskamer+Stichting+troela+open-met-praatje, Klaverjas Rotterdams+Amsterdams+3 biedmodi, Pesten optionele huisregels, enz.) worden **direct daarna** aangezet. Compleetheid blijft het doel; alleen de volgorde binnen elk spel is default-eerst.
4. **Strikt incrementeel.** Kingen blijft op elk moment speelbaar in productie; de bestaande integratietest (`packages/server/src/integration.test-manual.ts`) is de vangrail bij elke Phase-0 breaking change — geen big-bang feature-branch.

**Herziene scope-effort:** Phase 0 (12-17 d) + 7 spellen met volle varianten ≈ 80-115 mensdagen (Ezelen later +9-13). De volle-variantkeuze drukt elk spel naar de bovenkant van zijn bandbreedte.

## Families

De 8 spellen vallen in 4 mechanische families; dit bepaalt het hergebruik:

| Familie | Spellen | Hergebruik |
|---|---|---|
| **Slagenspel** | Hartenjagen, Toepen, Rikken, Klaverjassen | Hoog — erft Kingen-slagsubstraat |
| **Afleg-trek** | Pesten, Jokeren | Nieuwe motor (koop/aflegstapel) |
| **Match-snelheid** | Ezelen | Aparte simultane/tick-loop |
| **Party-drank** | Kingsen | Triviale regel-AI, eigen render |

## Totale inschatting

Phase 0 (fundament, eenmalig, gedeeld): 12-17 mensdagen. Alle 8 spellen erna (na Phase 0): Hartenjagen 8-12, Klaverjassen 9-13, Rikken 14-20, Toepen 8-12, Pesten 9-13, Jokeren 11-16, Kingsen 5-8, Ezelen 9-13 = 73-107 mensdagen. TOTAAL voor framework + alle 8: ~85-124 mensdagen (grofweg 4-6 mensmaanden). Belangrijkste hefbomen om dit te verlagen: (a) één canonieke variant per spel i.p.v. de volle variantmatrix (-15 a 25 dagen), (b) heuristische i.p.v. ISMCTS-AI in v1 voor de biedslagenspellen (-6 a 10 dagen), (c) Ezelen uitstellen/schrappen (-9 a 13 dagen). Met die drie keuzes landt een complete v1 rond ~55-75 mensdagen.

## Phase 0 — Framework-fundament (eenmalig, gedeeld)

Verplicht vóór elk nieuw spel; bouwt de 'assembly line'. Interne volgorde: P0-1 → P0-2 → P0-3 → P0-4, dan P0-5/6/7.

### P0-1 Move-dispatch generaliseren  *(±2-3 dagen)*
introduceer een gediscrimineerde Move met `{type:string}` als basiscontract en vervang TurnManager.pickMove door één generiek pad. Voeg aan PlayerController één methode `chooseMove(view, legalMoves): Promise<TMove>` toe (chooseCard/chooseTrump/chooseRoundKind/chooseCardOrClaim worden adapters of vervallen). AiStrategy krijgt dezelfde `chooseMove(view, legalMoves)`. Kingen-strategieën in strategies.ts wrappen hun bestaande chooseCard/chooseTrump/chooseRoundKind achter een chooseMove-switch op move.type — geen gedragswijziging, alleen herbedrading.

**Waarom:** pickMove hardcodet card/trump/roundKind/claimHand; geen enkel nieuw spel (drawCard, passCards, bid, askAce, callToep, grabSpoon, chooseSuit) past in dat stramien. Dit is de spil waar alle 8 spellen op wachten.

**Raakt:** `packages/shared/src/core/turnManager.ts`, `packages/shared/src/core/player.ts`, `packages/shared/src/ai/types.ts`, `packages/shared/src/ai/strategies.ts`, `packages/server/src/remotePlayer.ts`

### P0-2 Protocol + client move-loop ontklemmen  *(±1.5-2 dagen)*
vervang requestMove.moveType:'card'|'trump'|'roundKind' en MoveRequestPayload door een generiek `{moveType:string; legalMoves: TMoveJSON[]; ui?: MoveUiHint}` (legalMoves is de geserialiseerde TMove-lijst zoals getLegalMoves teruggeeft). RemotePlayerController.deliver/Pending wordt type-agnostisch (resolve op de hele move i.p.v. card/suit/kind). online.ts handleRequest wordt een dispatch op moveType naar per-spel client-input-plugins i.p.v. de huidige if-keten.

**Waarom:** De client kan anders de biedfase/kleurkeuze/trek-zet niet bedienen en de server kan de zet niet routeren. moveType is nu een gesloten union in zowel protocol.ts, remotePlayer.ts als online.ts.

**Raakt:** `packages/shared/src/net/protocol.ts`, `packages/server/src/remotePlayer.ts`, `packages/server/src/gameHost.ts`, `packages/client/src/online.ts`

### P0-3 Game-registry + dependency-injection  *(±2-2.5 dagen)*
maak een `gameRegistry` (Map gameId -> {createDefinition(config), defaultConfig, minPlayers, maxPlayers, clientPlugin-id}). GameHost krijgt de GameDefinition geïnjecteerd i.p.v. createKingenDefinition() hardcoded. Room en RoomManager krijgen gameId + config via de registry (DEFAULT_VARIANT en gameId='kingen' verdwijnen als hardcode; createRoom krijgt een gameId-parameter — protocol.createRoom heeft al ruimte maar mist gameId-veld, toevoegen).

**Waarom:** Zonder registry kan geen tweede spel naast Kingen draaien; gameId='kingen' en KingenVariantConfig zitten vastgebrand in gameHost.ts, room.ts en roomManager.ts.

**Raakt:** `packages/shared/src/core/(nieuw)gameRegistry.ts`, `packages/server/src/gameHost.ts`, `packages/server/src/room.ts`, `packages/server/src/roomManager.ts`, `packages/shared/src/net/protocol.ts`

### P0-4 PublicGameView slag-velden optioneel maken + generieke legalMoves  *(±2-3 dagen)*
maak currentTrick/completedTricks/playedCards/trickCounts/round.trump/round.kind nullable of optioneel, en voeg een generiek `legalMoves: TMove[]` toe naast (uiteindelijk i.p.v.) legalCards. Sta een per-spel `viewExtras`-veld (unknown/generiek) toe zodat afleg-/match-/party-spellen hun eigen velden (drawPileCount, pendingDraw, melds, roles, letters, stake) kunnen meegeven zonder het kerncontract te vervuilen. GameEvent-union krijgt een rijker `custom`-kanaal (al aanwezig) dat per-spel events draagt; behoud de bestaande slag-events voor de slagenfamilie.

**Waarom:** De view is nu verplicht slag-getint; afleg-/match-/party-spellen crashen of moeten dummy-data leveren. legalCards alleen volstaat niet voor multi-card- (passCards) en niet-kaart-zetten (drawCard/bid).

**Raakt:** `packages/shared/src/core/types.ts`, `packages/shared/src/games/kingen/engine.ts`, `packages/client/src/render/scene.ts`, `packages/client/src/ui/hud.ts`

### P0-5 Seat verbreden naar number (2-13) + layout/registry-clamps  *(±1.5-2.5 dagen)*
vervang `Seat = 0|1|2|3|4` en ALL_SEATS door `type Seat = number` met helper `seats(n)`. Verwijder de min(5)/max(3)-clamp in RoomManager.create en maak hem registry-gedreven (min/maxPlayers per spel). seatAngle/handAnchor in animations.ts werken al generiek op seatCount — alleen smoke-testen bij 6-8. HUD-naamlabels en chips moeten >5 stoelen tonen.

**Waarom:** Pesten 2-8, Toepen 2-8, Kingsen 2-12, Ezelen 3-13 overschrijden de huidige 5. Het type + de clamp zijn de echte blokkers; de 3D-layout is al parametrisch.

**Raakt:** `packages/shared/src/core/types.ts`, `packages/server/src/roomManager.ts`, `packages/client/src/ui/hud.ts`, `packages/client/src/render/animations.ts`

### P0-6 Kaartmodel uitbreiden  *(±2-3 dagen)*
CardInstance + joker-soort. Voeg een uniek `instanceId` toe (voor 2-deck-duplicaten in Jokeren) en een joker-representatie (suit-loze kaart of Rank-uitbreiding) met CardId-formaat dat 'joker-1' aankan. cardFromId/cardId/createDeck/sortHand en de render-cache (op cardId in cardTextures.ts) + cardArt moeten jokers/instanceIds aankunnen. Doe dit additief: bestaande `${suit}-${rank}` blijft geldig.

**Waarom:** Pesten (jokers) en Jokeren (2 decks + jokers + instanceId) kunnen niet zonder. Raakt deck.ts, types.ts, render-cache en protocol breed — daarom Phase 0, niet per-spel.

**Raakt:** `packages/shared/src/core/types.ts`, `packages/shared/src/core/deck.ts`, `packages/client/src/render/cardTextures.ts`, `packages/client/src/render/cardArt/suits.ts`, `packages/client/src/render/cardArt/court.ts`

### P0-7 Per-spel trickWinner-comparator + client render-plugin-seam. (a) Maak trickWinner een functie die een per-spel rang/kracht-comparator accepteert (Kingen/Hartenjagen/Rikken = Ace-high; Toepen = 10>9>8>7>A>H>V>B; Klaverjas troefkracht J>9>A>10>H>V>8>7). (b) Maak de scene-event-switch (scene.ts verwerkEvent, nu hardcoded roundStart/deal/playCard/trickWon) een registry van per-spel event->animatie-handlers, zodat afleg-/match-/party-render naast de slag-render bestaat. Definieer de CardAnimator-plugin-interface (animateDraw/animateDiscard/animateReshuffle/animateLayMeld als optionele uitbreidingen).  *(±1.5-2 dagen)*

**Waarom:** trickWinner zit in deck.ts en is rank-hardcoded — Toepen/Klaverjassen winnen anders stil de verkeerde slag. De scene event-switch is het render-plugin-seam dat elke familie nodig heeft.

**Raakt:** `packages/shared/src/core/deck.ts`, `packages/client/src/render/scene.ts`, `packages/client/src/render/animations.ts`

## Kern-abstracties die we introduceren

- GameRegistry (gameId -> {createDefinition(config), defaultConfig, min/maxPlayers, clientPluginId}): vervangt elke createKingenDefinition()/gameId='kingen'-hardcode in gameHost/room/roomManager; het ene punt waar een nieuw spel zich aanmeldt.
- Generieke Move (gediscrimineerd op {type:string}) + uniforme dispatch: PlayerController.chooseMove(view, legalMoves) en AiStrategy.chooseMove(view, legalMoves) vervangen chooseCard/chooseTrump/chooseRoundKind/chooseCardOrClaim. TurnManager.pickMove wordt één regel (controller.chooseMove). Alle nieuwe zet-typen (drawCard, passCards, bid, askAce, callToep, chooseSuit, grabSpoon) reizen hier vanzelf doorheen.
- Generieke move-payload in protocol: requestMove {moveType:string, legalMoves:TMoveJSON[], ui?:MoveUiHint} + type-agnostische RemotePlayerController.deliver(move). De server hoeft de zet niet meer te begrijpen, alleen door te geven.
- PublicGameView-kern + viewExtras: verplichte velden worden de echte gemeenschappelijke deler (seat, seatCount, hand, handSizes, turn, totals, legalMoves, playerNames); slag-velden worden optioneel; per-spel state hangt in een generiek viewExtras-veld (drawPileCount, pendingDraw, melds, roles, stake, letters).
- GameModule client-plugin (per gameId): bundelt (1) event->animatie-map voor de scene, (2) CardAnimator-uitbreidingen (animateDraw/Discard/Reshuffle/LayMeld), (3) HUD-plugin (welke badges/tellers), (4) input/keuze-plugin (welke dialoog bij welk moveType). online.ts handleRequest en scene.verwerkEvent resolven hun gedrag via deze plugin i.p.v. een vaste if/switch.
- Per-spel trickWinner-comparator: trickWinner(plays, trump, rankCompare) zodat Toepen/Klaverjassen hun afwijkende kaartkracht injecteren i.p.v. de Ace-high default.
- CardInstance + joker-soort: additieve uitbreiding van Card met instanceId (2-deck) en joker; cardId/cardFromId/sortHand/render-cache joker-bewust.
- Seat als number (met seats(n)-helper) + registry-gedreven min/maxPlayers, i.p.v. het vaste 0..4-type en de 3-5-clamp.

**Per-familie gedeelde infra:** SLAGENSPEL (Hartenjagen, Toepen, Rikken, Klaverjassen) — meeste hergebruik, deelt het Kingen-slag-substraat. Gedeeld bovenop Phase 0: (1) de bestaande slag-render/animaties (animateDeal/Play/CollectTrick) en trickWinner ongewijzigd; (2) een gedeelde 'biedfase'-infra: legalBids/legalMoves in de view + een herbruikbare bied-HUD (oplopende knoppenrij + pas) die Rikken en Klaverjassen (en de toep-respons van Toepen) delen; (3) de AI-determinisatie-helpers in strategies.ts (unseenCards, someOpponentShownVoid, currentWinningCard, discardPriority) als gedeelde ISMCTS/Monte-Carlo-bouwstenen voor Hartenjagen/Rikken/Klaverjassen — één determinisatie+rollout-skelet dat de pure getLegalMoves/applyMove als simulator gebruikt; (4) team-aware scoring/view (teamTotals) gedeeld door Klaverjassen (vast) en optioneel Rikken (maat). Per-spel uniek: kaart-kracht-comparator (Toepen/Klaverjas), strafpunt-per-stoel (Hartenjagen), roem-detectie (Klaverjas), biedrangorde (Rikken). KERN-INFRA-TOEVOEGING voor deze familie: multi-actor/verzamel-fase (Hartenjagen gelijktijdig doorgeven) en twee-sporen-turn (Toepen slag + toep-respons) — currentActor moet meerdere/alternerende actoren aankunnen; bouw dit als generieke 'phase met per-stoel pending'-helper.\n\nAFLEG-TREK (Pesten, Jokeren) — nieuwe motor. Gedeeld: (1) nieuwe render koopstapel(gesloten+teller)+aflegstapel(open top) + animateDraw/animateDiscard/animateReshuffle (één keer bouwen, beide spellen gebruiken het); (2) deterministische reshuffle met een aparte RNG-stream (seedbaar, host-only) — gedeelde helper want beide herschudden de aflegstapel midden in de ronde; (3) personalize-uitbreiding: geheime trekstapel mag de getrokken kaart niet lekken (room.personalize moet per-kaart/per-bron filteren, niet alleen 'deal'). Jokeren voegt daar bovenop meld-zones + multi-select-interactie toe (niet door Pesten gedeeld).\n\nMATCH/SNELHEID (Ezelen) — staat het verst van de engine. Vereist een SIMULTANE/TICK-LOOP-MODUS naast de beurt-gebaseerde TurnManager: host-gedreven tick-scheduler, server-autoritatieve timestamps, en een protocol-uitbreiding (tickStart-broadcast + ongevraagde zetten met server-side dedup per tik). Dit is eigen infra die alleen Ezelen gebruikt; bouw het als een tweede loop-implementatie achter hetzelfde GameDefinition-contract (currentActor=null, host stuurt tikken). Real-time HUD + doorgeef-animatie zijn Ezelen-specifiek.\n\nPARTY/DRANK (Kingsen) — triviale regel-AI, maar eigen render (kaartcirkel + centrale beker i.p.v. handen/slagtafel). Gedeeld met niemand behalve de generieke keuzedialoog-infra (kies-speler, vrije-tekst-regel) die ook elders bruikbaar is. AI is een 1-regel regel-AI via chooseMove (uniform-random geldige medespeler).

## Aanbevolen bouwvolgorde

| # | Stap | Effort (dagen) | Reden |
|---|---|---|---|
| 1 | Phase 0 (alle 7 kerntaken) | 12-17 | Harde voorwaarde voor élk nieuw spel; bouwt de assembly line. Doe het in deze interne volgorde: P0-1 (move-dispatch) -> P0-2 (protocol) -> P0-3 (registry) -> P0-4 (view) eerst, want die ontklemmen de kern; daarna P0-5 (Seat), P0-7 (comparator+render-seam); P0-6 (kaartmodel/jokers) kan parallel want additief. Valideer continu met de bestaande Kingen-integratietest als regressievangnet — Kingen mag geen gedrag verliezen. |
| 2 | Hartenjagen | 8-12 | Hoogste hergebruik van de slagenfamilie en het beste leereffect: het is troefloos (trickWinner(...,null) bestaat al), kopieert de Kingen engine/rules/scoring-structuur 1-op-1, en dwingt meteen de twee gedeelde slagen-infra-stukken af die Toepen/Rikken later nodig hebben: de generieke legalMoves-view en de multi-actor/verzamel-fase (gelijktijdig doorgeven). Bovendien is het de eerste klant van het determinisatie/ISMCTS-AI-skelet dat Rikken en Klaverjassen erven. Laag UI-risico (geen nieuwe render-familie). Bewijst de assembly line vóór je in dure spellen investeert. |
| 3 | Klaverjassen | 9-13 | Tweede slagenspel: hergebruikt Hartenjagens determinisatie-AI en de slag-render volledig, en levert de twee resterende gedeelde slagen-bouwstenen op die Rikken nodig heeft: de per-spel trickWinner-comparator (troefkracht) en de team-aware view/scoring + de bied-HUD. Doe Klaverjassen vóór Rikken omdat de biedfase eenvoudiger is (kies troef of pas) dan Rikkens canonieke biedrangorde, dus je rijpt de bied-infra op de makkelijkere variant. |
| 4 | Rikken | 14-20 | Duurste slagenspel; pas doen als determinisatie-AI, trickWinner-comparator, team/partner-view en bied-HUD al rijp zijn uit Hartenjagen+Klaverjassen. Dan resteert vooral het Rikken-unieke: biedrangorde, verborgen-maat-mechaniek en de tabelgedreven puntentelling. Risico maximaal gespreid: je bouwt het zwaarste spel met de meest beproefde gedeelde infra. |
| 5 | Toepen | 8-12 | Slagenfamilie maar met afwijkende kaartkracht (eigen comparator, al beschikbaar) plus de twee-sporen-turn (slag + toep-respons) en eliminatie-over-rondes. Na de drie biedslagenspellen is de multi-actor/alternerende-turn-infra volwassen; Toepen voegt vooral de gok/bluf-EV-AI en per-kaart-zichtbaarheid (vuile was open op tafel) toe. Heuristische AI (geen ISMCTS) dus relatief goedkoop. |
| 6 | Pesten | 9-13 | Eerste afleg-trek-spel: introduceert de nieuwe motor (koop-/aflegstapel-render, animateDraw/Discard/Reshuffle, deterministische reshuffle, geheime-trekstapel-personalize) die Jokeren erft. Sterke heuristiek-AI (goedkoop). Gebruikt P0-6 jokers. Doen vóór Jokeren omdat het de afleg-render-infra opbouwt op de simpelere regels. |
| 7 | Jokeren | 11-16 | Hergebruikt Pestens afleg-render + reshuffle + geheime-stapel-infra, en is de enige echte klant van P0-6 instanceId/2-deck. Voegt meld-zones + multi-select-interactie + combinatie-validatie toe. Zwaarste afleg-spel; pas doen als de afleg-motor uit Pesten staat. |
| 8 | Kingsen | 5-8 | Triviale regel-AI en geen slag/afleg-overlap, maar eigen ring/beker-render. Vroeg inplanbaar als 'quick win' zodra Phase 0 staat (het hangt alleen aan registry + Seat-tot-12 + keuzedialogen), maar geplaatst na de hergebruik-zware spellen omdat het qua infra met niemand deelt en dus geen latere spellen versnelt. Goede kandidaat om parallel/tussendoor te doen. |
| 9 | Ezelen | 9-13 | Laatst: het breekt het beurt-gebaseerde model en vereist een aparte simultane/tick-loop + server-autoritatieve klok + protocol-uitbreiding. Geen enkel ander spel deelt die infra, dus geen reden het vroeg te doen; hoogste architectuur- en fairness-risico. Pas aanpakken als de rest stabiel draait, zodat de tick-loop een geïsoleerde, optionele uitbreiding blijft. |

## Grootste risico's

- Phase-0-scope-creep & Kingen-regressie: P0-1/P0-2/P0-4 zijn breaking changes in turnManager.ts, player.ts, ai/types.ts, strategies.ts, protocol.ts, remotePlayer.ts en online.ts tegelijk. Als de bestaande Kingen-integratietest niet als regressievangnet meeloopt bij elke Phase-0-stap, breekt het draaiende spel stilletjes. Mitigatie: Phase 0 strikt additief/achterwaarts-compatibel houden waar mogelijk, Kingen migreren als eerste 'klant' van elke nieuwe abstractie.
- Het simultane/real-time model van Ezelen past fundamenteel niet op currentActor/TurnManager. Onderschatten leidt tot een hack in de kern. Mitigatie: behandel het als een tweede, geïsoleerde loop-modus achter hetzelfde GameDefinition-contract en plan het als laatste; overweeg de tempo-/waarschuwingsregel optioneel/uitschakelbaar in v1.
- Multi-actor & twee-sporen-turn (Hartenjagen gelijktijdig doorgeven, Toepen slag+toep-respons): de huidige enkelvoudige currentActor-aanname zit diep in TurnManager én in de request-response-protocollus (één zet per verzoek). Zonder een generieke 'verzamel-fase met per-stoel pending' lekt dit per-spel-logica in de kern.
- Informatieverberging breekt bij geheime trekstapel (Pesten/Jokeren) en verborgen maat (Rikken) en open-hand (Toepen vuile was): room.personalize filtert nu alleen het deal-event en alleen per-stoel. Een fout hier is een valsspeel-/info-lek richting clients én AI. Vereist per-kaart/per-bron-zichtbaarheid en deterministische-maar-verborgen reshuffle.
- AI-rekentijd host-side: ISMCTS/determinisatie voor Hartenjagen/Rikken/Klaverjassen bij meerdere gelijktijdige tafels kan de serverloop blokkeren. Mitigatie: harde playout-budgetten per difficulty, en de zware spellen leunen op één gedeeld, getuned determinisatie-skelet i.p.v. drie aparte implementaties.
- Test-oppervlak van regel-randgevallen (gestapelde 2/joker-keten, niet-eindigen-op-pestkaart, over-/ondertroefplicht + Amsterdams, biedrangorde, shoot-the-moon, nat+roem-verrekening, meld-combinatievalidatie) is groot en foutgevoelig; zonder per-spel unit-tests bovenop de integratietest is correctheid niet houdbaar.

## Open beslissingen (voor jou)

- Welke 8 spellen wil je écht uitbouwen, en in welke volgorde t.o.v. mijn aanbeveling? Concreet: wil je Ezelen (simultaan/real-time, hoogste risico, deelt geen infra) überhaupt in scope, of pas in een latere fase — dat scheelt ~9-13 dagen en de duurste architectuurbeslissing.
- Hoe ver moet de variantmatrix per spel? (Hartenjagen profiel A én B; Rikken huiskamer+Stichting+troela+open-met-praatje; Klaverjas Rotterdams+Amsterdams+3 biedmodi.) Elke optionele variant kost dagen aan regel- en testwerk; een v1 met één canonieke variant per spel halveert de schattingen.
- AI-ambitie: accepteer je heuristische AI voor de biedslagenspellen in v1 (sneller, goed genoeg) en pas later ISMCTS, of moet 'moeilijk' meteen zoekgebaseerd zijn? Dit bepaalt of het gedeelde determinisatie-skelet een Phase-1- of Phase-2-investering is.
- Kaartmodel: gaan we direct naar CardInstance+joker voor álle spellen (uniform, maar raakt nu al render-cache/protocol/cardArt), of houden we het additief en alleen aan voor Pesten/Jokeren? Uniform is properder maar duurder vooraf.
- Maximaal spelersaantal dat de 3D-tafel-render esthetisch moet aankunnen: Kingsen wil 12, Ezelen 13. Tot welk aantal moet het er goed uitzien (vs. functioneel werken)? Boven ~8 stoelen wordt de kaartcirkel/handwaaier krap.
- Alcohol/leeftijd voor Kingsen: verplichte alcoholvrije modus + leeftijdsdisclaimer akkoord, en moeten de sociale mini-spellen (categorie, tafel-van-7, wijzen) alleen als instructie+'wie dronk?'-knop, of digitaal afgedwongen? Dit bakent scope en publicatierisico af.
- Mag Phase 0 Kingen tijdelijk instabiel maken (feature-branch met big-bang-migratie) of moet Kingen op elk moment speelbaar blijven (strikt incrementeel, iets duurder)?

---

# Per spel: canonieke regels + ontwerp

## Pesten

- **Engelse naam:** Crazy Eights — bevestigd via pagat.com en nl.wikipedia.org. Pesten is de Nederlandse variant binnen de Crazy Eights-/Mau-Mau-familie (Switch/Black Jack in het VK, Mau-Mau in Duitsland, Uno als commerciële variant). Belangrijk vertaalverschil bevestigd: in internationale Crazy Eights is de 8 de wildcard, terwijl in Pesten de 8 'beurt overslaan' is en de boer de kleurwisselaar; Pesten gebruikt bovendien jokers als pakkaart, wat standaard Crazy Eights niet doet.
- **Familie:** afleg-trek · **Complexiteit:** 3/5 · **Effort (na Phase 0):** 9-13 mensdagen na Phase 0. Uitsplitsing: regel-engine + state + legalMoves + applyMove (effecten, stapelen, herschud, finish-bescherming) 3-4d; unit-tests randgevallen 1-2d; heuristische AI via chooseMove 1-1.5d; client-render koop-/aflegstapel + animateDraw/animateDiscard/reshuffle 2-3d; HUD/kleurdialoog/effect-toasts + i18n NL/EN 1-1.5d; server-wiring via registry + integration.test-manual + 2-8-spelers doortrekken 1d. NB: de Seat-naar-8 en joker-uitbreiding kunnen, indien als generieke kerntaken in Phase 0 meegenomen, ~2d hiervan naar Phase 0 verschuiven. · **Vertrouwen regels:** hoog

**Gekozen variant:** CANONIEKE NEDERLANDSE STANDAARDVARIANT van Pesten, gekozen omdat dit de meest gangbare en best speelbare set is die in 6 van 7 geraadpleegde bronnen terugkomt. Kernkeuzes: (1) 7 = 'zeven blijft kleven' (extra beurt) — dominante conventie, niet 'kies de kleur'. (2) 8 = 'acht wacht' (overslaan). (3) Boer = altijd legbaar + kleur kiezen (de wildcard van Pesten). (4) Aas = richting omkeren. (5) Joker = 5 pakken (zwaarste pestkaart). (6) Optellen INGESCHAKELD: 2 en joker onderling stapelbaar (2-op-joker en joker-op-2 mag), straf loopt op tot iemand niet kan bijleggen — dit is de leukste en breed gespeelde variant en maakt het spel spannender. (7) Niet eindigen met een pestkaart (2/7/8/aas/boer/joker) met 1 strafkaart — voorkomt anticlimactische 'instant wins' en is de dominante huisregel. (8) 7 handkaarten, 2-8 spelers. Zeldzame regionale regels (5='pak een wijf', 10='wasmachien', heer keert om) zijn bewust UITGESCHAKELD voor eenduidigheid; ze zijn gedocumenteerd als optionele toggles maar staan standaard uit. Deze set is direct programmeerbaar: elke kaart heeft een ondubbelzinnige effectdefinitie en alle randgevallen (startkaart-effect, lege trekstapel, 2-speler-aas, optel-keten, laatste-kaart) zijn expliciet uitgewerkt.

### Canonieke regels
CANONIEKE REGELSET "PESTEN" (NL) — direct implementeerbaar

== OPSTELLING ==
- Pak: 1 standaard pak van 54 kaarten (52 + 2 jokers). Bij 6+ spelers optioneel 2 pakken samengevoegd (108 kaarten).
- Spelers: 2 tot 8 (ideaal 3-5).
- Delen: elke speler krijgt 7 kaarten. (Implementatiekeuze: vast op 7; dit is de Nederlandse standaard volgens 5 van 6 NL-bronnen. Bij 7+ spelers met 1 pak desnoods 5 kaarten om voldoende trekstapel te houden.)
- Trekstapel: resterende kaarten gesloten op een stapel (de "pot"/koopstapel).
- Aflegstapel: bovenste kaart van de trekstapel wordt omgedraaid en vormt de open startkaart.
  RANDGEVAL startkaart: als de omgedraaide startkaart een effectkaart is (2, 7, 8, aas, boer, joker), draai opnieuw of negeer het effect en behandel hem puur als kleur+waarde voor de eerste speler. Implementatie-aanbeveling: bij start net zo lang opnieuw omdraaien tot er een gewone kaart (3,4,5,6,9,10,vrouw,heer) ligt; de gepasseerde effectkaarten gaan onderin de trekstapel.
- Beginspeler: speler links van de deler. Standaard speelrichting: met de klok mee.

== DOEL ==
Als eerste al je handkaarten kwijtraken. Wie als eerste 0 kaarten heeft, wint de ronde.

== BEURTVERLOOP ==
1. Op je beurt leg je 1 legale kaart open op de aflegstapel. Een kaart is legaal als hij:
   - dezelfde KLEUR/symbool (harten/ruiten/klaveren/schoppen) heeft als de bovenste aflegkaart, OF
   - dezelfde WAARDE/rang heeft als de bovenste aflegkaart, OF
   - een boer is (altijd legaal), OF
   - een joker is (altijd legaal).
   Let op: na een gespeelde boer geldt de DOOR DE BOER GEKOZEN kleur als de te volgen kleur (de waarde "boer" telt niet meer voor matching).
2. Kun je niet of wil je niet leggen: je koopt precies 1 kaart van de trekstapel.
   - CANONIEK: past de gekochte kaart, dan MAG je hem direct leggen; past hij niet (of je wilt niet), dan eindigt je beurt. Je koopt nooit meer dan 1 kaart per beurt (behalve verplicht pakken door 2/joker, zie hieronder).
3. Na een gewone kaart gaat de beurt naar de volgende speler in de huidige speelrichting.

== TREKSTAPEL OP ==
Is de trekstapel leeg en moet er gekocht worden: neem de aflegstapel BEHALVE de bovenste kaart, schud die, en leg hem gesloten neer als nieuwe trekstapel. De bovenste aflegkaart blijft liggen. Is ook dat op (geen kaarten meer om te schudden), dan kan de betreffende speler niet kopen en gaat de beurt over.

== EFFECTKAARTEN (exacte werking) ==
- 2 (TWEE) — pakkaart: de volgende speler moet 2 kaarten pakken EN slaat zijn beurt over, TENZIJ hij zelf een pakkaart legt (zie OPTELLEN).
- 7 (ZEVEN) — "zeven blijft kleven": je bent direct NOG EEN KEER aan de beurt. Je legt meteen weer een kaart (die moet matchen op de 7 qua kleur/waarde, of opnieuw een effectkaart zijn). Meerdere zevens/extra beurten achter elkaar mag. De extra kaart die je legt mag opnieuw een effectkaart zijn (8, 2, boer, etc.) met volledige werking.
- 8 (ACHT) — "acht wacht": de volgende speler slaat zijn beurt over (geen kaarten pakken). Daarna is de speler na hem aan de beurt.
- BOER (JACK) — wildcard: mag altijd op elke kaart worden gelegd. De speler kiest de nieuwe te volgen kleur (harten/ruiten/klaveren/schoppen). Verder geen pak-/overslaaneffect.
- AAS — "aas draai": keert de speelrichting om (van met-de-klok-mee naar tegen-de-klok-in en vice versa).
- JOKER — zwaarste pakkaart: de volgende speler moet 5 kaarten pakken EN slaat zijn beurt over, TENZIJ hij zelf een pakkaart legt (zie OPTELLEN).

(NIET-canoniek/uitgeschakeld om verwarring te voorkomen: 5="pak een wijf", 10="laat kaarten zien/wasmachien", heer=richting omkeren. Dit zijn zeldzame regionale regels en zijn GEEN onderdeel van de canonieke set. 5, 10, vrouw en heer zijn gewone kaarten zonder effect.)

== OPTELLEN (pakkaart-stapeling) — CANONIEK INGESCHAKELD ==
- 2 en joker zijn beide "pakkaarten" en mogen op elkaar gestapeld worden om de straf door te schuiven.
- Wordt een 2 gespeeld (lopende straf +2), dan mag de volgende speler i.p.v. pakken zelf een 2 OF een joker leggen; de straf wordt opgeteld.
- Wordt een joker gespeeld (lopende straf +5), dan mag de volgende speler i.p.v. pakken zelf een joker OF een 2 leggen; de straf wordt opgeteld.
- Voorbeeldreeks: speler A legt 2 (straf=2) -> B legt 2 (straf=4) -> C legt joker (straf=9) -> D heeft geen pakkaart -> D pakt 9 kaarten en slaat zijn beurt over. Daarna gaat het normaal verder met de speler na D.
- De straf loopt op totdat een speler GEEN pakkaart (2 of joker) kan/wil bijleggen; die speler pakt het volledige opgetelde aantal en slaat zijn beurt over.
- Een speler die wél een pakkaart bijlegt, pakt zelf NIETS en geeft de (verhoogde) straf door.

== EINDIGEN / WINNEN ==
- Je wint zodra je je laatste kaart hebt afgelegd EN je nul kaarten overhoudt.
- RANDGEVAL — niet eindigen met een pestkaart (CANONIEK): je mag je LAATSTE kaart NIET laten zijn: 2, 7, 8, aas, boer of joker. Probeer je dat toch (je hebt alleen nog zo'n kaart en legt hem), dan is dat geen winst: je pakt 1 strafkaart van de trekstapel (bij geen trekstapel: 1 na herschudden) en het spel gaat door. (Praktisch: de engine moet bij 1 resterende effectkaart het "uitspelen" blokkeren of bestraffen.)
  Subgeval 7: omdat 7 een extra beurt geeft, kun je niet met een 7 "winnen" — je moet er sowieso nog een kaart na leggen; eindig je netto op een 7 dan geldt eveneens de strafregel.
- Een gewone kaart (3,4,5,6,9,10,vrouw,heer) als laatste kaart = geldige winst.

== LAATSTE KAART AANKONDIGEN ==
- Wanneer je nog 1 kaart in handen hebt na je beurt, moet je "laatste kaart" roepen/aangeven.
- Vergeet je dit en een andere speler betrapt je voordat jij weer aan de beurt bent: je pakt 1 strafkaart. (Implementatie in software: kan automatisch worden afgehandeld of als optionele knop; bij solo/AI-implementatie aan te raden dit automatisch te doen zodat het geen straf oplevert, of de regel uitschakelbaar maken.)

== 2 SPELERS — RANDGEVAL AAS/8 ==
- Bij 2 spelers: aas (richting omkeren) en 8 (beurt overslaan) hebben hetzelfde netto-effect: de tegenstander wordt overgeslagen en je bent zelf direct weer aan de beurt. Implementeer aas bij 2 spelers daarom als "speel nog een kaart / tegenstander slaat over".

== SAMENVATTING KAARTWAARDEN/EFFECTEN (implementatietabel) ==
- 2: volgende pakt 2 + overslaan (stapelbaar met 2/joker)
- 3,4,5,6,9,10: geen effect (gewone kaart)
- 7: speler nogmaals aan de beurt (extra kaart leggen)
- 8: volgende slaat beurt over
- 10: geen effect (canoniek)
- Boer (J): altijd legbaar, kies nieuwe kleur
- Vrouw (Q): geen effect
- Heer (K): geen effect (canoniek)
- Aas (A): richting omkeren (bij 2 spelers = overslaan)
- Joker: volgende pakt 5 + overslaan (stapelbaar met joker/2)

== OPTIONELE/UIT TE SCHAKELEN VARIANTEN (niet in canon, wel documenteren als toggle) ==
- Gekochte kaart MOET gespeeld worden als hij past (i.p.v. mag).
- Inbreken: identieke kaart buiten je beurt meteen meeleggen.
- Keerkaart op pakkaart om straf te ontwijken.
- Heer keert richting om; 5="pak een wijf"; 10="laten zien".
Deze blijven UIT in de standaardimplementatie om eenduidigheid te garanderen.

### Implementatie-ontwerp
- **State-model:** PestenState (geheim, host-only), naar model van KingenState maar zonder slag-structuur. Velden: config (PestenConfig), players, seed, phase ('dealing'|'playing'|'awaitingSuitChoice'|'roundFinished'|'gameFinished'). hands: Card[][] (index=Seat). drawPile: Card[] (gesloten koopstapel, top = laatste). discardPile: Card[] (open aflegstapel, top = laatste). currentSuit: Suit (de te volgen kleur; wijkt af van topkaart.suit ná een boer). pendingDraw: number (opgetelde pakkaart-straf van 2/joker-keten; 0 = geen). pendingSkip: boolean (volgende slaat over door 2/8/joker). direction: 1|-1 (aas keert om). turn: Seat|null. extraTurn: boolean (7 blijft kleven: zelfde speler nogmaals). lastCardSeats: Set<Seat> (wie 'laatste kaart' aan staat / nog niet betrapt). roundsWon: number[] (winsten per stoel over de match). totals: number[] (matchscore; bij Pesten meestal aantal gewonnen rondes of strafpunten van resterende handkaarten). winnerOrder: Seat[] (volgorde van uitkomen bij doorspelen om 2e/3e plek). Jokers vereisen uitbreiding van het kaartmodel: Rank kent nu 2..14, GEEN joker — joker moet als aparte kaart of als Rank-uitbreiding (bijv. rank 0/15 + suit-loos 'joker') worden toegevoegd; CardId-formaat `${suit}-${rank}` moet jokers aankunnen (bijv. 'joker-1','joker-2').
- **Move-types:** playCard, drawCard, passTurn, chooseSuit, callLastCard
- **Nieuwe events:** drawCard (seat, count, fromReshuffle?) — speler koopt N kaarten (1 vrijwillig, of pendingDraw door 2/joker), layCard (seat, card) of hergebruik playCard zonder trickIndex — kaart op aflegstapel, suitChosen (seat, suit) — kleurkeuze na boer, reshuffleDrawPile (newDrawCount) — aflegstapel (min top) opnieuw geschud tot koopstapel, penaltyDraw (seat, count, reason: 'stacked'|'lastCardForgotten'|'illegalFinish') — strafkaarten, effectApplied (subtype: 'skip'|'reverse'|'stick'|'pickup', seat, amount?) — voor toasts/HUD, turnDirectionChanged (direction) — aas, lastCardCalled (seat) — 'laatste kaart' aangekondigd, playerFinished (seat, place) — speler uit; ronde gaat door tot 1 over
- **PublicGameView-extensies:** drawPileCount: number (alleen aantal, kaarten gesloten), discardTop: Card (bovenste aflegkaart), currentSuit: Suit (afwijkend van discardTop.suit na boer), pendingDraw: number (lopende pak-straf voor de HUD), direction: 1|-1, handSizes blijft, maar moet >5 stoelen aankunnen, legalMoves i.p.v. enkel legalCards: ook 'drawCard'/'chooseSuit' moeten als opties terug (legalCards alleen volstaat niet — drawCard is een aparte zet), lastCardSeats / wie 'laatste kaart' aan heeft, PublicGameView slagvelden (currentTrick, completedTricks, trickCounts, completedTricks, round.trump) zijn niet van toepassing en moeten optioneel/null-baar worden
- **UI-behoeften:** Nieuwe 3D-render: koopstapel (gesloten, met teller) + aflegstapel (open, top zichtbaar) i.p.v. het slag-midden; CardAnimator uitbreiden met animateDraw (van koop- naar hand) en animateDiscard (van hand naar aflegstapel) en animateReshuffle, HUD-plugin: pendingDraw-badge ('pak 4!'), richting-indicator (klok/tegen-klok), currentSuit-badge na boer (vervangt de troefbadge-plek), 'laatste kaart'-knop/indicator, Kleurkeuzedialoog na boer (hergebruik patroon van chooseTrump-dialoog in notifications.ts; 4 kleurknoppen), Knop/zet 'kopen' (drawCard) wanneer spelen niet kan of niet gewenst is; en 'pak straf' bevestiging bij gestapelde 2/joker, Toasts/aankondigingen voor effecten (overslaan, omkeren, zeven-nogmaals, pakken) via bestaande notifications.ts, Tafel ondersteunt 2-8 spelers: seatAngle/layout en viewerSeat moeten >5 stoelen aankunnen (nu Seat=0..4)
- **AI-aanpak:** Sterke heuristiek (conform AI-beleid: Pesten is laag-strategisch, geen zoekboom nodig). Implementatie via generieke chooseMove(view, legalMoves). Heuristiek-features/prioriteiten: (1) Bij lopende pendingDraw: leg een pakkaart (2/joker) bij om de straf door te schuiven mits dat de eigen hand niet onnodig leegt op het verkeerde moment; anders pak de straf. (2) Als je met 2 kaarten in hand staat en een gewone + effectkaart hebt: speel zo dat je laatste kaart GEEN pestkaart wordt (vermijd illegale finish). (3) Bewaar boeren/jokers/effectkaarten als 'wildcards' tenzij ze nu nuttig zijn (volgende speler dwarszitten, of jezelf een 7-extra-beurt geven om twee kaarten te lossen). (4) Speel bij meerdere opties de kaart die de meest schaarse eigen kleur opruimt, om vast-zitten later te voorkomen. (5) Boer-kleurkeuze: kies de kleur waarvan je zelf de meeste kaarten hebt. (6) Tegen de leider met weinig kaarten: speel agressief een 2/joker/8 om hem te laten pakken/overslaan. (7) 'laatste kaart' roepen: AI doet dit automatisch (geen straf). Difficulty-schaling: 'makkelijk' = grotendeels willekeurige legale zet + soms vergeten te optimaliseren; 'gemiddeld'/'moeilijk' = volledige heuristiek + finish-bescherming. GEEN determinisatie/Monte-Carlo nodig (imperfecte info weegt licht; greedy EV volstaat).
- **Hergebruik:** Direct hergebruikt zonder wijziging: core/deck.ts createDeck/createRng/shuffle/makeCard/cardId/cardFromId/sortHand (deal-helper deels: Pesten deelt vast 7 i.p.v. heel deck, maar shuffle+rondedelen-logica herbruikbaar). core/events.ts EventBus (generiek). core/scoresheet.ts (generiek; match-telling). GameDefinition-contract (types.ts) 1-op-1: nieuwe createPestenDefinition implementeert createInitialState/initialEvents/getView/getLegalMoves/applyMove/currentActor/isFinished/getWinners. core/player.ts AiPlayer-denkvertraging + RemotePlayerController + GameHost-structuur (server) bijna 1-op-1, mits chooseCard wordt verbreed naar chooseMove. Server: room.ts personalize() (verbergt handen), reconnect/snapshot, AI-fill, chat — vrijwel ongewijzigd; alleen gameId+config worden via registry geïnjecteerd. Net: protocol.ts NetMessage/RoomInfo.gameId/snapshot/requestMove-omhulsel herbruikbaar. Client: render/scene.ts + cardTextures/cards (3D-kaarten, hover/klik op eigen hand, toonSnapshot) en notifications.ts (toasts, keuzedialoog), lobby.ts, i18n.ts. integration.test-manual.ts als test-template. games/kingen/* dient als structuurtemplate (engine/rules/types/params-splitsing). Vereist generalisatie (Phase 0, niet Pesten-specifiek): TurnManager.pickMove → generieke move-dispatch via chooseMove; PlayerController/AiStrategy chooseCard/chooseTrump/chooseRoundKind → chooseMove(view, legalMoves); game-registry i.p.v. hardcoded createKingenDefinition in gameHost.ts/room.ts; protocol requestMove.moveType ontklemmen van 'card'|'trump'|'roundKind'; PublicGameView slagvelden optioneel maken; Seat-type + tafel-layout van max 5 naar 8.
- **Risico's:** Seat-type is hard gelimiteerd op 0..4 (max 5 spelers) door heel de codebase (ALL_SEATS, tafel-layout seatAngle, HUD-chips); Pesten wil 2-8 spelers — dit raakt render, HUD, deal en protocol en is de grootste verbouwing., Kaartmodel kent geen jokers (Rank 2..14, CardId `${suit}-${rank}`); jokers toevoegen raakt deck, textures (cardArt), sortHand, en alle plekken die suit/rank aannemen., PublicGameView is sterk slag-georiënteerd (currentTrick/completedTricks/trickCounts/round.trump verplicht); afleg-spel heeft die niet — zonder generalisatie lekt slag-semantiek of crasht de view/HUD., TurnManager.pickMove en de hele AiStrategy/PlayerController-API zijn rond chooseCard/chooseTrump/chooseRoundKind gebouwd; 'drawCard' en 'chooseSuit' passen daar niet in — de move-dispatch MOET eerst generiek worden (Phase 0), anders bouw je Pesten-hacks in de kern., Reshuffle van de aflegstapel + deterministische seed: de oorspronkelijke shuffle-seed is verbruikt; herschudden midden in de ronde moet deterministisch blijven voor replay/netwerk-sync (aparte RNG-stream nodig)., Regel-randgevallen (niet eindigen op pestkaart, gestapelde 2/joker-keten over meerdere spelers, aas==overslaan bij 2 spelers, lege koopstapel zonder herschud-materiaal) zijn foutgevoelig en vragen gerichte unit-tests., Geen game-registry: zolang die ontbreekt is gameId='kingen' overal hardcoded; Pesten kan niet naast Kingen draaien zonder die injectie.

## Hartenjagen

- **Engelse naam:** Hearts (synoniemen/varianten bevestigd: Black Lady = Amerikaanse standaardvariant met sQ=13; Black Maria = Britse variant; Omnibus Hearts = met ruitenboer-bonus -10; Spot Hearts = harten op pip-waarde + sQ=25). 'Heart Hunter / Heartenjagen' is slechts een letterlijke vertaling op enkele gamerules-sites, geen echte Engelse term.
- **Familie:** slagenspel · **Complexiteit:** 3/5 · **Effort (na Phase 0):** 8-12 mensdagen NA Phase 0. Uitsplitsing: engine+rules+scoring+params (profiel A/B, deck-stripping, bekennen, harten-breken, eerste-slag-verbod) ~2.5-3.5d; doorgeven (gelijktijdig/gedekt + roterende richting + verzamelfase) ~1.5-2d; shoot-the-moon + profiel B fase-2-omkering + einde-detectie ~1-1.5d; AI (determinisatie/ISMCTS + heuristische niveaus + pass-heuristiek, leunend op bestaande helpers) ~2-3d; client-UI (multi-select-pass-dialoog, strafpunten-HUD-plugin, harten-gebroken/shoot-aankondigingen, setup-opties) ~1.5-2.5d; integratietest (kopie van integration.test-manual.ts: 2 headless clients + AI, hele partij beide profielen) ~0.5-1d. Phase 0 zelf (registry + chooseMove-generalisatie + generieke move-dispatch + view-uitbreiding) apart geschat, ~3-5 mensdagen, en is gedeeld over alle toekomstige spellen. · **Vertrouwen regels:** hoog

**Gekozen variant:** PRIMAIR: Profiel B = Nederlands Hartenjagen (32 piketkaarten, sQ=5, kJ=2, harten=1, totaal 15) als default voor de NL-app, met het twee-fasen-einde (stijgen tot drempel, dan omkeren en dalen naar 0). Reden: dit is de cultureel canonieke 'Hartenjagen' zoals beschreven door Wikipedia NL en de meeste Nederlandstalige spelregelbronnen — het is wat Nederlandse spelers herkennen en het meest speelbaar/leerbaar is aan tafel. SECUNDAIR ondersteund: Profiel A = Amerikaans/internationaal Hearts/Black Lady (52 kaarten, sQ=13, totaal 26, met kaarten-doorgeven, harten-breken, shooting the moon, spel tot 100, laagste wint) als bekendste internationale variant; implementeer als selecteerbaar profiel zodat beide doelgroepen bediend worden. Keuzes binnen B bij twijfel zijn telkens de meest deterministische/implementeerbare optie (kl7 opent, geen breekregel, geen doorgave, drempel 50 configureerbaar, '0 of lager wint' default) zodat de regelset eenduidig codeerbaar is zonder dubbelzinnigheid.

### Canonieke regels
CANONIEKE REGELSET HARTENJAGEN (NL) — direct implementeerbaar. Twee officiele profielen: A = Amerikaans/internationaal (52 kaarten), B = Nederlands (32 piketkaarten). Default voor een NL-app: profiel B met expliciete opties.

=== ALGEMEEN ===
- Slagvermijdingsspel, geen troef. Doel: zo min mogelijk strafpunten (in fase 1).
- Spelers: 3-6, ideaal 4. Met de klok mee.
- Kaartrangorde binnen een kleur: Aas (hoog) > Heer > Vrouw > Boer > 10 > 9 > 8 > 7 (profiel B) / ...> 2 (profiel A, laag). Geen troef; kleuren zijn onderling gelijk behalve via slagwinst.

=== DEK & DELEN ===
PROFIEL A (Amerikaans, 52 kaarten):
- Volledig 52-kaartendek, geen jokers. 4 spelers x 13 kaarten.
- 3 spelers: verwijder RUITEN-2 (de2 van diamonds) -> 51 kaarten, elk 17. (CORRECTIE op eerste research: niet klaveren-2 maar RUITEN-2; pagat.com bevestigt.)
- 5 spelers: verwijder de2 en kl2 (2 of diamonds + 2 of clubs) -> 50, elk 10. 6 spelers: verwijder de2, ru2, kl2 (3 lage kaarten, NIET een harten/schoppenvrouw) -> 48, elk 8. Algemene regel: verwijder zo min mogelijk LAGE niet-strafkaarten zodat het deelbaar is.

PROFIEL B (Nederlands, 32 piketkaarten):
- Kaarten 7,8,9,10,Boer,Vrouw,Heer,Aas per kleur (32). 4 spelers x 8 kaarten.
- 5 spelers: voeg DRIE zessen toe (schoppen-6, klaveren-6, ruiten-6; NIET harten-6) -> 35 kaarten, elk 7.
- 3 spelers: deel 32 niet gelijk; gangbare oplossing = verwijder 2 lage niet-strafkaarten (bv. kl7 + ru7) -> 30, elk 10. (Profiel B is primair ontworpen voor 4-5 spelers.)

=== STRAFPUNTEN (per ronde) ===
PROFIEL A: elk harten = 1; schoppenvrouw (sQ) = 13. Totaal = 26.
PROFIEL B: elk harten (8 stuks) = 1; schoppenvrouw (sQ) = 5; klaverenboer (kJ) = 2. Totaal = 15.
(Eenduidig bevestigd door alle geraadpleegde NL-bronnen: 8x harten + 5 + 2 = 15.)

=== KAARTEN DOORGEVEN ===
PROFIEL A (verplicht onderdeel): voor elke ronde kiest elke speler 3 kaarten en geeft ze GEDEKT door volgens roterend patroon:
  ronde 1 -> naar links, ronde 2 -> naar rechts, ronde 3 -> schuin tegenover, ronde 4 -> GEEN doorgave, daarna herhaalt cyclus.
  Elke speler legt eigen 3 weg-kaarten gedekt neer VOORDAT hij de ontvangen kaarten bekijkt.
  Bij 3 spelers vervalt de tegenover-pass: links, rechts, geen, herhaal (of links, rechts, herhaal).
PROFIEL B (canoniek): GEEN kaarten doorgeven (meerderheid van NL-bronnen + Wikipedia NL). Optioneel aan te zetten als huisregel (dan idem patroon als A).

=== OPENING EERSTE SLAG ===
PROFIEL A: de speler die KLAVEREN-2 (kl2) bezit MOET die als allereerste kaart uitspelen. (Bij 3p, met ru2 verwijderd, blijft kl2 bestaan en opent.)
PROFIEL B (canoniek implementeerbaar): de speler met KLAVEREN-7 (kl7) opent verplicht de eerste slag. (Meerderheid: spelletjesbeest/partyspellen/kubuspuzzel/hartenjagen.com. De 'klaveren-2'-vermelding op sommige NL-sites is een onjuiste overname uit profiel A want kl2 bestaat niet in een 32-kaarts dek.) Wikipedia NL kent ook 'voorhand komt vrij uit'; voor een deterministische app kies KLAVEREN-7 verplicht.

=== KLEUR BEKENNEN ===
- Verplicht in beide profielen: je MOET een kaart van de gevraagde (uitgespeelde) kleur leggen als je die bezit.
- Heb je de gevraagde kleur niet, dan mag je elke andere kaart spelen (strafkaarten 'dumpen' mag dan).
- De hoogste kaart van de GEVRAAGDE kleur wint de slag (afwijkende kleuren kunnen nooit winnen, er is geen troef). De slagwinnaar neemt alle kaarten (incl. strafpunten) en komt uit voor de volgende slag.

=== HARTEN BREKEN ===
PROFIEL A (verplicht): je mag geen harten LEIDEN (als openingskaart van een slag) totdat harten 'gebroken' is = totdat iemand in een eerdere slag een harten heeft moeten/mogen bijspelen. Uitzondering: als je hand UITSLUITEND uit harten bestaat, mag je toch harten leiden. De schoppenvrouw mag wel meteen geleid worden (geen aparte sQ-breekregel in de standaard).
PROFIEL B (canoniek): GEEN harten-breekregel — de voorhand mag elke kaart leiden, ook harten/sQ/kJ vanaf de eerste slag (Wikipedia NL bevestigt: 'men mag ook voor de eerste slag uitkomen met een harten'). Optioneel aan te zetten als huisregel (dan idem A).

=== EERSTE-SLAG STRAFKAART-VERBOD (optionele huisregel, profiel A gangbaar) ===
- Gangbaar in profiel A: in de ALLEReerste slag mag niemand strafkaarten (harten of sQ) dumpen, TENZIJ men enkel nog strafkaarten in handen heeft. Implementeer als configureerbare vlag (default AAN bij A, UIT bij B).

=== DOORMARS / SHOOTING THE MOON ===
PROFIEL A: wie ALLE 26 strafpunten in een ronde pakt (alle harten + sQ) krijgt zelf 0 en kiest: OFWEL alle andere spelers +26, OFWEL zichzelf -26. (Speler kiest het voordeligst.)
PROFIEL B: wie ALLE 15 strafpunten pakt krijgt zelf 0 en: alle andere spelers +15 (of, equivalent, zelf -15). Implementeer keuze identiek aan A.
- Randgeval: 'doormars' geldt alleen bij EXACT alle strafkaarten in eigen slagen; mist er 1 punt, dan normale telling.

=== EINDE & WINNAAR ===
PROFIEL A: speel rondes tot een speler aan het eind van een ronde de drempel (standaard 100; soms 50) BEREIKT of OVERSCHRIJDT. Speler met de LAAGSTE totaalscore wint. Geen tweede fase.
PROFIEL B (canoniek twee-fasen): 
  Fase 1: scores stijgen; speel tot een speler de drempel overschrijdt (gangbaar 50; soms 100 — maak configureerbaar, default 50).
  Fase 2 (omkering): zodra de drempel is overschreden draait het doel om — vanaf dan moeten spelers juist strafpunten BINNENhalen; de gepakte strafpunten worden nu AFGETROKKEN van de eigen score. De eerste speler die EXACT 0 (of, per huisregel, 0-of-lager) bereikt wint. (Wikipedia NL + spelletjesbeest bevestigen de omkering; drempel varieert per bron, daarom configureerbaar.)
  Implementatienoot 'exact 0': bij 'precies 0'-regel kan een speler over 0 heen schieten en moet opnieuw stijgen; eenvoudigere variant '0 of lager wint' is speelbaarder — bied beide als optie, default '0 of lager wint'.

=== RANDGEVALLEN (beide profielen tenzij vermeld) ===
- Lege hand / einde ronde: ronde eindigt wanneer alle handen op zijn; tel strafkaarten in elke speler-stapel; voeg toe aan totaalscore (fase 1) of trek af (fase 2 profiel B).
- Gelijke stand bij spelEinde: speel een extra ronde of laagste-na-tiebreak; (huisregel — geen universele standaard).
- Slag met alleen niet-gevraagde kleuren behalve de leidkaart: leidkaartkleur wint altijd; bij gelijke kleur de hoogste rang.
- sQ/kJ dumpen: toegestaan zodra je de gevraagde kleur niet kunt bekennen (behoudens eerste-slag-verbod indien aan).
- Doormars + eerste-slag-verbod: niet conflicterend; verbod geldt alleen slag 1.

### Implementatie-ontwerp
- **State-model:** HartenState (parallel aan KingenState, hergebruikt Trick/currentTrick/completedTricks/trickCounts). Velden: config: HartenVariantConfig (profiel A/B, playerCount 3-6, passingMode, passingCount, heartsBreakRule, firstTrickNoPenalty, openingCardId (clubs-2 of clubs-7), shootMode, phase2 (omkering aan/uit + drempel + exactZero/orLower), threshold); params: HartenTableParams (removedCards per spelersaantal, cardsPerPlayer, openingCard, penaltyMap: per CardId -> punten, totalPenalty); players; seed; phase: 'passing'|'playing'|'roundFinished'|'gameFinished'; roundIndex; passDirection ('left'|'right'|'across'|'none', roteert per ronde); dealer; hands: Card[][]; passSelections: (CardId[]|null)[] per stoel (gedekt, gelijktijdig); pendingHandsAfterPass; currentTrick; completedTricks; trickCounts; heartsBroken: boolean; turn; capturedPenaltyThisRound: number[] (afgeleid, per stoel); scoresPerRound; totals; gameDirection ('up' in fase 1, 'down' in fase 2 profiel B). GEEN troef/roundKind nodig.
- **Move-types:** playCard, passCards
- **Nieuwe events:** passRequest (server vraagt N kaarten door te geven, met richting), cardsPassed (per stoel: hoeveel doorgegeven; ontvangen kaarten gefilterd per speler zoals deal-hands), passComplete (alle passes verwerkt, nieuwe handen), heartsBroken (harten gebroken; voor UI-aankondiging), shootTheMoon (speler pakte alle strafpunten; subtype + keuze andere+N of zelf-N), phaseReversed (profiel B: drempel overschreden, doel keert om), penaltyTaken (optioneel: strafpunten in een slag, voor live HUD-teller)
- **PublicGameView-extensies:** penaltyPerSeat: number[] (gepakte strafpunten deze ronde per stoel; trickCounts alleen volstaat niet want kaartwaarde telt), heartsBroken: boolean, passDirection / passingPhase: richting + aantal + 'selecteer N kaarten'-vlag, passSelectionSizes: number[] (wie heeft al doorgegeven, gedekt), phase: 'passing'|'playing' + reversedPhase-vlag (profiel B fase 2) zodat HUD doel kan omdraaien, penaltyMap / cardPenaltyValues: per CardId de strafwaarde (voor HUD-highlight van sQ/kJ/harten), round.trump moet null/optioneel kunnen zijn (al het geval), round.kind/label ongebruikt -> generiek leeg toestaan, legalMoves generiek (legalCards volstaat voor playCard, maar passing heeft multi-card-zet -> view heeft veld nodig voor 'te selecteren kaarten' of legalMoves: TMove[])
- **UI-behoeften:** Multi-select-kaartdialoog voor doorgeven (kies exact N kaarten, bevestigknop, richtingpijl links/rechts/overkant) - NIEUW, notifications.ts kent alleen enkelvoudige chooseTrump-dialoog, HUD-strafpuntenteller per speler i.p.v. (of naast) slagenteller; hud.ts heeft nu hardcoded trickCounts+troef -> moet per-spel-plugin worden, Harten-gebroken-aankondiging via bestaande toasts/notifications, Shoot-the-moon-aankondiging + (voor mens) keuzedialoog andere+N / zelf-N, Profiel B fase 2: HUD toont omgekeerd doel ('nu juist punten pakken') + drempelbalk, Strafkaart-highlight op tafel (sQ/kJ/harten visueel markeren) - kan via cardTextures/scene-overlay, Troefindicator verbergen (geen troef) - HUD-plugin, Setup-scherm: profiel A/B keuze + opties (doorgeven aan/uit, drempel, shoot-mode) - setup.ts uitbreiden
- **AI-aanpak:** Per AI-beleid zoekgebaseerd (imperfecte informatie). Methode: determinisatie + ISMCTS/Monte-Carlo, met heuristische fallback voor 'makkelijk'/'gemiddeld' zodat het bestaande 3-niveau-stramien (random/heuristisch/slim) behouden blijft. - Determinisatie van onbekende handen: gebruik de bestaande unseenCards(view)-helper (volledig deck minus eigen hand, view.playedCards, lopende+voltooide slagen, gestripte kaarten per spelersaantal). Verdeel die onzichtbare kaarten willekeurig over de tegenstanders, rekening houdend met getoonde renonces (someOpponentShownVoid is al aanwezig) als constraint: een speler die in kleur X niet bekende, krijgt geen X toebedeeld. Genereer K determinisaties (bijv. 20-50), speel per determinisatie een lichte playout/zoekboom uit met de regelmotor (getLegalMoves/applyMove zijn puur en deterministisch -> direct herbruikbaar als simulator), en kies de zet met de beste gemiddelde verwachte strafpunten (lager = beter; in fase 2 profiel B juist hoger). - Features/heuristieken die de playouts sturen en de zwakkere niveaus volledig dragen: strafkaart-bewustzijn (hoogste-strafkaart-dump = aangepaste discardPriority), duik-onder-de-slag (maxBy losing-kaart, al in strategies.ts), niet-de-slag-pakken-met-strafpunten, sQ/kJ veilig lozen zodra renonce mogelijk, harten-breken-timing, en shoot-the-moon-detectie (als eigen hand domineert: juist ALLE strafkaarten proberen te pakken -> doel omdraaien in de evaluatiefunctie). - Pass-keuze (passCards): heuristisch — gooi sQ/kJ en hoge harten/hoge schoppen (boven Vrouw, gevaar voor sQ) en lange-kleur-singletons weg om renonces te creeren; optioneel licht doorgerekend per niveau. - Profiel B fase 2 omkering: dezelfde motor, alleen het tekencriterium in de evaluatie flippt (maximaliseer gepakte strafpunten).
- **Hergebruik:** Direct hergebruiken zonder wijziging: core/deck.ts createDeck(removed)/createRng/shuffle/deal/sortHand (deck-stripping per spelersaantal precies wat profiel A/B vragen); core/types.ts Card/Suit/Rank/Trick/TrickPlay/PublicGameView-skelet/GameDefinition-contract; core/events.ts EventBus generiek; core/scoresheet.ts generieke standnotatie; core/player.ts AiPlayer (chooseMove na generalisatie); ai/strategies.ts helpers unseenCards/someOpponentShownVoid/beats/currentWinningCard/minBy/maxBy/discardPriority (vrijwel 1-op-1 bruikbaar voor Hartenjagen-AI); deck.trickWinner met trump=null (troefloos pad bestaat al expliciet in de functie). Als template: games/kingen/{engine,rules,scoring,params,types}.ts -> kopieer de structuur naar games/harten/. Client: render/scene.ts + animations.ts + cards.ts + cardTextures.ts (3D-tafel, deal/play/trick-innemen-animaties) volledig herbruikbaar; ui/lobby.ts, ui/notifications.ts toasts, ui/scoreboard.ts, net/transport + protocol grotendeels herbruikbaar. NB trickWinner(plays, null) geeft al correct de hoogste-in-gevraagde-kleur-winnaar voor een troefloos spel.
- **Risico's:** Phase 0 (registry + generalisatie) is een harde voorwaarde: zolang TurnManager.pickMove, PlayerController (chooseCard/chooseTrump/chooseRoundKind) en de hardcoded gameId='kingen'/DEFAULT_VARIANT in room.ts/roomManager.ts/gameHost.ts niet gegeneraliseerd zijn naar chooseMove(view, legalMoves) + game-registry, is Hartenjagen niet inplugbaar. Risico op scope-creep., passCards is een multi-kaart-zet die buiten het card/trump/roundKind-stramien valt: vereist nieuwe move-dispatch + nieuwe multi-select-UI; protocol.requestMove.moveType ('card'|'trump'|'roundKind') moet generiek worden., Gelijktijdig & gedekt doorgeven botst met het beurt-voor-beurt currentActor-model: state moet alle 4-6 passes verzamelen voordat het spel verder kan (currentActor moet meerdere actoren tegelijk aankunnen, of een 'verzamel-fase' met per-stoel-deadline)., Shoot-the-moon vereist een speler-keuze (andere+N vs zelf-N) NA het scoren -> extra mini-beslisfase + event + dialoog; randgeval 'exact alle strafkaarten' moet waterdicht., Profiel B fase 2 (omkering naar aftrekken, exact 0 / 0-of-lager): tweede scoringsregime + einde-detectie; over-0-heen-schieten randgeval., PublicGameView is sterk slag-getint (trickCounts/currentTrick/round.trump) maar mist strafpunt-per-stoel; uitbreiden zonder Kingen te breken vereist optionele velden., ISMCTS-determinisatie kan traag zijn bij 5-6 spelers x 13 kaarten; tijdbudget/iteratiecap nodig, anders blokkeert de denktijd (think-delay-mechanisme bestaat al, maar zoekkosten zijn reeel)., Variantmatrix (profiel A vs B, 3-6 spelers, optionele huisregels) is groot -> veel regel-randgevallen en testoppervlak.

## Toepen

- **Engelse naam:** Bevestigd: geen aparte gangbare Engelse naam. Zowel EN Wikipedia (en.wikipedia.org/wiki/Toepen) als Pagat (pagat.com) gebruiken in het Engels de Nederlandse naam "Toepen". Engelstalige aanduiding = "Toepen" (soms "Toep"). Duitse Eifel-/Rijnland-varianten heten Siwweschrööm/Schröömen/Siebenschräm/Tuppen/Eifelpoker, maar dat zijn regionale varianten, geen Engelse naam.
- **Familie:** slagenspel · **Complexiteit:** 4/5 · **Effort (na Phase 0):** 8-12 mensdagen na Phase 0 (Phase 0 = registry + generieke move-dispatch + Seat/seatCount-generalisatie naar 2-8 + view-extensies, ~5-7 dagen eenmalig, gedeeld met andere spellen). Uitsplitsing Toepen zelf: engine/state/rules/scoring incl. toep-boekhouding en randgevallen ~3-4 d; toepTrickWinner + special hands (vuile was, vier gelijke) ~1-2 d; AI (heuristiek + EV + bluf, 3 niveaus) ~1,5 d; client (inzetbadge, toep-knop, meegaan/pas-dialoog, status-overlays, match-scoreboard, vuile-was-flow) ~2-3 d; integratietest (headless 2 clients + AI hele match via protocol, template integration.test-manual.ts) ~1 d. · **Vertrouwen regels:** hoog

**Gekozen variant:** GEKOZEN CANONIEKE VARIANT (motivatie per beslissing):

1) MAXIMUM = 15 strafpunten (instelbaar naar 10). Reden: 15 (met "pelt" op 14) geeft langere, spannendere potjes en is door spel-regels.nl + EN/NL Wikipedia ondersteund; 10 is even gangbaar (Pagat/slokker/spelenboek) dus aangeboden als instelling. Standaardwaarde 15 = meest speelbaar; instelbaarheid lost het onoplosbare bronconflict netjes op.

2) STRAFPUNTEN OPTELLEN (niet aftellen). Reden: dominante en intuïtiefste vorm in vrijwel alle bronnen; "wie maximum bereikt is af".

3) 2-8 SPELERS, ideaal 4. Reden: NL-praktijk (de doeltaal/doelgroep) ondersteunt 2-spelermodus breed; 4 als aanbeveling.

4) VUILE WAS = 'vier plaatjes OF drie plaatjes + een 7', met controle: terecht -> uitdager +1, bluf -> claimer +1 + open spelen. Reden: meest inclusieve definitie dekt alle bronvarianten; controle-richting is door Pagat + spelenboek.nl eenduidig.

5) VIER GELIJKE = directe winst + 3 strafpunten voor de rest. Reden: unaniem in de NL-bronnen die het noemen; leuk en leerbaar randgeval.

6) DELEN één-voor-één (1-2-1 optioneel/genegeerd). Reden: cosmetisch, beïnvloedt de uitkomst niet; één-voor-één is breedst bevestigd en simpelst te implementeren.

7) CEREMONIES (fluiten/staan bij 3-4 tienen/boeren), PELT, KANS-OP-TOEP, BOER-BONUS = optioneel, standaard UIT. Reden: regionale folklore zonder eenduidige puntgevolgen; houdt de kern-implementatie eenduidig en testbaar.

8) RANDGEVAL 'winnaar laatste slag gevouwen' structureel uitgesloten door gepaste spelers geen kaarten meer te laten leggen; Pagat-fallback ('iedereen verliest') gedocumenteerd voor varianten.

Deze set is de meest gangbare, best speelbare én eenduidig implementeerbare combinatie en lost elk bronconflict expliciet op (default + instelbaar waar nodig).

### Canonieke regels
CANONIEKE REGELSET TOEPEN (NL) — direct implementeerbaar

== SPELERS & MATERIAAL ==
- 2 t/m 8 spelers; ideaal 4. (Implementeer 2-8; toon 4 als aanbevolen.)
- Deck: 32 piketkaarten (French-suited), waarden 7 t/m Aas in 4 kleuren (harten, ruiten, schoppen, klaveren). Géén 2-6, géén jokers. Geen troef.
- KAARTVOLGORDE HOOG -> LAAG (geldt voor elke kleur): 10 > 9 > 8 > 7 > Aas > Heer > Vrouw > Boer.
  Interne rangwaarde (hoger = sterker): Boer=1, Vrouw=2, Heer=3, Aas=4, 7=5, 8=6, 9=7, 10=8.

== DOEL ==
- Vermijd strafpunten. Strafpunten worden VERZAMELD (opgeteld). Wie het afgesproken maximum BEREIKT, is af.
- Canoniek maximum: 15 strafpunten (zie chosenVariant; 10 als alternatieve instelling). Bij 14 punten = "pelt" (kritiek, optionele regel hieronder). Bij >= maximum = af.
- Laatste niet-afgevallen speler wint het hele spel. (Bij 2 spelers: zodra één speler af is, wint de ander.)

== OPZET PER RONDE ==
- Deler schudt en deelt elke speler 4 kaarten, met de klok mee, ÉÉN voor één (één-voor-één is de breed-bevestigde standaard; 1-2-1 is optioneel/cosmetisch en NIET canoniek vereist).
- Kaarten gedekt; alleen de eigenaar kijkt. Resterende kaarten gedekt op tafel (komen niet in spel).
- Speler links van de deler komt uit. Spel verloopt met de klok mee.
- De WINNAAR van de laatste (4e) slag wordt deler van de volgende ronde (en zo verschuift de uitkomer).

== SLAGENSPEL (4 slagen per ronde) ==
- Uitkomer speelt een kaart; die kaart bepaalt de gevraagde kleur van de slag.
- KLEUR BEKENNEN IS VERPLICHT: kun je de gevraagde kleur volgen, dan MOET je een kaart van die kleur leggen; kun je niet volgen, dan mag je een willekeurige kaart afgooien (deze kan de slag niet winnen, want er is geen troef).
- De slag wordt gewonnen door de HOOGSTE kaart van de gevraagde kleur (volgens rangorde 10>9>8>7>A>H>V>B).
- De winnaar van een slag komt uit voor de volgende slag.
- Na 4 slagen: de winnaar van de 4e slag ontloopt strafpunten; ALLE overige nog-meedoende (niet-gepaste) spelers krijgen de actuele inzet als strafpunten bijgeschreven.

== INZET & TOEPEN (kloppen) ==
- Inzet begint elke ronde op 1.
- TOEPEN: elke nog-meedoende speler mag op ELK moment tijdens de ronde "toep" roepen / op tafel kloppen. Dit verhoogt de inzet met 1.
- Na een toep moeten de overige nog-meedoende spelers, OM DE BEURT met de klok mee, kiezen:
  * MEEGAAN: in het spel blijven tegen de nieuwe, verhoogde inzet.
  * PASSEN (vouwen): direct uitstappen; je krijgt onmiddellijk de inzet zoals die gold VÓÓR deze toep als strafpunt en doet niet meer mee in deze ronde.
- OVERTOEPEN: na een toep mag een ANDERE speler opnieuw toepen (+1). De LAATSTE toeper mag niet zelf opnieuw toepen totdat een ander heeft getoept. Overtoepen kan doorgaan tot de inzet het ronde-maximum nadert (begrens zodat niemand in één ronde over zijn totale maximum kan schieten; in praktijk vrijwel onbegrensd).
- Inzet-stapeling (strafpunten voor verliezers van de 4e slag): 0 toeps = 1 pt, 1 toep = 2 pt, 2 toeps = 3 pt, n toeps = n+1 pt.
- Passen kost de inzet die gold op het MOMENT van passen (de waarde vóór de toep waarop je past): vroeg passen (geen toep nog) = 1 pt; passen op de 1e toep = 1 pt; passen na al 1 aangenomen toep, op de 2e toep = 2 pt; enz.
- De toeper die zelf de 4e slag NIET wint, betaalt ook gewoon de actuele inzet.

== RANDGEVALLEN ==
1. ALLE TEGENSTANDERS PASSEN op een toep (of er is nog maar één speler over): die ene overgebleven speler wint de ronde, krijgt 0 strafpunten, de ronde stopt onmiddellijk (geen slagen meer nodig). Elke passer heeft zijn pas-strafpunt al gekregen.
2. WINNAAR VAN DE LAATSTE SLAG HEEFT GEPAST/GEVOUWEN: kan niet gebeuren in de strikte implementatie, want wie past doet niet meer mee en speelt geen kaarten meer. Canonieke regel (Pagat-bevestigd) voor varianten waar dit toch kan ontstaan: als de feitelijke winnaar van de 4e slag een gevouwen speler zou zijn, verliest IEDEREEN (alle niet-gepaste spelers krijgen de inzet). In onze implementatie: gepaste spelers leggen geen kaarten meer; de 4e slag wordt gewonnen door de hoogste kaart onder de NOG-MEEDOENDE spelers; die wint. Dit randgeval is daarmee structureel uitgesloten.
3. GELIJKSPEL binnen een slag is onmogelijk: elke kaart is uniek (32 unieke kaarten), dus er is altijd precies één hoogste kaart van de gevraagde kleur.

== SPECIALE HANDEN (bij aanvang ronde, vóór de eerste slag) ==
- VIER GELIJKE = TOEP: heb je vier kaarten van dezelfde waarde (bv. 4 boeren of 4 tienen), roep dan meteen "toep!" en toon je hand. Je WINT de ronde direct; alle andere spelers krijgen elk 3 strafpunten. (Consistent bevestigd door meerdere NL-bronnen.)
- VUILE WAS: een speler met een waardeloze hand mag vóór de eerste slag "vuile was" claimen en zijn 4 kaarten gedekt inruilen voor 4 nieuwe (van de gedekte stapel). Definitie (canoniek, meest inclusief): VIER plaatjes (B/V/H/A) ÓF DRIE plaatjes + een 7. Een hand met een 8, 9 of 10 erin is GEEN vuile was.
  Controle-procedure (Pagat/NL-consensus): een tegenstander mag de geclaimde hand controleren vóór het inruilen.
    * Is de hand écht vuile was (klopt) -> de CONTROLEUR/uitdager krijgt 1 strafpunt; de claimer mag ruilen.
    * Is het bluf (er zat een 8/9/10 in) -> de CLAIMER krijgt 1 strafpunt EN moet de oorspronkelijke hand OPEN op tafel houden en daarmee de ronde verder spelen.
  (Optie: "witte was" = vier plaatjes als afzonderlijke, sterkere benaming; functioneel valt dit al onder de vuile-was-definitie en hoeft niet apart geïmplementeerd.)

== OPTIONELE HUISREGELS (alleen indien aangezet; NIET standaard aan) ==
- PELT / ARMOEDE: een speler die nog 1 strafpunt van het maximum af staat (bv. 14 bij max 15) speelt "op pelt": hij mag zelf niet meer toepen; anderen beslissen of/hoe ze tegen hem spelen. (Regionaal verschillend; standaard UIT.)
- DRIE/VIER TIENEN of BOEREN CEREMONIE: drie tienen -> MOET fluiten; vier tienen -> MOET gaan staan; drie boeren -> MAG fluiten; vier boeren -> MAG gaan staan. Puur ceremonieel, geen puntgevolg. (Standaard UIT in een digitale implementatie.)
- "KANS OP TOEP" (drie gelijke -> extra kaart trekken om de vierde te halen): zeldzaam, standaard UIT.
- BOER-BONUS (1 strafpunt AF bij winnen 4e slag met een boer): regionaal, standaard UIT.

== SAMENVATTING SCOREREGELS (implementatie) ==
- Inzet ronde-start = 1; +1 per toep.
- Verliezers 4e slag (alle niet-gepaste spelers behalve de winnaar): +inzet.
- Passer: +inzet-vóór-de-toep-waarop-hij-paste.
- Vier gelijke: claimer wint, elke ander +3.
- Vuile-was-controle: +1 voor de verliezer van de uitdaging (controleur als terecht, claimer als bluf).
- Speler met totaal >= maximum (canoniek 15; instelbaar 10) is af. Laatste over = winnaar.

### Implementatie-ontwerp
- **State-model:** Toepen is een slagenspel (4 slagen/ronde) MET een gok-/bluf-laag bovenop de slagen, plus eliminatie over meerdere rondes. Kernvelden TopenState: config (TopenConfig: maxStrafpunten 15|10, peltRegel bool, vuileWasRegel bool, vierGelijkeRegel bool, minSpelers 2 maxSpelers 8), params (deck = 32 krt via createDeck met alle 2-6 verwijderd, cardsPerPlayer=4, tricksPerRound=4), players, seed. Ronde-state: phase ('dealing'|'specialClaims'|'playing'|'roundFinished'|'gameFinished'), roundIndex, dealer (winnaar 4e slag vorige ronde), hands[seat][], currentTrick, completedTricks, trickCounts, turn. Gok-laag: stake (huidige inzet, start 1), activeSeats (Set: nog-meedoende, niet-gepaste stoelen), foldedSeats (Set), toepHistory ([{seat, stakeAfter}]), lastToeper (Seat|null, mag niet zelf overtoepen), pendingResponders (stoelen die nog op de huidige toep moeten reageren, in klokvolgorde), penaltyOnFold[seat] (inzet-voor-deze-toep, gelockt per speler op moment van zijn beslissing). Eliminatie: totals[seat] (cumulatieve strafpunten), eliminatedSeats (Set, totals>=max). roundLeader voor de lopende slag. NB: turn-machine heeft twee sporen — slag-beurt (kaart spelen) EN toep-respons-beurt (meegaan/passen); beide via currentActor.
- **Move-types:** playCard, callToep, respondMeegaan, respondPas, claimVuileWas, challengeVuileWas, passVuileWas, declareVierGelijke
- **Nieuwe events:** toepCalled (seat, newStake), foldDecision/playerFolded (seat, penalty, stakeAtFold), meegaanAccepted (seat, stake), vuileWasClaimed (seat), vuileWasChallenged (challenger, terecht: bool, penaltySeat), vuileWasExchanged (seat, newHandSize, openOnTable: bool), vierGelijkeDeclared (seat, rank) -> ronde wint direct, anderen +3, stakeChanged (newStake), playerEliminated (seat, totalPenalty), roundWonByLastStanding (seat) (alle tegenstanders gepast), matchEnd/gameEnd (winner: laatste over)
- **PublicGameView-extensies:** stake (huidige inzet/pot), activeSeats / status per stoel (active|folded|eliminated), toepHistory + lastToeper, pendingToepResponders (wie moet nu meegaan/passen, en mijn-beurt-om-te-reageren), penaltyIfIFoldNow (kosten als ik nu pas), canCallToep (mag ik nu toepen — niet lastToeper, niet op pelt), specialClaimPhase info (mag ik vuile was claimen / vier gelijke declareren; openliggende geblufte hand van een ander), maxStrafpunten + per-seat totalen met af-status, moveType-context: speelt-kaart vs reageert-op-toep
- **UI-behoeften:** Pot/inzet-indicator (grote 'inzet: N' badge i.p.v. troefbadge — troef bestaat niet in Toepen), TOEP-knop (kloppen op tafel) altijd zichtbaar voor active speler die niet lastToeper is, met klop-animatie/geluid, Meegaan/Passen-dialoog (modaal, klokvolgorde, toont kosten-bij-passen) — hergebruik notifications.ts keuzedialoog-patroon, Per-stoel status-overlay: 'gepast' (kaarten grijs/weg), 'af' (uit het spel), inzet-bijdrage, Vuile-was-flow: claim-knop + tegenstander challenge-dialoog + open-op-tafel-weergave van geblufte hand, Vier-gelijke instant-win-aankondiging (toast), Slagentellers HUD-aanpassing: in Toepen telt alleen de 4e-slag-winnaar; toon 'wie ligt voor' subtieler, Eliminatie-/winnaar-aankondiging over meerdere rondes (match-scoreboard i.p.v. ronde-scoreboard), Kaartvolgorde-hint in hand-UI (10 hoog, boer laag) want afwijkend van intuitie
- **AI-aanpak:** Sterke HEURISTIEK + eenvoudige EV (conform AI-beleid: Toepen = bluf met simpele EV-inschatting, geen ISMCTS). Twee beslissingen: (1) chooseCard — slag-heuristiek met Toepen-kaartwaarde (toepRankValue: 10>9>8>7>A>H>V>B): bekennen verplicht; win de 4e slag als het kan (hoog spelen als laatste/derde hand de slag pakt), anders laag afgooien en hoge kaarten sparen; tel gespeelde kaarten via view.playedCards om te weten of mijn kaart nog hoogste is. (2) toep/meegaan/pas — EV op basis van handsterkte-score H = som van toepRankValues van de 4 kaarten + bonus voor 'baas' (hoogste resterende kaart van een kleur, afgeleid uit playedCards) + positiebonus (laat uitkomen is voordeel). Drempels: toep als P(win 4e slag) hoog (H boven percentiel) -> verhoog inzet om druk te zetten of als pure bluf met kleine kans p_bluff (difficulty-afhankelijk: makkelijk p_bluff~0, slim hoger). Meegaan als verwachte winst-kans * stake > pas-kosten (penaltyIfIFoldNow); pas als handsterkte laag en inzet hoog. Vuile was: claim deterministisch als hand voldoet (4 plaatjes OF 3 plaatjes+7); challenge een ander als de open kans op bluf hoog is (regel-uitvoering, geen verborgen info nodig want de claimer toont). Vier gelijke: altijd direct declareren (gratis winst). Determinisatie NIET nodig (geen diepe zoek); onbekende handen alleen impliciet via kaarttelling. Drie difficulty-niveaus hergebruiken (random/heuristisch/slim) met opklimmende bluf-frequentie en kaarttel-diepte.
- **Hergebruik:** DIRECT herbruikbaar: GameDefinition-contract (types.ts) 1-op-1; EventBus (events.ts); ScoreSheet (scoresheet.ts) voor cumulatieve totalen; createDeck(removed) met de 20 lage CardIds (alle ranks 2-6) verwijderd -> 32-kaarts deck; createRng/shuffle (deterministisch); deal() voor round-robin (met dunne wrapper die alleen 4*n kaarten uitdeelt, rest dood); sortHand; Trick/TrickPlay-types; structuredClone-immutability-patroon in applyMove; AiStrategy-interface + AiPlayer + getStrategyForDifficulty + withThinkDelay; RemotePlayerController + GameHost + Room reconnect/AI-fill/personalize (alleen de 'deal'-personalisatie geldt; vuile-was open-hand wordt juist NIET verborgen); LocalTransport/wsTransport; lobby.ts, chat.ts, scoreboard.ts (met match-i.p.v.-ronde-aanpassing), notifications.ts keuzedialoog-infra, 3D-scene/cards/animations volledig (zelfde 4-kaarts handen, slag op tafel). AANPASSEN/GENERALISEREN (Phase 0-werk dat Toepen nodig heeft): trickWinner() NIET herbruikbaar — gebruikt rank Ace-high; Toepen heeft eigen volgorde 10>9>8>7>A>H>V>B, dus aparte toepTrickWinner met toepRankValue nodig; TurnManager.pickMove() hardcodet card/trump/roundKind -> moet generieke move-dispatch chooseMove(view, legalMoves) worden; PlayerController/AiStrategy chooseCard/chooseTrump/chooseRoundKind -> chooseMove; protocol.requestMove.moveType uitbreiden (geen 'trump', wel 'toepResponse'/'specialClaim'); game-registry in gameHost/room/roomManager. HUD troefbadge -> inzetbadge.
- **Risico's:** trickWinner() lijkt herbruikbaar maar is het NIET (Ace-high vs Toepen 10-hoog/boer-laag) — stil verkeerde slagwinnaar als je het klakkeloos hergebruikt; expliciet toepRankValue nodig, Twee-sporen turn-machine (slag-beurt EN toep-respons-beurt in klokvolgorde) past niet op de huidige enkelvoudige turn/currentActor-aanname; TurnManager moet zonder regelkennis kunnen pollen welke speler nu wat moet — vereist generieke move-dispatch eerst (Phase 0), Inzet-/pas-boekhouding is subtiel: passer betaalt de inzet VOOR de toep waarop hij past; overtoepen-verbod (lastToeper); begrenzing zodat niemand in een ronde over zijn max schiet — veel randgevallen, hoog test-risico, Variabel spelersaantal 2-8 overschrijdt huidige Seat-type (0..4, ALL_SEATS max 5) en seatCount-aannames in view/HUD/3D-tafelopstelling; Seat moet number worden of de tafel-render moet 8 stoelen aankunnen — raakt veel client-code, Eliminatie + 'laatste over wint' is een match-over-meerdere-rondes-model dat de huidige 'vast aantal rondes'-loop (totalRounds, finishRound -> volgende ronde) niet kent; isFinished/getWinners-semantiek verschilt fundamenteel van Kingen, Vuile-was open-op-tafel-hand doorbreekt de 'verberg andermans hand'-personalisatie in room.ts — informatie-model moet per-kaart-zichtbaarheid aankunnen, niet alleen per-stoel, deal() deelt het hele deck; Toepen laat 32-4n kaarten dood liggen — vergeten wrapper geeft 8 i.p.v. 4 kaarten p.p. bij 4 spelers, AI-bluf-tuning: te voorspelbaar (nooit bluffen) of te wild maakt het spel onleuk; vergt speel-tuning, niet alleen correctheid

## Jokeren

- **Engelse naam:** Geen vaste Engelse standaardnaam. Jokeren behoort tot de Rummy-familie en is feitelijk een Nederlandse variant van Rummy/Rommé met 2 pakken en jokers (nauwst verwant aan 'Kalooki'/'Kaluki' en aan Rummikub-in-kaartvorm). Soms losjes 'Dutch Rummy' of 'Joker Rummy' genoemd, maar dit is geen erkende canonieke naam. Aanbeveling: gebruik in UI/code de Nederlandse naam 'Jokeren' en omschrijf in het Engels als 'Dutch Rummy (Jokeren)'.
- **Familie:** afleg-trek · **Complexiteit:** 4/5 · **Effort (na Phase 0):** 11-16 mensdagen na Phase 0. Uitsplitsing: engine (state/regels/combinatie-validatie/scoring/legalMoves/applyMove) 4-5; deterministische deck-met-jokers/instanceId-integratie + tests (incl. integration.test-manual variant) 1.5-2; heuristische AI (combinatie-finder + open/discard-beleid) 2-2.5; client render (stock/discard/meld-zones + nieuwe animaties) 2-3; client interactie/HUD/dialogen (multi-select melden, aanleggen, joker-keuze) 1.5-2.5. Aanname: Phase 0 (CardInstance+joker-model, generieke chooseMove/legalMoves in TurnManager+PublicGameView, game-registry/DI, protocol moveType-generalisatie, personalize-uitbreiding voor geheime stock) is AF — die generalisatie is gedeeld fundament en valt buiten deze schatting. · **Vertrouwen regels:** hoog

**Gekozen variant:** Standaard ("Hollands") Jokeren met 2 pakken (108 kaarten, 4 jokers), 13 kaarten per speler, openingsminimum 30 punten (met uitzondering '3 sets mag ook'), trekken mag van trek- én aflegstapel, joker = 25 strafpunten, aas hoog OF laag zonder wrap-around, 8 rondes default. GEKOZEN OMDAT: dit de meest gangbare en best speelbare consensus is over de meerderheid van onafhankelijke NL-bronnen (cardgameshub, regels.nl, spelscout, identitygames, club.betcity). De 30-punten-drempel is laagdrempeliger en leerbaarder dan 40 (de 40/50-varianten hebben zelfs eigen namen 'Veertigen'/'Vijftigen' = expliciet aparte varianten). Trekken-van-aflegstapel maakt het spel strategischer en sluit aan bij de Rummy-familie. Amerikaans Jokeren (6 vaste rondes met oplopende eisen, strenge 'alleen-openingscombinatie'-regel) is bewust NIET gekozen als default omdat het complexer en minder vrij is; wel als documenteerde alternatieve modus geschikt.

### Canonieke regels
JOKEREN — CANONIEKE, IMPLEMENTEERBARE REGELSET (NL)

== MATERIAAL & DECK ==
- 2 complete kaartspellen samengevoegd = 104 nummer-/beeldkaarten + 4 jokers (2 per pak) = 108 kaarten totaal. (Telling: 104 "echte" kaarten WAARVAN apart geteld 4 jokers; totaal 108. Beide bronformuleringen "104+4 jokers" en "108 totaal" beschrijven exact ditzelfde deck.)
- Jokers zijn wildcards.

== SPELERS ==
- 2 t/m 4 spelers. Ideaal 3-4; met 2 spelers prima speelbaar.

== HANDGROOTTE / DELEN ==
- Standaard 13 kaarten per speler, één voor één, met de klok mee.
- Optionele 2-spelersvariant: 15 kaarten (huisregel; implementeer 13 als default, 15 als optie).
- Rest = gesloten trekstapel (stock). De bovenste kaart wordt omgedraaid en vormt de start van de open aflegstapel.

== DOEL ==
- Al je handkaarten kwijtraken via geldige combinaties; zo min mogelijk strafpunten in de hand houden. Over meerdere rondes wint het laagste cumulatieve strafpunten-totaal.

== COMBINATIES ==
- SET: 3 of 4 kaarten van dezelfde waarde in VERSCHILLENDE kleuren/symbolen (bv. 7♥ 7♠ 7♣). Bij 4 kaarten zijn dat alle 4 verschillende kleuren.
- REEKS/RIJ: minimaal 3 OPEENVOLGENDE kaarten van DEZELFDE kleur/symbool (bv. 5♦ 6♦ 7♦). Geen bovengrens.
- AAS in reeks: aas mag LAAG (A-2-3) OF HOOG (B/H... → V-H-A, d.w.z. na de heer). Aas mag NIET "om de hoek" (geen H-A-2 / geen doorlopende ring). De aas is dus óf het laagste óf het hoogste uiteinde, nooit beide tegelijk in dezelfde reeks.

== BEURTVERLOOP (3 stappen, met de klok mee) ==
1) TREKKEN: neem precies 1 kaart — ofwel de bovenste gesloten kaart van de trekstapel, ofwel de bovenste open kaart van de aflegstapel. (Beide toegestaan — Rummy-stijl; dit is de gangbare meerderheidsregel.)
2) LEGGEN/AANLEGGEN (optioneel):
   - OPENEN ("uitkomen"): pas mogelijk als je in één keer combinatie(s) met minimaal 30 punten kunt neerleggen. UITZONDERING: 3 volledige sets in één keer mag óók openen, ongeacht puntentotaal.
   - Na het openen mag je in latere beurten losse kaarten AANLEGGEN bij reeds liggende combinaties van JEZELF én van ANDEREN.
   - In dezelfde beurt waarin je opent, mag je ook direct extra combinaties leggen en aanleggen (soepele, gangbare variant). (De strenge "alleen-openingscombinatie"-beperking geldt alleen in Amerikaans Jokeren — zie chosenVariant.)
3) AFLEGGEN: sluit je beurt af door precies 1 kaart open op de aflegstapel te leggen. (Uitzondering: bij exact uitgaan kan de laatste kaart ook gespeeld i.p.v. afgelegd worden — zie EINDE.)

== JOKER ==
- Een joker mag in een set of reeks elke ontbrekende kaart vervangen; de speler geeft expliciet aan welke kaart de joker voorstelt.
- JOKER INRUILEN: een speler die AL GEOPEND is, mag tijdens zijn beurt de joker uit een liggende combinatie pakken als hij de ECHTE kaart bezit die de joker voorstelt en die ervoor in de plaats legt. De vrijgekomen joker moet meteen in een (eigen) geldige combinatie opnieuw worden ingezet (mag niet in de hand terugkeren).
- Een combinatie mag niet bijna uitsluitend uit jokers bestaan: een geldige combinatie bevat minstens 2 echte kaarten (gangbare anti-misbruikregel; aanbevolen implementatie).

== STRAFPUNTEN (kaartwaarden bij napunten) ==
- Aas = 11
- Heer/Vrouw/Boer (beeldkaarten) = 10 elk
- 10 t/m 2 = nominale waarde (10..2)
- Joker = 25
- De speler die uitgaat krijgt 0 strafpunten voor die ronde.
- (Let op: bij ECHT spelen telt de aas 11; de "1 of 11" geldt alleen voor positie in de reeks, niet voor strafpunten.)

== EINDE RONDE ==
- Een ronde eindigt zodra één speler al zijn handkaarten heeft uitgespeeld (uitgaat). Overige spelers tellen hun resterende handkaarten als strafpunten, opgeteld bij hun lopende totaal.

== EINDE SPEL / WINNAAR ==
- Default: een afgesproken vast aantal rondes. Meest genoemd: 8 rondes (ook 6 of 10 komen voor). Implementeer 8 als default, met instelbaar aantal (6/8/10).
- Na alle rondes wint de speler met de LAAGSTE cumulatieve strafpunten.

== RANDGEVALLEN ==
- Trekstapel op: schud de aflegstapel (behalve de bovenste kaart) tot nieuwe trekstapel.
- Set van 4: maximaal 4 kaarten (één per kleur); een 5e gelijke kaart kan niet aangelegd worden.
- Aanleggen bij een reeks: alleen aan de uiteinden, kleur/symbool moet kloppen, geen wrap-around om de aas.
- Joker aan uiteinde reeks: bij inruilen moet de vervangende echte kaart exact de gerepresenteerde positie/kleur hebben.
- Eerste speler die opent in de allereerste beurt: dezelfde 30-punten-drempel geldt.

### Implementatie-ontwerp
- **State-model:** JokerenState (geheim, host-only), volledig nieuw t.o.v. KingenState. Kernvelden: config (JokerenConfig: handSize 13/15, totalRounds 6/8/10, openThreshold=30, twoDeck=true, jokerCount=4, minRealCardsPerMeld=2, allowLayoffToOthers, strictOpening=false voor Nederlands Jokeren); seed; phase ('dealing'|'turn-draw'|'turn-meldOrDiscard'|'roundFinished'|'gameFinished'); roundIndex; dealer; turn:Seat. PER-RONDE: hands:CardInstance[][] (index=Seat); stock:CardInstance[] (gesloten trekstapel, GEHEIM); discard:CardInstance[] (open aflegstapel, bovenste publiek); melds:Meld[] (alle liggende combinaties op tafel, gedeeld eigendom met owner:Seat); hasOpened:boolean[] (per stoel: heeft 30-punten-opening gehaald); turnState:{hasDrawn:boolean, drawnFrom:'stock'|'discard'} (binnen één beurt). CUMULATIEF: scoresPerRound:number[][]; totals:number[]. Meld = {id, kind:'set'|'run', cards:CardInstance[], jokerAssignments:Record<jokerInstanceId, {rank,suit}>, owner:Seat}. KRITIEK: door 2 decks zijn er duplicaat-kaarten, dus elke fysieke kaart heeft een unieke instanceId (bijv. 'hearts-7#0'/'hearts-7#1'/'joker#2'); de bestaande CardId ${suit}-${rank} is NIET uniek genoeg en jokers passen niet in Suit/Rank.
- **Move-types:** drawFromStock, drawFromDiscard, open (1+ melds samen, >=30 pt, of >=3 volledige sets ongeacht punten), layMeld (extra combinatie leggen nadat geopend), layoff (losse kaart(en) aanleggen bij eigen of andermans liggende meld), swapJoker (joker uit liggende meld ruilen tegen de echte kaart, joker direct herinzetten in nieuwe geldige eigen meld), discard (precies 1 kaart afleggen, sluit beurt; uitgaan als hand daarna leeg is)
- **Nieuwe events:** cardDrawn (seat, source:'stock'|'discard', card? alleen voor eigenaar/discard-bron — anders verborgen), cardDiscarded (seat, card), playerOpened (seat, melds, totalPoints), meldLaid (seat, meld), layoffMade (seat, meldId, cards, end?:'low'|'high'), jokerSwapped (seat, meldId, takenJoker, replacementCard, newMeldId), stockReshuffled (newStockSize — aflegstapel teruggeschud), playerWentOut (seat) — speler is uit, ronde eindigt, handPenalty (seat, points) per niet-uitgaande speler bij rondeEinde
- **PublicGameView-extensies:** stockCount:number (alleen aantal, inhoud geheim), discardTop:CardInstance|null en discardCount, melds:Meld[] (alle liggende combinaties, publiek, met joker-toewijzingen), hasOpened:boolean[] per stoel, turnPhase:'draw'|'meldOrDiscard' en hasDrawn:boolean (welke deelactie mag nu), legalMoves moet rijker zijn dan legalCards:Card[] — currentTrick/completedTricks/trickCounts/trump zijn voor Jokeren betekenisloos en moeten optioneel worden, handPenaltyValue per kaart of totaal (UI-hint voor strafpunten in hand)
- **UI-behoeften:** render: gesloten trekstapel (stock) + open aflegstapel (discard) centraal i.p.v. slag-slots; meld-zones op tafel waar liggende sets/reeksen getoond worden met joker-aanduiding, nieuwe animaties: animateDrawFromStock/Discard (kaart naar hand), animateDiscard (hand naar aflegstapel), animateLayMeld/Layoff (kaarten naar meld-zone), animateReshuffle, interactie: multi-select van handkaarten om een meld samen te stellen (geen enkel-kaart-klik zoals nu); 'Open'/'Leg'/'Pas (alleen afleggen)'-knoppen; drag-of-tik om aan te leggen aan een bestaande meld, dialoog: bij joker leggen kiezen welke kaart de joker voorstelt; bij swapJoker doelmeld kiezen; bevestiging bij uitgaan, HUD: vervang slagenteller/troefbadge door 'kaarten in hand per speler' + 'geopend ja/nee' + lopende strafpunten; rondeteller (x van 8) blijft, client move-encoding: requestMove.moveType uitbreiden ('draw'|'meld'|'discard'|...) en moveRequest.move generiek doorlaten
- **AI-aanpak:** Sterke heuristiek (geen zoek/ISMCTS), conform AI-beleid voor laag-strategische afleg-spellen. Twee fasen per beurt. TREKKEN: pak discard-top als die een directe set/reeks completeert of een sterke 2-kaart-aanzet vormt of laag strafpunten kost; anders stock. MELDEN: greedy combinatie-vinder over de hand — genereer alle kandidaat-sets (gelijke rank, verschillende suit) en runs (zelfde suit, opeenvolgend, aas laag OF hoog, geen wrap), plaats jokers optimaal op gaten met minstens 2 echte kaarten per meld; los het 'beste partitie'-probleem op met beperkte backtracking/DP (hand <=15 kaarten, ruim haalbaar). OPENEN: pas openen zodra een geldige combinatie-set >=30 pt (of >=3 volledige sets) bestaat EN het strategisch loont (niet te vroeg jokers verbranden). AANLEGGEN/LAYOFF: leg na openen alles aan wat kan om de hand te legen. AFGOOIEN: gooi de kaart met hoogste strafwaarde-min-nut weg (vermijd kaarten die opponenten zichtbaar kunnen gebruiken; bewaar jokers/verbinders). Features/heuristieken: strafpunt-gewicht per kaart (A=11, beeld=10, joker=25), 'meld-potentieel'-score (hoeveel kaarten 1 of 2 stappen van een combinatie), opponent-handgrootte (sneller uitgaan als iemand bijna uit is). Determinisatie n.v.t. omdat er geen zoek is; de heuristiek werkt puur op de eigen hand + publieke stapel/melds, dus geen aannames over geheime handen nodig.
- **Hergebruik:** DIRECT herbruikbaar zonder wijziging: core/deck.ts createRng/shuffle/makeCard (deck bouwen: 2x createDeck() samenvoegen + 4 jokers), createDeck als basis. core/events.ts EventBus (generiek, onAny/emit) volledig. core/scoresheet.ts (generiek puntentelling per ronde/totaal). core/speed.ts (AI-denktijd/animatieschaling). server/remotePlayer.ts (RemotePlayerController + time-out) werkt al met generieke move:unknown. server/room.ts join/reconnect/snapshot/chat/host-logica vrijwel ongewijzigd (alleen gameId + personalize uitbreiden). client/render/scene.ts THREE-scene, camera, kaart-meshes, hover-lift, render-loop, environments, cardTextures/cardArt (kaartgezichten) — basis blijft; alleen de event->animatie-switch en layout (stapels i.p.v. slagen) per spel. client/ui/lobby.ts, scoreboard.ts, chat.ts, i18n-infrastructuur, notifications toast/aankondiging. server/integration.test-manual.ts als test-template. NA GENERALISATIE herbruikbaar: TurnManager (zodra pickMove->chooseMove generiek is), GameDefinition-contract zelf (Jokeren implementeert exact dezelfde interface), AiPlayer-wrapper. Kingen blijft de structuur-template (games/<naam>/ met types/engine/rules/scoring/params), maar Jokeren deelt nauwelijks regel- of scoring-code met Kingen (andere familie).
- **Risico's:** BLOKKER: Card/CardId (${suit}-${rank}) en Rank/Suit kunnen geen jokers en geen 2-deck-duplicaten representeren. Vereist een CardInstance met unieke instanceId + een 'joker'-soort. Raakt deck.ts, types.ts, render-cache (op cardId), net-protocol (Card-velden) en alle plekken die op cardId mappen — breed maar noodzakelijk (Phase 0)., PublicGameView is volledig slag-gericht (currentTrick/completedTricks/trickCounts verplicht, legalCards i.p.v. legalMoves). Generaliseren naar optionele velden + generieke legalMoves raakt Kingen, AI-types, HUD en scene — moet zorgvuldig zonder Kingen te breken., TurnManager.pickMove + PlayerController/AiStrategy hardcoden Kingen-methoden. Migratie naar chooseMove(view, legalMoves) is een breaking change voor de Kingen-strategieën en LokaleMens; moet samen gemigreerd worden., Geen game-registry: gameHost/room/roomManager hardcoden Kingen. Dependency-injection van GameDefinition + per-spel client-plugin-resolutie is randwerk dat eerst moet staan., Informatieverberging: room.personalize filtert nu alleen 'deal'. Stock is geheim en cardDrawn-from-stock mag de getrokken kaart niet aan anderen lekken; reshuffle-volgorde moet deterministisch maar verborgen blijven. Fout hier = valsspeel-lek., Combinatie-validatie is verraderlijk: aas laag OF hoog maar geen wrap, joker-vervanging met expliciete rank/suit-toewijzing, minstens 2 echte kaarten per meld, layoff alleen aan run-uiteinden in juiste kleur, set max 4 verschillende kleuren, joker-swap met verplichte herinzet. Veel edge-cases, hoog test-belang., Client-interactie verschuift van enkel-kaart-klik naar multi-select + meld-zones + aanleg-targets; de bestaande klik/hover-UX dekt dit niet en is substantieel nieuw werk., Engine-determinisme bij reshuffle van de aflegstapel moet seedbaar blijven (replay/sync), anders breekt snapshot/reconnect.

## Kingsen

- **Engelse naam:** Kings (card game) — bevestigd als gangbaarste Engelse naam. Zeer gangbare synoniemen: "Ring of Fire", "King's Cup" / "Kings Cup", en "Circle of Death". Wikipedia titelt het artikel "Kings (card game)" en noemt Ring of Fire / King's Cup / Circle of Death als alternatieve namen. De Nederlandse naam "Kingsen" (ook gespeld "Kingszen") is een vernederlandsing van "Kings".
- **Familie:** party-drank · **Complexiteit:** 2/5 · **Effort (na Phase 0):** 5-8 mensdagen NA Phase 0. Uitsplitsing: engine (state+ring+effecten+rollen+regels+events) 1.5-2 d; registry-aansluiting + protocol-payload Kingsen-zijde 0.5 d; regel-AI (triviaal) 0.5 d; client ring/beker-render + trek-animatie 2-3 d; HUD+keuzedialogen-plugins (kies-speler, vrije-tekst-regel, richting/beker/rollen-badges) 1-1.5 d; i18n NL/EN voor alle effecten + integratietest 0.5-1 d. Exclusief de Phase-0-generalisatie van TurnManager/PlayerController/protocol/registry (gedeelde kosten met alle nieuwe spellen). · **Vertrouwen regels:** middel

**Gekozen variant:** GEKOZEN: de Nederlandse "drankkoning"-familie (Family A), bevestigd als coherente, breed gepubliceerde variant.

WAAROM:
1) Meest gangbaar in het Nederlandse taalgebied: identiek teruggevonden bij leuke-drankspellen.nl en grotendeels bij regels.nl, naast de primaire bron drankkoning.nl. Het is intern consistent (de 8 'regel verzinnen' en de 9 'regel afschaffen' vormen samen een paar; de 5 'duim-master', 10 'quizmaster', Vrouw 'Rise of the queen' en 6 'drinkmaatje' zijn allemaal doorlopende rollen — een elegant, samenhangend systeem).
2) Sluit aan op de primaire bron die de opdrachtgever zelf noemde (drankkoning), zodat de implementatie matcht met de verwachting.
3) Best leerbaar/speelbaar in een digitale app: alle opdrachten zijn taal-/interactiespellen die een app kan modereren (timer, beurtvolgorde, rol-tracking), zonder fysieke handelingen die slecht digitaliseren.
4) Inclusief: bevat GEEN gendergebonden regels (geen 'meisjes/jongens drinken'), wat de Engelse set en Family C wel hebben — beter voor een moderne implementatie.
5) Gender-neutraal alternatief voor de centrale beker en de eindtrigger sluit naadloos aan.

NIET gekozen: de Engelse 'Kings'-set / Family C (waterfall, gendered drinks, rijmen, categorieen op 10) omdat die minder past bij de NL-naam 'Kingsen', gendered is, en niet de primaire bron volgt. Family B is intern inconsistent over bronnen heen (duimen/quizmaster wisselen van kaart) en bevat de slecht-digitaliseerbare plaskaart.

### Canonieke regels
CANONIEKE REGELSET "KINGSEN" (NL) — direct implementeerbaar

== MATERIAAL ==
- 1 standaard kaartspel van 52 kaarten. Jokers worden VERWIJDERD.
- 1 grote centrale beker/glas in het midden van de tafel (start LEEG).
- Elke speler een eigen drinkglas (alcohol of een non-alcoholisch alternatief; de app biedt een alcoholvrije modus).
- Spelers: minimaal 2, technisch maximaal 12, AANBEVOLEN 4-8 voor de sociale opdrachten.

== OPZET ==
1. Verwijder de jokers.
2. Schud en leg alle 52 kaarten GESLOTEN (face down) in een aaneengesloten cirkel/ring rondom de centrale beker, zonder gaten.
3. Spelers zitten in een kring. De jongste speler begint; daarna MET DE KLOK MEE (tenzij de richting later omkeert door een Aas).

== BEURTVERLOOP ==
- Op je beurt pak je exact EEN kaart uit de ring, draait hem open en voert direct de bijbehorende opdracht uit (zie tabel). Daarna is de volgende speler (in de huidige draairichting) aan de beurt.
- Voorzichtig pakken: je mag de cirkel niet verbreken (zie randgevallen).

== KAART -> OPDRACHT (de canonieke set) ==
- 2  — UITDELEN: kies een willekeurige speler die 1 slok moet nemen.
- 3  — ZELF DRINKEN: jij neemt zelf 1 slok.
- 4  — CATEGORIE: noem een categorie (bv. biermerken, automerken). Om de beurt (in draairichting) noemt iedereen een item. Wie iets herhaalt of niets meer weet, drinkt; daarna stopt de ronde.
- 5  — DUIM-MASTER: jij wordt duim-master. Op elk willekeurig moment mag je je duim op tafel leggen; alle spelers volgen. Wie als LAATSTE zijn duim neerlegt, drinkt. Geldt tot het einde van het spel OF tot een nieuwe 5 wordt getrokken (dan gaat de rol over).
- 6  — DRINKMAATJE: kies een speler als jouw drinkmaatje. Telkens als JIJ moet drinken, drinkt je maatje mee. Geldt tot het einde OF tot een nieuwe 6 (nieuwe koppeling vervangt de oude voor de trekker).
- 7  — TAFEL VAN 7: om de beurt (in draairichting) hardop optellen vanaf 1. Verboden zijn veelvouden van 7 (7,14,21,28,...) EN getallen met een 7 erin (7,17,27,37,...); in plaats van het getal zeg je een afgesproken woord of klap je. Wie een fout maakt of te lang aarzelt, drinkt; daarna stopt de telling.
- 8  — REGEL VERZINNEN: bedenk een regel die het hele spel geldt voor IEDEREEN (bv. niet vloeken, niet met je rechterhand drinken, namen verboden). Overtreders drinken telkens 1 slok. De regel blijft gelden tot hij via een 9 wordt afgeschaft. Meerdere 8-regels kunnen tegelijk gelden (stapelen).
- 9  — REGEL AFSCHAFFEN: schaf EEN bestaande, via een 8 verzonnen regel naar keuze af. Is er geen actieve 8-regel, dan heeft de 9 geen effect (geen straf).
- 10 — QUIZMASTER: jij wordt quizmaster. Niemand mag jouw vragen beantwoorden; wie dat toch doet (verbaal reageert op je vraag), drinkt. Er is MAX. EEN quizmaster tegelijk: een nieuwe 10 vervangt de vorige quizmaster. Geldt tot een nieuwe 10 of einde spel.
- BOER (Jack) — WIJZEN/STEMMEN: aftellen van 5 naar 1; op "1" wijst iedereen tegelijk naar de speler die volgens hem moet drinken. De speler met de MEESTE stemmen drinkt (2 slokken). Bij gelijkstand drinken alle aangewezenen met het hoogste aantal.
- VROUW (Queen) — RISE OF THE QUEEN: jij wordt 'queen'. Op elk willekeurig moment mag je je hand opsteken en "Rise of the queen!" roepen; alle spelers steken hun hand op. Wie als LAATSTE reageert, drinkt (2 slokken). Geldt tot het einde OF tot een nieuwe Vrouw (rol gaat over).
- HEER/KONING (King) — KONINGSBEKER:
    * 1e Koning: jij schenkt een scheut van je drankje in de centrale beker.
    * 2e en 3e Koning: schenk eveneens een scheut bij EN leg je Koning-kaart zichtbaar tegen/op de beker (zo zie je hoeveel Koningen er nog in de ring zitten).
    * 4e (laatste) Koning: de trekker heeft VERLOREN, moet de hele centrale beker leegdrinken — en hiermee EINDIGT het spel.
- AAS (Ace) — OMKEREN: de draairichting van het spel keert om (van met-de-klok-mee naar tegen-de-klok-in of andersom). Geen drankgevolg.

== DOEL ==
Vermijd dat JIJ de vierde (laatste) Koning trekt; die speler verliest en drinkt de centrale beker leeg.

== EINDE ==
Het spel eindigt zodra de VIERDE Koning wordt getrokken: die speler drinkt de centrale beker leeg. (De kaarten hoeven dus meestal niet allemaal op; statistisch eindigt het spel ergens onderweg.)

== RANDGEVALLEN ==
1. Cirkel verbreken: als je bij het pakken de ring onderbreekt (een gat veroorzaakt), neem je een STRAFSLOK uit je EIGEN glas. Het spel gaat gewoon door; de centrale beker blijft exclusief voor de vierde Koning. (Optionele 'hardcore'-huisregel: breker drinkt de centrale beker — niet de standaard.)
2. Doorlopende rollen vervangen: een nieuwe 5/6/10/Vrouw VERVANGT de vorige rolhouder voor die rol. 8-regels STAPELEN juist (meerdere tegelijk mogelijk) tot ze via een 9 worden afgeschaft.
3. 9 zonder actieve 8-regel: geen effect, geen straf.
4. Weinig spelers (2-3): sociale opdrachten (4 categorie, Boer wijzen) blijven uitvoerbaar maar zijn minder leuk; app kan een waarschuwing tonen.
5. Aas bij 2 spelers: 'omkeren' betekent feitelijk dat dezelfde speler weer aan de beurt is — app behandelt dit als 'sla over'/zelfde-speler-blijft (geen vastloper).
6. Beker leeg bij 1e Koning: als nog niemand iets heeft geschonken is de beker gevuld door de Koningen zelf; bij alcoholvrije modus vult de app symbolisch.
7. Gelijkstand bij Boer (wijzen): alle spelers met het hoogste stemmenaantal drinken.
8. Laatste kaart vóór 4e Koning onbereikbaar: kan niet — het spel stopt sowieso bij de 4e Koning; resterende kaarten vervallen.

== EXACTE KAARTVOLGORDE / WAARDEN (referentie voor implementatie) ==
Rang-volgorde (laag->hoog) en hun effect-id:
2=uitdelen(1 slok) | 3=zelf drinken(1) | 4=categorie | 5=duim-master(rol) | 6=drinkmaatje(rol) | 7=tafel van 7 | 8=regel verzinnen(stapelt) | 9=regel afschaffen | 10=quizmaster(rol, max 1) | Boer=wijzen/stemmen(2 slokken) | Vrouw=rise of the queen(rol) | Heer=koningsbeker(4e=verlies+einde) | Aas=omkeren.
Aantallen per rang: 4 kaarten per rang x 13 rangen = 52. Er zijn dus precies 4 Koningen (de eindtrigger) en 4 Azen (omkeren).
Puntwaarden: het spel kent GEEN puntentelling. Voor een digitale pseudo-score kan de app optioneel 'aantal slokken per speler' bijhouden; dit is geen onderdeel van de officiele regels.

### Implementatie-ontwerp
- **State-model:** KingsenState (geheim, host-only). Velden: config (KingsenConfig: playerCount 2-12, alcoholfree-mode bool, hardcoreCircleBreak bool, optionele sip-tracking bool); seed. ring: CardId[] in cirkelvolgorde (52 kaarten, jokers verwijderd, geschud) — open kaarten worden eruit gehaald, lege plekken markeren 'gaten' (voor cirkel-breken). drawnCount; lastDrawn: Card|null. direction: 1|-1 (klokrichting; Aas keert om). turn: Seat (huidige speler in de ring; 0..playerCount-1, NIET de Kingen-Seat-0..4-beperking — type Seat moet verbreed). centralCupLevel: number (scheuten/koningen erin, 0..3). kingsDrawn: 0..4. roles: { thumbMaster: Seat|null; queen: Seat|null; quizMaster: Seat|null; drinkBuddies: Record<Seat,Seat> (trekker->maatje, vervangbaar) }. activeRules: { id, bySeat, text }[] (8-regels stapelen, 9 schaft af). sips: Record<Seat,number> (optionele pseudo-score). phase: 'playing'|'finished'. loserSeat: Seat|null (trekker van 4e koning). Geen handen, geen slagen, geen troef — puur centrale ring + rollen + regels.
- **Move-types:** drawCard, assignSip, chooseDrinkBuddy, ackEffect
- **Nieuwe events:** cardDrawn (seat, card, effectId), sipAssigned (from, to, amount, reason), roleChanged (role: thumbMaster|queen|quizMaster, seat|null), drinkBuddySet (owner, buddy), houseRuleAdded (ruleId, bySeat, text), houseRuleRemoved (ruleId), cupPoured (seat, kingOrdinal 1..4, newLevel), directionReversed (newDirection), circleBroken (seat), miniGameStarted (kind: category|countTo7|jackVote|...) — optioneel/cosmetisch, kingsenLost (seat, drankAmount=cup) → tevens gameEnd
- **PublicGameView-extensies:** centralCupLevel + kingsDrawn (beker/koningen-teller), ringRemaining + ringLayout (open/dicht per positie voor 3D-cirkel), direction (klok/tegenklok-indicator), roles {thumbMaster, queen, quizMaster}, drinkBuddies (koppelingen), activeRules[] (lijst 8-regels), lastDrawn {card, effectId, effectLabelKey}, sips per seat (optionele pseudo-score), alcoholfreeMode flag voor symbolische vulling, playerCount kan >5 (huidige Seat=0..4 en handSizes/trickCounts-arrays zijn te smal)
- **UI-behoeften:** Nieuwe 3D-render: kaartcirkel rondom een centrale beker i.p.v. handen+slagentafel; trek-animatie (kaart uit ring omdraaien naar centrum); beker vult zich zichtbaar; gevelde koningen tegen de beker, HUD-plugin: richting-indicator (pijl klok/tegenklok), koningen-teller (x/4), beker-niveau, actieve-rollen-badges (duim-master/queen/quizmaster), drinkmaatjes-koppelingen, stapel actieve 8-regels, Keuzedialogen-plugin: 'kies speler' (2=uitdelen, 6=drinkmaatje, Boer-stem), vrije-tekst-invoer (8=regel verzinnen, 4=categorie-naam), 'kies af te schaffen regel' (9), Effect-toast/aankondiging per getrokken kaart (grote kaart-uitleg, hergebruik bestaande announcement-overlay), Verlies-/eind-scherm: 'jij moet de beker leegdrinken', Alcoholvrij-modus toggle + symbolische teksten, Sociale mini-spellen (categorie, tafel-van-7, wijzen) zijn fysiek/sociaal: app toont alleen instructie + 'wie dronk?'-knop, geen volledige engine-afhandeling nodig, Waarschuwing bij 2-3 spelers (sociale opdrachten minder leuk)
- **AI-aanpak:** Geen strategische AI (conform AI-beleid: Kingsen = regel-uitvoering). De AI-strategie is een triviale 'regel-AI' die chooseMove implementeert: bij drawCard altijd de enig-legale zet (pak de volgende/willekeurige nog-dichte kaart uit de ring); bij keuze-zetten (2=uitdelen, 6=drinkmaatje, Boer-stem) kiest hij uniform-random een geldige medespeler (lichte voorkeur: niet zichzelf); bij 8=regel-verzinnen trekt hij uit een vaste tekstenpool ('niet vloeken', 'niet met links drinken', ...); bij 9 schaft hij een willekeurige actieve regel af. Geen determinisatie, geen Monte-Carlo, geen evaluatie — er is geen verborgen informatie die ertoe doet en geen winstmaximalisatie (verliezen is puur kanskwestie: wie de 4e koning trekt). Denkvertraging via bestaande AiPlayer.think() voor natuurlijk tempo. Sociale mini-spellen worden door de app/host afgehandeld (of overgeslagen met directe 'wie dronk?'-uitkomst), niet door de AI gesimuleerd.
- **Hergebruik:** Direct hergebruik zonder wijziging: createRng/shuffle/createDeck (core/deck.ts) voor de ring; EventBus (core/events.ts); ScoreSheet (core/scoresheet.ts) voor de optionele slokken-pseudo-score; AiPlayer.think()-tempo (core/player.ts); volledige server-room-laag (room.ts: stoeltoewijzing, AI-fill, reconnect+snapshot, chat, host-start, zet-time-out) werkt game-agnostisch zodra de registry erin zit; GameHost-skelet (TurnManager+bus+controllers) blijft; client lobby (ui/lobby.ts), toasts+grote aankondigingen (ui/notifications.ts createNotifications), i18n-NL/EN (ui/i18n.ts), 3D-scene/kaarttextures/tween-engine (render/scene.ts, cardTextures.ts, animations.ts) als render-bouwstenen. integration.test-manual.ts is direct het testsjabloon (2 headless clients + AI via echt protocol). Kingen zelf (games/kingen/*) is GEEN template hier — Kingsen deelt geen slagen-logica; het deelt alleen het generieke GameDefinition-contract.
- **Risico's:** Phase-0-blokkers MOETEN eerst: (1) TurnManager.pickMove (turnManager.ts:97-153) hardcodet card/trump/roundKind-dispatch → generieke chooseMove(view, legalMoves) nodig; (2) PlayerController/AiStrategy (player.ts, ai/types.ts) generaliseren naar chooseMove; (3) protocol.requestMove.moveType is 'card'|'trump'|'roundKind' (protocol.ts:84) → generiek maken (moveType:string + legalMoves payload); (4) game-registry + DI i.p.v. createKingenDefinition() in gameHost.ts:39 en gameId/DEFAULT_VARIANT-hardcoding in room.ts. Zonder deze is Kingsen niet aansluitbaar., Seat-type is 0..4 (types.ts:82) en view-arrays (handSizes/trickCounts/totals) zijn slag-georiënteerd; Kingsen wil 2-12 spelers → Seat verbreden naar number en PublicGameView ontslaan van verplichte slag-velden (optioneel maken) of per-spel-view toestaan., PublicGameView dwingt currentTrick/completedTricks/hand/legalCards af (types.ts:172-212) die voor Kingsen leeg/zinloos zijn → view-contract moet flexibeler (game-specifieke view via generics of optionele velden), anders veel dummy-data., Veel opdrachten zijn fysiek-sociaal (duim-master, rise-of-the-queen, tafel-van-7, categorie, wijzen): de engine kan ze niet echt 'spelen' — risico op scope-creep als je ze digitaal probeert af te dwingen; afbakening: app toont instructie + handmatige 'wie dronk'-resolutie., Alcohol/verantwoord-gebruik: alcoholvrije modus en leeftijdsdisclaimer verplicht; UX-risico bij publicatie/stores., Nieuwe ring-render (cirkel + centrale beker) is de grootste echte bouwopgave; bestaande scene gaat uit van handen+slagentafel., Aas bij 2 spelers / cirkel-breken / lege-beker-bij-1e-koning zijn expliciete randgevallen uit de regelset die getest moeten worden.

## Ezelen

- **Engelse naam:** Pig (ook bekend als Donkey, Spoons, Tongue; Frans: Bouchon). Bevestigd door Pagat, en.wikipedia, Bicycle en gamerules — allemaal identiek mechaniek (vier gelijke kaarten verzamelen door gelijktijdig naar links door te geven, signaal/neus aanraken, laatste verliest, strafletters P-I-G).
- **Familie:** match-snelheid · **Complexiteit:** 4/5 · **Effort (na Phase 0):** 9-13 mensdagen na Phase 0 (Phase 0 = game-registry + DI + generieke move-dispatch + simultane/tick-loop-modus, apart). Uitsplitsing: engine+tick-loop+regels 3-4d; AI-heuristiek+tempo/oplettendheid-model 1-2d; protocol-uitbreiding (tickStart, signaal-timing, strafletters in view) + server-room real-time/autoritatieve klok 2-3d; client (real-time HUD, doorgeef-animatie, signaal-knop/lepels, strafletter-scorebord, i18n) 3-4d; integration-test + balancing tempo 1d. Verhoogd risico door de simultane/real-time aard en 3-13 spelers. · **Vertrouwen regels:** hoog

**Gekozen variant:** Canoniek geïmplementeerd: standaard Ezelen met 4 kaarten per hand, gelijktijdig doorgeven naar LINKS (oppakken van rechts), pre-afgesproken signaal (default 'hand op tafel'), strafletters E-Z-E-L (4 levens), en speleinde zodra de eerste speler EZEL compleet maakt (= de ezel, spel klaar). Reden: dit is de meest gangbare en best leerbare Nederlandse variant, bevestigd door 4 onafhankelijke NL-bronnen (nl.wikipedia, kubuspuzzel, regels.nl, spellenfans) en consistent met het internationale Pig (Pagat/en.wikipedia/Bicycle/gamerules). Voor een digitale implementatie is dit het eenvoudigst en eerlijkst: één duidelijk eindpunt, vaste 4-letter-progressie, en deterministische verliezerbepaling (laatste signaal). Eliminatie-einde, langere strafwoorden, 5-kaart Donkey, stock- en lepelvariant zijn als optionele schakelaars gedocumenteerd maar niet de default.

### Canonieke regels
EZELEN — CANONIEKE REGELSET (implementeerbaar)

== Spelers ==
- 3 t/m 13 spelers (begrensd door 13 kaartwaarden in één deck; meer mogelijk met extra decks). Ideaal: 4-7. Minimaal 3.

== Kaarten / opstelling ==
- Standaard 52-kaartspel zonder jokers.
- Aantal kwartetten = aantal spelers. Per speler precies één kaartwaarde, in alle vier de kleuren (harten/ruiten/klaveren/schoppen).
- Conventie voor welke waarden bij N spelers: tel af vanaf de hoogste, dus aas, heer, vrouw, boer, 10, 9, ... Voorbeeld N=4 → A,H,V,B (16 kaarten). N=5 → A,H,V,B,10 (20 kaarten).
- Schud uitsluitend deze N*4 kaarten en deel ze één voor één uit, zodat iedere speler exact 4 kaarten heeft. Overige kaarten doen niet mee.
- Spelers zitten in een kring. Iedereen bekijkt enkel de eigen hand.
- Vooraf één gemeenschappelijk SIGNAAL afspreken (canoniek: "hand plat midden op tafel leggen", waarop iedereen zo snel mogelijk zijn hand bovenop stapelt). Alternatieven (duim op tafelrand / vinger op de neus / oorlel aanraken) zijn equivalent; kies er één per spel.

== Doel ==
- Als eerste een volledig kwartet hebben: vier kaarten van dezelfde waarde (alle vier kleuren) in de hand.

== Verloop van een ronde (gelijktijdig, ritmisch) ==
1. Iedereen speelt TEGELIJK; er is geen beurtvolgorde. Eén speler telt af ("drie, twee, één, nu").
2. Bij elke ronde-tik: elke speler legt één ongewenste kaart GESLOTEN voor zich neer en schuift die naar de buurman LINKS; tegelijk pakt elke speler de kaart op die de buurman RECHTS heeft neergelegd. (Doorgeven naar links = ontvangen van rechts = met de klok mee.)
3. RANDGEVAL volgorde: altijd eerst afleggen, dan oppakken. Je mag NOOIT meer dan 4 kaarten tegelijk in de hand hebben.
4. Het doorgeven herhaalt zich ritmisch en zo snel mogelijk (richttempo ~elke 3 seconden; trager voor kinderen, sneller voor volwassenen — geen harde regel).
5. RANDGEVAL te traag/uit tempo: speler krijgt eerst één WAARSCHUWING; bij een tweede keer verliest die speler de ronde (krijgt direct een letter), ongeacht het signaal.

== Einde van een ronde (signaal) ==
6. Zodra een speler vier gelijke kaarten heeft, STOPT die met doorgeven/oppakken en geeft onopvallend het afgesproken signaal (bv. hand op tafel).
7. Andere spelers mogen het signaal ook geven zodra zij het OPMERKEN — óók als zij zelf nog geen kwartet hebben (oplettendheid wordt beloond, afleiding bestraft).
8. RANDGEVAL: de LAATSTE speler die het signaal uitvoert verliest de ronde. (In de lepel-/Spoons-variant: wie geen lepel/fiche bemachtigt verliest.)
9. RANDGEVAL gelijktijdig laatste: indien onbeslist, ronde overspelen, of de scheidsrechter/host wijst de traagste aan.

== Score / strafletters ==
- Geen positieve punten. De ronde-verliezer krijgt één letter van het woord EZEL, in vaste volgorde: 1e verlies = E, 2e = Z, 3e = E, 4e = L.
- Vier verloren rondes = "EZEL" compleet.

== Speleinde (canoniek) ==
- Het spel eindigt zodra de EERSTE speler het woord EZEL compleet heeft (4 verloren rondes). Die speler is "de ezel" en heeft definitief verloren; alle anderen winnen gezamenlijk. Eventueel voert de ezel een strafopdracht uit.

== Optionele varianten (niet-canoniek, schakelbaar) ==
- Eliminatie-einde: bij compleet woord valt die speler af en wordt doorgespeeld tot één winnaar overblijft (Pagat/gamerules).
- Langer strafwoord (DONKEY/SPOONS = 6 levens) voor langere spelduur.
- Donkey 5-kaart (Australisch): 5 kaarten per hand, dus 5 gelijke kaarten nodig.
- Stock-variant (Pagat): volledig 52-kaartdek, alleen de deler trekt uit een stapel rechts van zich en legt door; niet zuiver gelijktijdig.
- Lepel-/Spoons-variant: N-1 lepels/fiches in het midden; grijpen i.p.v. signaal.

### Implementatie-ontwerp
- **State-model:** Ezelen is een SIMULTAAN, REAL-TIME spel zonder beurtvolgorde; het past slecht in de turn-based engine en vraagt een eigen state-model. Velden: config (EzelenConfig: playerCount 3-13, handSize=4 [variant 5], strafwoord='EZEL'|'DONKEY'|'SPOONS', passInterval ms (richttempo ~3000), warningsBeforeLoss=1, endMode 'firstComplete'|'elimination', spoonsMode bool); seed; phase ('dealing'|'passing'|'roundResolving'|'roundFinished'|'gameFinished'); rng. Per-ronde: hands: Card[][] per seat (precies handSize, alleen N*4 afgeteld vanaf aas), pendingPass: (Card|null)[] per seat (de dichtgelegde kaart die naar links schuift), passTick: number (ritme-teller), roundClockStart ms. Signaal/reactie: signaledOrder: Seat[] (volgorde waarin spelers het signaal gaven, real-time), quartetHolder: Seat|null (eerste met kwartet — triggert het signaal), reactionDeadlines per seat. Tempo-administratie: warnings: number[] per seat, missedTicks per seat (te traag). Score: letters: number[] per seat (0..woordlengte; verloren rondes), eliminated: boolean[] (eliminatie-variant). totals afgeleid uit letters. Belangrijk: state moet TIJD bevatten (timestamps), wat nieuw is t.o.v. alle bestaande spellen die puur zet-gedreven zijn.
- **Move-types:** passCard, giveSignal, grabSpoon, ackTick
- **Nieuwe events:** roundTickStart (nieuwe ritme-tik begint; alle spelers leggen tegelijk af), cardsPassed (gelijktijdige doorgave: elke seat legt af naar links / pakt van rechts), quartetCompleted (een speler heeft 4 gelijke kaarten — signaal-fase opent), signalGiven (seat gaf het afgesproken signaal; met volgorde/tijdstip), spoonGrabbed (lepel-variant: seat pakte een lepel/fiche), tempoWarning (speler te traag — eerste waarschuwing), letterAwarded (ronde-verliezer krijgt letter E/Z/E/L), playerEliminated (eliminatie-variant), roundLoser (wie de ronde verloor en waarom: laatste signaal / strafwoord-tempo)
- **PublicGameView-extensies:** handSize (4 of 5; PublicGameView gaat impliciet uit van 13-kaarts slagspel), myHand met kwartet-detectie-hint, strafletters per seat (huidige EZEL-voortgang) — totals[] is ontoereikend, het zijn geen punten maar letters, strafwoord + woordlengte, signalState: is het signaal al gegeven? door wie? mag ik nu signaleren?, passClock/tickIndex + richttempo (ms tot volgende tik) — UI heeft een real-time klok nodig, pendingIncoming: aantal kaarten dat klaarstaat van rechts, spoons-state (aantal lepels nog beschikbaar), eliminated-vlag per seat. ONNODIG/leeg voor Ezelen: currentTrick, completedTricks, trickCounts, playedCards, round.trump, round.kind — die hele slag-substructuur is N.v.t.
- **UI-behoeften:** Real-time HUD i.p.v. beurt-HUD: aftel-/ritme-indicator (3-2-1-nu), zichtbare 'doorgeef-puls' elke ~3s, Hand van 4 (of 5) kaarten met duidelijke kwartet-highlight; kaart selecteren = naar links doorschuiven (één klik, geen beurt-wachttijd), Doorgeef-animatie nieuw: gesloten kaart schuift naar buurman-links, gelijktijdig komt er een van rechts (NIET de bestaande trick-naar-midden tween) — hergebruik wel de tween-engine in animations.ts, maar nieuw bewegingspad, Grote SIGNAAL-knop (hand-op-tafel) die real-time ingedrukt kan worden + visuele 'wie heeft al gesignaleerd' rij; in lepel-variant: grijpbare lepels in het midden, Strafletter-weergave E-Z-E-L per speler (i.p.v. scorebord met punten) — nieuwe scoreboard-variant, Ronde-uitslag-dialoog: 'X is de laatste / krijgt een letter', Tempo-waarschuwing-toast (hergebruik notifications.ts toasts), i18n-uitbreiding NL/EN voor alle nieuwe teksten
- **AI-aanpak:** Sterke HEURISTIEK + reactietijd-model; GEEN zoekgebaseerde AI (conform AI-beleid: Ezelen is laag-strategisch, imperfecte info is irrelevant want de winst zit in tempo/oplettendheid, niet in kaartcombinatoriek). (1) Afleg-heuristiek per tik: tel rangfrequenties in eigen hand; houd de rang met de meeste exemplaren (target-kwartet) vast; leg de meest 'eenzame' kaart af (laagste frequentie, bij gelijk willekeurig met seeded rng). Detecteer kwartet => zet phase-doel op signaleren. (2) Tempo-model: AI krijgt per moeilijkheid een reactietijd-verdeling (makkelijk: traag+ruis, kans op gemiste tik/waarschuwing; gemiddeld: ~richttempo; moeilijk: snel, lage variantie) — dit bepaalt WANNEER de passCard/giveSignal binnenkomt, niet WELKE. (3) Oplettendheid: kans p(opmerken) per moeilijkheid dat de AI het signaal van een ander oppikt en zelf snel signaleert (beloont oplettendheid). (4) Determinisatie n.v.t. — de AI hoeft geen onbekende handen te schatten; hij speelt puur op eigen hand + waarneembaar signaal. Implementatie: de bestaande AiStrategy.chooseMove-generalisatie levert {type:'passCard'|'giveSignal'}, met de reactievertraging in de bestaande think()-delay (uitgebreid met per-moeilijkheid spreiding).
- **Hergebruik:** DIRECT herbruikbaar: createDeck/createRng/shuffle/makeCard/cardFromId/sortHand (core/deck.ts) voor de afgetelde N*4-deck en seeded shuffle; deal() is bruikbaar mits deck=N*4 (deelbaar door N → ieder 4). GameDefinition-contract (core/types.ts), EventBus (core/events.ts), ScoreSheet (core/scoresheet.ts) generiek. Net-laag: Transport/NetMessage/RoomInfo.gameId, Room reconnect/AI-fill/personalize-skelet (server/room.ts) — personalize moet handen filteren (al aanwezig voor 'deal'). Client: 3D-tafel + kaart-meshes + textures (render/scene.ts, cards.ts, cardTextures.ts), tween-engine in animations.ts (nieuw pad nodig), toasts/aankondigingen (notifications.ts), lobby (ui/lobby.ts), i18n-infra (ui/i18n.ts), integration-test-template (server/integration.test-manual.ts). AiPlayer think()-delay (core/player.ts) past perfect bij het reactietijd-model. NIET herbruikbaar: trickWinner/Trick-model, TurnManager.pickMove() (hardcodet card/trump/roundKind én is beurt-gebaseerd; Ezelen is simultaan — er is geen 'currentActor'), HUD-slagentellers/troef, chooseTrump-dialoog, requestMove.moveType-union.
- **Risico's:** FUNDAMENTEEL: TurnManager + GameDefinition.currentActor zijn strikt beurt-sequentieel; Ezelen is simultaan en real-time. Ófwel de engine moet een 'simultane/tick-gedreven' loop-modus krijgen (host stuurt tikken op een timer, verzamelt alle passCard-zetten per tik), ófwel Ezelen draait buiten TurnManager met een eigen tick-scheduler. Dit is de grootste architectuurbeslissing en hoort in Phase 0., Real-time over het net: latency/fairness bij het SIGNAAL (wie was écht laatst?). Server moet autoritatief tijd-stempelen; clients kunnen niet vertrouwd worden. Randgeval 'gelijktijdig laatst' (overspelen / host wijst aan) moet expliciet., Tempo-/waarschuwingsregel (te traag → letter) vereist een server-klok per speler en is lastig eerlijk te maken met wisselende latency; overweeg dit als optionele/uitschakelbare regel in v1., requestMove is request-response (één zet per verzoek); een simultaan tik-model past daar niet in — protocol-uitbreiding nodig (bv. tickStart-broadcast + ongevraagde passCard-zetten met server-side dedup per tik)., PublicGameView.totals is numeriek-score-georiënteerd; strafletters/EZEL-voortgang en eliminatie passen er niet natuurlijk in → view-uitbreiding of een per-spel view-extensie nodig., Speleraantal 3-13 overschrijdt de Seat-type aanname (max 5 stoelen, ALL_SEATS=0..4) en de 3D-tafel-layout die op 3-5 stoelen is ontworpen — Seat-type en tafel-rendering moeten verruimd worden., 'Leuk' maken zonder fysieke gelijktijdigheid: in een digitale versie verdwijnt de chaos; ontwerpkeuze nodig (vaste tik-klok met inzend-venster) die het spel speelbaar én eerlijk houdt.

## Rikken

- **Engelse naam:** Geen breed gangbare Engelse naam. pagat.com (de gezaghebbende Engelstalige kaartspel-encyclopedie) noemt het 'Rik'. In de praktijk wordt internationaal simpelweg 'Rikken' of 'Rik' gebruikt; het is verwant aan/afgeleid van het oudere 'Boston'. Bevestigd: gebruik 'Rikken' (NL) / 'Rik' (EN, pagat).
- **Familie:** slagenspel · **Complexiteit:** 4/5 · **Effort (na Phase 0):** 14-20 mensdagen na Phase 0 (registry + generieke move-dispatch + protocol/view-generalisatie). Uitsplitsing: engine-statemachine met biedfase 3-4d; canonieke biedrangorde + legale-boden-regels 2d; speelregels (port van Kingen legalCards, Rikken-toggles) 1d; maat/partner-mechaniek incl. verborgen onthulling 2d; puntentelling Stichting+huiskamer (tabelgedreven) 2-3d; open/pass-spellen (Schoppen Mie, 1-of-5, open piek/misère-timing) 2-3d; bied-HUD + maat-dialoog + open-hand-render client 2-3d; ISMCTS-AI (determinisatie met void-constraints + biedheuristiek) 3-4d; integratietest hele partij + tuning 1-2d. Bandbreedte hangt vooral af van hoeveel optionele varianten (troela, open-met-praatje, huiskamerschaal) in scope blijven. · **Vertrouwen regels:** hoog

**Gekozen variant:** Canonieke implementatie = STICHTING RIKKEN 2025 (IWWA / Stichting Rikken, NK-toernooistandaard). Reden: (1) het is een expliciet vastgelegde, eenduidige en intern-consistente regelset mét bijbehorend puntenblad — geen 'varieert per streek'-vaagheid; (2) het is de breedst erkende Nederlandse standaard (nationale kampioenschappen) en dus het meest 'gangbaar' en leerbaar; (3) de rangorde en open-timing worden onafhankelijk bevestigd door thegameroom.org en wikibooks. Voor de meeste speelbaarheid/leukheid in een app: rik+maat, beter rik, 8-13 alleen, piek, misère als kern; open varianten en passspellen (schoppen mie, 1-of-5) als inschakelbare uitbreidingen; troela als optionele klassieke regel (in toernooi uitgeschakeld). Puntenschaal Stichting als default, huiskamerschaal als alternatief — beide configureerbaar.

### Canonieke regels
CANONIEKE REGELSET RIKKEN (NL) — direct implementeerbaar. Basis: Stichting Rikken 2025 (toernooistandaard) als primaire bron, aangevuld met pagat.com voor randgevallen. Twee puntenschalen leverbaar; de Stichting-schaal is canoniek.

== SPELERS & KAARTEN ==
- Precies 4 spelers (elk voor zichzelf, met wisselende allianties per ronde). Met 5 zit er telkens 1 stil (deler-1 of volgens afspraak).
- Eén pak van 52 kaarten, geen jokers. Iedereen krijgt 13 kaarten.
- Kaartvolgorde per kleur HOOG→LAAG: A, K(Heer), V(Vrouw/Dame), B(Boer), 10, 9, 8, 7, 6, 5, 4, 3, 2. Aas hoog, 2 laag.
- Harten is de "betere kleur" en staat boven de andere kleuren (relevant bij rangorde van rik vs. beter rik en bij de "beter alleen"-varianten).

== DELEN ==
- Deelvolgorde gaat MET DE KLOK MEE (deelbeurt schuift elke ronde één plaats naar links/met de klok mee).
- De kaarten worden MAXIMAAL 1× geschud (toernooi: bij voorkeur alleen afpakken/couperen/heffen, niet doorschudden — men deelt uit de stapel van de vorige ronde). In de implementatie: maak schudden configureerbaar; default = niet/één keer schudden.
- Delen in pakketjes 6/7 of 7/6 (of 4-5-4), eindresultaat 13 per speler.

== BIEDEN ==
- Speler LINKS van de deler begint; bieden gaat met de klok mee. Wie eenmaal past, mag niet meer bieden en kan niet meer op latere (hogere) boden reageren.
- Openingsboden (laagste niveau): RIK (8 slagen), PIEK (1 slag), MISÈRE (0 slagen). Andere spelsoorten zijn opboden hierboven.
- Elk opbod moet precies één trede hoger zijn volgens de vaste rangorde (zie RANGORDE). Bijv. "9 alleen" mag pas geboden worden nadat een tegenspeler "8 alleen" heeft geboden.
- "Alleen"-boden (solo) mogen ALLEEN als er in de biedronde minstens 1× "rik" geboden is.
- Bieden eindigt zodra 3 spelers gepast hebben; de overgebleven bieder krijgt het contract.
- Bij PIEK en MISÈRE mogen meerdere nog-niet-gepaste spelers HETZELFDE bod claimen ("meepieken"/"meemisèren"); ieder speelt dan voor zich. Zodra één van hen het doel mist, stopt het spel direct.
- Als IEDEREEN past: de deler (laatste bieder) MOET kiezen tussen twee passspellen: "Schoppen Mie" of "1 of 5" (zie PASSSPELLEN).

== MAAT MEEVRAGEN (rik / beter rik) ==
- De bieder kiest eerst de troefkleur (bij beter rik = harten verplicht). Daarna vraagt hij een AAS mee van een NIET-troefkleur waarvan hij ZELF GEEN aas heeft maar wél minstens... (zie randgeval). De houder van die aas is de geheime maat; zijn identiteit blijft verborgen tot die aas valt. 2 tegen 2; rikker+maat moeten samen ≥8 slagen.
- De gevraagde aas-kleur moet door de bieder bespeelbaar zijn: zie randgeval "blind".
- Uitzondering ALLE AZEN: heeft de bieder zelf alle 4 azen, dan vraagt hij in plaats daarvan een KLEUR-KONING (heer) mee als maat.

== TROELA (optioneel; NIET in toernooi) ==
- Wie 3 azen in handen heeft, MOET dit melden (verplicht), tenzij vooraf afgesproken dat troela niet gespeeld wordt. De houder van de 4e aas wordt automatisch de maat.
- De houder van de 4e (enkele) aas bepaalt de TROEFKLEUR, maar mag GEEN troef maken van de kleur van zijn eigen aas.
- Doel: rikker + maat samen ≥8 slagen. Puntentelling = identiek aan gewone rik (in toernooi-puntenblad staat troela onder de rik-kolom, "eventueel troela", normale telling).

== SPELEN ==
- De uitkomer (eerste slag: speler links van de deler; daarna de winnaar van de vorige slag) speelt elke gewenste kaart.
- Met de klok mee legt iedereen 1 kaart.
- KLEUR BEKENNEN IS VERPLICHT: heb je de uitgekomen kleur, dan moet je die bijspelen. Heb je de kleur niet, dan mag je een willekeurige kaart spelen (troeven of afgooien). TROEVEN IS NIET VERPLICHT. Bekennen geldt ook voor de troefkleur als die uitgekomen wordt.
- Komt de kleur van de gevraagde aas op tafel, dan MOET de maat die gevraagde aas (of heer) spelen → maat wordt bekend.
- Slag winnen: hoogste troef erin wint; ligt er geen troef, dan de hoogste kaart van de uitgekomen kleur. Winnaar komt uit op de volgende slag. 13 slagen totaal.

== SPELSOORTEN (doelen) ==
- RIK / BETER RIK: rikker+maat ≥8 slagen. Beter rik = harten verplicht troef (hoger bod dan gewone rik).
- X ALLEEN (8/9/10/11/12/13) + "beter"-variant: solo zonder maat, bieder kiest troef en belooft ≥X slagen (13 alleen = alle 13, troef verplicht). "Beter"-variant = harten troef, telt hoger.
- PIEK: bieder moet EXACT 1 slag halen (niet 0, niet 2+). Zonder troef. Bij >1 of 0 slagen: nat.
- MISÈRE: bieder mag 0 slagen halen. Zonder troef. Bij ≥1 slag: nat (spel stopt direct).
- OPEN PIEK / OPEN MISÈRE (met en zonder "praatje"): zelfde doelen, maar open spelen — zie OPEN.
- 13 ALLEEN / "beter": solo slem, alle 13 slagen, hoogste reguliere boden.

== OPEN SPELEN (timing — canoniek per Stichting Rikken) ==
- Open piek: de bieder komt ZELF uit en legt zijn kaarten open NA DE 5e GESPEELDE KAART (dus na de 1e slag + 1e kaart van de 2e slag). Bij twee open piekers: 1e bieder komt eerst uit, daarna 2e; na de 9e kaart leggen alleen de twee piekers open.
- Open misère: de open-misèrder bepaalt wie uitkomt; legt NA DE 5e KAART alleen zíjn eigen kaarten open.
- "MET EEN PRAATJE": idem timing, maar NÁ het openleggen mogen de tegenstanders/spelers open over hun kaartkeuze overleggen. Hoger bod en hogere uitbetaling.
- (pagat.com variant: open na voltooien 1e slag. Canoniek = na 5e kaart, want dat is de toernooistandaard.)

== PASSSPELLEN (iedereen past) ==
- SCHOPPEN MIE (Schoppenvrouw): vermijd de Schoppen Vrouw (Mie) EN de laatste slag. In de eerste 3 slagen mag GEEN schoppen gespeeld worden. Wie Schoppen Vrouw heeft moet die, na de 3e slag, spelen bij de eerste keer dat hij de gevraagde kleur niet kan bekennen. Telling: -5 p.p. voor wie Schoppen Mie haalt, -5 p.p. voor wie de laatste slag haalt; beide tegelijk = -10 p.p. (max -30).
- 1 OF 5: ieder probeert exact 1 OF exact 5 slagen te halen. Wie dat haalt wint en ontvangt 10 van elke verliezer. Alleenwinnaar: +30 (3×10); twee winnaars elk +20 (2×10); enige verliezer betaalt -30.

== WIE BETAALT BIJ NAT GAAN (rik) ==
- Bij verlies van een rik/beter rik betaalt de RIKKER ALLEEN; de meegevraagde maat krijgt/betaalt 0. (Bij troela: normale telling, beiden in winst delen maar idem regel bij verlies per puntenblad.)
- Bij geslaagde rik delen rikker en maat de winst gelijk.

== EINDE ==
- Een ronde eindigt na 13 slagen (of eerder bij piek/misère zodra het doel definitief gemist is, of bij open zodra uitkomst vaststaat). Daarna afrekenen.
- Het hele spel heeft geen vast natuurlijk einde: speel een afgesproken aantal rondes / een "boompje" (iedereen evenveel keer gedeeld) / tot een tijd- of puntentotaal. Toernooi: vast aantal gevingen, hoogste totaal wint.

== EXACTE PUNTENTELLING — Stichting Rikken 2025 (CANONIEK) ==
Bedragen zijn PUNTEN PER (verliezende/winnende) TEGENSPELER. Bij geslaagde rik krijgt elk van de partij het bedrag van elk van de tegenstanders; bij verlies betaalt de bieder(spartij) aan elk. Onderstaand zijn de waarden bij het EXACT halen van het beloofde aantal; per overslag stijgt het, per onderslag daalt/keert het (lineaire schaal uit het puntenblad).

RIK (8 slagen): geslaagd 8=+10, 9=+15, 10=+20, 11=+25, 12=+30, 13=+70 (boom/alle slagen-bonus). Verlies: 7=-10, 6=-15, 5=-20, 4=-25, 3=-30, 2=-35, 1=-40, 0=-45. (Stap = 5 per slag; alle 13 = +70.) Rikker betaalt alleen bij verlies.

BETER RIK / 8 ALLEEN: 8=+30, 9=+45, 10=+60, 11=+75, 12=+90, 13=+105. Verlies: 7=-10, 6=-15, 5=-20, 4=-25, 3=-30, 2=-35, 1=-40, 0=-45. (basis 30, +15 per overslag.)

9 ALLEEN (& beter/piek-kolom): 9=+60, 10=+75, 11=+90, 12=+105, 13=+120. Verlies (8..0): -25,-30,-35,-40,-45,-50,-55,-60 (oplopend -5 per onderslag, basis bij 8 = -20). (Kolom "9 Alleen & Piek".)

10 ALLEEN (& misère): 10=+90, 11=+105, 12=+120, 13=+135. Verlies 9..0: -30 t/m -75 (per onderslag -5). 

11 ALLEEN (& open piek): 11=+120, 12=+135, 13=+150. Verlies 10..0: -40 t/m -90.

12 ALLEEN (& open misère): 12=+150, 13=+165. Verlies 11..0: -50 t/m -105.

13 ALLEEN (& beter): 13=+210. Verlies 12..0: -70 t/m -130 (per onderslag -5, basis -70).

VASTE (niet-per-slag) SPELSOORTEN — geslaagd = +bedrag p.p., gefaald = -bedrag p.p.:
- PIEK: 45 (geslaagd +45, gefaald -45).
- MISÈRE: 75.
- OPEN PIEK: 120.
- OPEN MISÈRE: 150.
- OPEN PIEK MET PRAATJE: 165.
- OPEN MISÈRE MET PRAATJE: 180.
(Bij meerdere piekers/misèrders verschuift de verdeling zoals in het puntenblad: bv. 2 spelers piek: winnaar +30 p.p. van de twee verliezers etc.; implementeer als "elke geslaagde ontvangt het bedrag van elke gefaalde, elke gefaalde betaalt aan elke geslaagde".)

== ALTERNATIEVE PUNTENSCHAAL (huiskamer; configureerbaar, NIET canoniek) ==
spelletjesbeest/gangbaar: rik 8=+10 +5/overslag; 8 alleen +10 (+5/slag); 9/10/11/12/13 alleen ≈ +20/+30/+40/+50/+70; piek ±15; misère ±25; open piek ±40; open misère ±50; met praatje hoger. Maat betaalt niets bij nat gaan.

== IMPLEMENTATIE-NOOT ==
Maak twee dingen configureerbaar: (1) puntenschaal (Stichting vs. huiskamer), (2) of troela/open/passspellen meedoen. Default-canoniek = Stichting Rikken 2025.

### Implementatie-ontwerp
- **State-model:** RikkenState (uitbreiding van het Kingen-state-patroon, 4 spelers vast, 52 kaarten, 13 p.p.).
Kernvelden:
- config: RikkenVariantConfig (puntenschaal 'stichting'|'huiskamer'; toggles troela/open/passspellen; schudbeleid).
- phase: 'dealing' | 'bidding' | 'choosingTrump' | 'askingAce' | 'playing' | 'roundFinished' | 'gameFinished'.
- players, seed, dealer, roundIndex; hands[seat], currentTrick, completedTricks, trickCounts, turn (alle direct uit Kingen overgenomen).
- trump: Suit | null.
- bidding: { passed: boolean[]; highestBid: BidLevel | null; highestBidder: Seat | null; current: Seat; multiPiekMisere: Seat[] } — BidLevel is een geordende enum (RIK, PIEK, MISERE, 8ALLEEN, 9ALLEEN... 13ALLEEN, BETER-varianten, OPEN PIEK/MISERE, met/zonder praatje) met vaste rangwaarde voor 'precies één trede hoger'.
- contract: { kind: RikkenContractKind; declarer: Seat; trump: Suit | null; target: number; partnerAce?: CardId; partner?: Seat | null (verborgen tot de aas valt); openSeats?: Seat[]; passGame?: 'schoppenMie' | 'eenOfVijf' }.
- partnerRevealed: boolean; openRevealStartCardCount: number (timing 'open na 5e kaart').
- passGameState: { spadesBannedUntilTrick: number } voor Schoppen Mie.
- scoresPerRound, totals (cumulatief; som per ronde is nulsom per-tegenstander-telling).
Toelichting: bijna 1-op-1 hetzelfde slag-substraat als KingenState; de nieuwe substantie zit volledig in bidding + contract + partner-mechaniek.
- **Move-types:** bid (BidLevel of pass) — biedfase, chooseTrump (Suit) — declarer kiest troef na gewonnen bod, bij beter rik harten verplicht, askAce (CardId van niet-troef-aas, of bij 4 azen een heer) — maat-meevraag, playCard (Card) — kleur bekennen verplicht, troeven niet verplicht, choosePassGame ('schoppenMie' | 'eenOfVijf') — alleen als iedereen past; deler kiest, revealHand — open piek/misère: declarer legt open na 5e kaart (kan ook engine-automatisch zonder expliciete zet)
- **Nieuwe events:** bidPlaced { seat; bid: BidLevel | 'pass' }, biddingEnded { declarer; contractKind; level }, aceAsked { declarer; askedCard: CardId }  (kleur publiek, houder verborgen), partnerRevealed { partner: Seat; card: Card }  (zodra de gevraagde aas/heer valt), contractSet { kind; declarer; trump: Suit | null; target: number; openSeats?: Seat[] }, handsRevealed { seat; cards: Card[] }  (open piek/misère na 5e kaart; 'met praatje'-flag), passGameChosen { chooser; passGame: 'schoppenMie' | 'eenOfVijf' }, contractResolved { declarer; made: boolean; tricksTaken: number }  (vroeg-stop bij piek/misère/open)
- **PublicGameView-extensies:** bidding: { current: Seat | null; passed: boolean[]; highestBid: BidLevel | null; highestBidder: Seat | null; legalBids: BidLevel[] }  (legalBids vervangt de huidige legalCards-only-aanpak voor de biedfase), contract: { kind; declarer; trump; target; partner: Seat | null (alleen ingevuld nadat onthuld); askedAceSuit?: Suit; openSeats?: Seat[]; passGame? } | null, revealedHands: Partial<Record<Seat, Card[]>>  (open piek/misère — andermans open hand zichtbaar), passGamePrompt: 'schoppenMie' | 'eenOfVijf' choices wanneer view.turn de deler is in pass-keuze, legalMoves-generalisatie: PublicGameView heeft nu alleen legalCards; nodig is een generiek legalMoves-veld (of legalBids naast legalCards) zodat de client de biedfase kan renderen zonder regelkennis
- **UI-behoeften:** Bied-HUD: knoppenrij/oplopende lijst met legale boden (rik/piek/misère/X alleen/beter/open/praatje) + pas-knop; toont wie al gepast is en het huidige hoogste bod — nieuw, hud.ts kent nu alleen slagentellers+troef, Maat-meevraag-dialoog: kies een niet-troef-aas (of heer bij 4 azen) — uitbreiding van de bestaande vraagTroef-dialoog in notifications.ts, Troefkeuze-dialoog: bestaande dialogs.vraagTroef herbruikbaar (bij beter rik vastgezet op harten), Contract-/partner-banner: toon lopend contract + doel (>=8 slagen / piek=1 / misère=0); maat-onthulling als toast via bestaande ui/notifications-aankondigingen, Open-hand-render: andermans open hand op tafel leggen (open piek/misère) — nieuwe render bovenop scene.ts/animations.ts (kaarten face-up bij een stoel), Pass-spel-keuzedialoog (Schoppen Mie / 1 of 5) — variant van de roundKind-dialoog, Per-ronde-afrekening: scorebord toont per-tegenstander-bedragen; bestaande scoresPerRound/totals-weergave volstaat grotendeels
- **AI-aanpak:** Zoekgebaseerd (determinisatie + Monte-Carlo / ISMCTS), conform AI-beleid voor de diepe biedslagenspellen.
SPELFASE (kaart kiezen): ISMCTS over gedetermineerde werelden. Determinisatie van onbekende handen = de 39 niet-zichtbare kaarten (52 - eigen 13) verdelen over de 3 tegenstanders met handgrootte-constraints en void-constraints afgeleid uit view.completedTricks (een stoel die niet bekende toen kleur X werd uitgekomen, krijgt geen kaarten van X toebedeeld); bij rik ook de bekende partner-aas (gevraagde kleur) als constraint zodra onthuld. Per simulatie wordt trickWinner (core/deck.ts) hergebruikt als rollout-evaluator; doelfunctie = contract-uitkomst (>=target voor declarer/maat; exact 1 voor piek; 0 voor misère; vermijd Schoppen Mie + laatste slag bij pass). 200-2000 playouts per zet, schaalbaar met difficulty.
BIEDFASE: features op de eigen 13-kaartshand (lengte per kleur, top-honneurs, azen, troefpotentieel, korte/lege kleuren) -> Monte-Carlo schatting van te verwachten slagen door N gedetermineerde werelden uit te spelen met een greedy/heuristische speler; vertaal verwachte slagen + variantie naar het hoogst veilige bod (rik bij ~>=5 eigen kansslagen + meevraagbare aas, piek/misère bij extreme handen). Het 'precies één trede hoger'-rangmodel beperkt de actieruimte tot pas of de eerstvolgende trede.
MAAT-MEEVRAAG: kies de niet-troef-aas-kleur waarin de bieder zelf het sterkst bijgekaart is (controle behoudt) volgens de canonieke randvoorwaarde.
Difficulty-schaal: 'makkelijk' = pure heuristiek zonder playouts; 'gemiddeld' = beperkte determinisatie (50-100 worlds); 'moeilijk' = volledige ISMCTS. Alles draait host-side (server), net als nu, en ziet uitsluitend de PublicGameView.
- **Hergebruik:** DIRECT hergebruiken zonder wijziging: core/deck.ts (createDeck, createRng, shuffle, deal, sortHand, trickWinner — trickWinner dekt 'hoogste troef anders hoogste in gevraagde kleur' exact); core/events.ts EventBus; core/scoresheet.ts; core/types.ts (Card/Suit/Rank/Seat/Trick/PublicGameView-substraat); GameDefinition-contract ongewijzigd implementeren. Het Kingen 'kleur bekennen + niet verplicht troeven'-blok in rules.ts:legalCards (regels 48-79) is het directe template voor Rikkens speelregels (Rikken = mustTrump/mustOvertrump=false). De engine.ts-structuur (beginRound/dealCards/applyPlayCard/finishRound/structuredClone-in-applyMove, deterministische roundSeed) wordt 1-op-1 als skelet gekopieerd; alleen de fase-machine krijgt bidding/askingAce ertussen. Server: GameHost/RemotePlayerController/Room/TurnManager-bedrading blijft staan zodra de registry + generieke move-dispatch er is. Client: scene.ts (3D-tafel+kaarten), animations.ts (deal/play/trickWon-tweens), lobby.ts, online.ts requestMove-loop, notifications.ts-dialogen, scorebord — allemaal herbruikbaar; alleen bied-HUD + open-hand-render nieuw. integration.test-manual.ts is het test-template voor een volledige Rikken-partij via het echte protocol.
- **Risico's:** TurnManager.pickMove() (core/turnManager.ts:97-153) hardcodet move-dispatch naar chooseCard/chooseTrump/chooseRoundKind; Rikkens bid/askAce passen niet -> generieke chooseMove(view, legalMoves) op PlayerController/AiStrategy nodig (raakt ook Kingen). Dit is een gedeelde-laag-wijziging met regressierisico voor Kingen., protocol.ts requestMove.moveType is de gesloten union 'card'|'trump'|'roundKind'; moet 'bid'|'askAce'|'passGame' krijgen of vervangen worden door een generiek moveType:string + legalMoves payload — anders kan de client de biedfase niet bedienen., PublicGameView mist legalMoves-generalisatie (alleen legalCards); zonder dit moet de client biedregels kennen, wat het no-regels-op-de-client-principe breekt., Biedrangorde-correctheid: het 'precies één trede hoger' + 'alleen-boden vereisen eerdere rik' + meepieken/meemisèren is foutgevoelig; vereist een waterdicht geordend BidLevel-model en veel tests., Per-tegenstander-puntentelling (Stichting-schaal met over-/onderslag-tabellen, rikker-betaalt-alleen, maat=0 bij verlies, meervoudige piek/misère-verdeling) is omvangrijk en moet datagedreven (tabellen) i.p.v. ad-hoc, anders onbeheersbaar., Verborgen-partner-informatie in getView: de maat mag niet lekken vóór de gevraagde aas valt; getView moet contract.partner pas onthullen na het partnerRevealed-event — informatielek-risico richting AI/clients., Open piek/misère timing ('open na 5e gespeelde kaart', met/zonder praatje) en vroeg-stop bij piek/misère wijken af van de normale 13-slagen-loop -> extra fase-overgangen en render-state., ISMCTS-rekentijd host-side bij meerdere gelijktijdige tafels kan de server belasten; playout-budget per difficulty moet begrensd worden.

## Klaverjassen

- **Engelse naam:** Klaverjas — bevestigd als de Engelse benaming voor exact deze Nederlandse 4-spelersvariant (en.wikipedia.org/wiki/Klaverjas). De bredere familie heet Jass/Belote; de nauw verwante 2-spelersvariant heet Klaberjass/Clobyosh/Bela (pagat.com/jass/bela.html), maar dat is NIET dezelfde 4-spelersvariant — die heeft o.a. een andere roemtelling (geen vier-gelijk) en een 501-race. Voor deze app is 'Klaverjas' de juiste Engelse naam.
- **Familie:** slagenspel · **Complexiteit:** 4/5 · **Effort (na Phase 0):** 9-13 mensdagen na Phase 0: engine (slag-loop op template) 1.5; legalCards over-/ondertroef + Rotterdams/Amsterdams 1.5; roem-detectie + telling 1.5; team-scoring + nat/pit 1.5; bieden/troef-bepaling (3 modi) 1; view-extensies + protocol/HUD/scoreboard team-aware 2; AI determinisatie-MC + bied-EV 2-3; tests (integration.test-manual + regel-unittests) 1.5. (Phase 0 — game-registry + generieke chooseMove + per-spel trickWinner-comparator — apart geschat, ~3-4 dagen, gedeeld over alle nieuwe spellen.) · **Vertrouwen regels:** hoog

**Gekozen variant:** Gekozen implementatie: de NEDERLANDSE 4-spelersvariant met (a) ROTTERDAMSE troefplicht als default en Amsterdams als instelbare schakelaar, (b) troefbepaling via verplicht draaien/willekeurig aanwijzen als default met optionele biedvariant, (c) 3-2-3 deelpatroon, (d) volledige Nederlandse roemtelling INCLUSIEF vier-gelijk (100) en vier-boeren (200). Motivatie: dit is de meest gangbare verenigings-/huiskamervariant in Nederland en daarmee het meest herkenbaar voor de doelgroep. Rotterdams is gekozen als default omdat de troefplicht onvoorwaardelijk en dus eenduidiger te implementeren en te leren is (geen 'kijk of de maat hoog staat'-logica nodig in de basis), terwijl Amsterdams als optie beschikbaar blijft voor wie dat prefereert. De volledige NL-roemtelling (met vier-boeren=200) is gekozen boven de uitgeklede internationale Clobyosh/Bela-telling omdat de app expliciet 'Klaverjassen' (NL) is, niet de buitenlandse 2-spelersfamilievariant. Voor de nat-telling is gekozen 'roem telt mee voor de helft', wat zowel speelbaar als de meest verbreide huisregel is.

### Canonieke regels
CANONIEKE REGELSET KLAVERJASSEN (Nederlandse 4-spelersvariant) — direct implementeerbaar.

== OPSTELLING ==
- 4 spelers, 2 vaste teams van 2; partners zitten tegenover elkaar (Wij = Noord/Zuid, Zij = Oost/West).
- Spel: 32 kaarten (7,8,9,10,Boer,Vrouw,Heer,Aas in klaveren, harten, ruiten, schoppen). Geen jokers.
- Delen: deler schudt; speler links van deler licht af; gedeeld wordt klokwijs in groepjes 3-2-3 (8 kaarten p.p.). 3-2-3 is de gangbare standaard; 4-4 is een huisregelvariant.
- Voorhand = speler links van de deler; die speelt de eerste slag uit. Na elke ronde schuift het deelrecht 1 plaats klokwijs door.

== KAARTVOLGORDE & PUNTWAARDEN (kaartpunten) ==
NIET-TROEF (hoog->laag, punten): Aas 11, Tien 10, Heer 4, Vrouw 3, Boer 2, Negen 0, Acht 0, Zeven 0.
TROEF (hoog->laag, punten): Boer 20, Negen 14, Aas 11, Tien 10, Heer 4, Vrouw 3, Acht 0, Zeven 0.
Som kaartpunten = 152. Plus 10 voor de laatste slag = 162 totale slag-/kaartpunten per ronde (excl. roem).
LET OP: de slagkracht/rangorde binnen troef wijkt af van niet-troef: in troef wint Boef > Negen > Aas > Tien > Heer > Vrouw > Acht > Zeven.

== TROEF BEPALEN (kies EEN methode, implementeer als instelling) ==
Aanbevolen canonieke methode (meest gangbaar/speelbaar): "verplicht draaien".
1) Na het delen draait de deler de bovenste resterende kaart om (of er wordt willekeurig een troefkleur aangewezen). Die kleur is troef voor de ronde. Het team van de voorhand is het "spelende"/"verplichte" team dat de ronde moet maken (>= helft + 1).
2) Optionele biedvariant ("Leids"): vanaf voorhand kan elke speler "pas" of "speel"; wie "speelt" kiest de troefkleur en diens team wordt het spelende team. Past iedereen, dan mag de voorhand (of laatste speler) alsnog vrij troef kiezen — verplicht spelen.
Huisregel: in de eerste ronde is soms vast klaveren troef; standaard NIET aanzetten tenzij ingesteld.

== BEURTVERLOOP / SLAG (8 slagen) ==
Voorhand speelt uit; daarna klokwijs. Per slag gelden, op volgorde van prioriteit:
1) BEKENNEN (volgplicht): heb je de gevraagde (uitgespeelde) kleur, dan MOET je die kleur bijspelen.
   - Sonderregel: is de gevraagde kleur TROEF, dan moet je niet alleen bekennen maar ook OVERTROEVEN (hoger troeven) indien je dat kunt; kun je niet hoger maar heb je wel troef, dan speel je een lagere troef bij (ondertroeven is hier toegestaan want je hebt geen keus binnen de kleur).
2) TROEFPLICHT: heb je de gevraagde (niet-troef) kleur NIET, dan moet je troeven.
3) OVERTROEFPLICHT: ligt er al troef in de slag, dan moet je OVERtroeven (hoger dan de hoogste troef die er ligt) als je een hogere troef hebt.
4) ONDERTROEVEN (lager troeven dan er al ligt) is VERBODEN, BEHALVE wanneer je geen enkele andere geldige zet hebt (geen gevraagde kleur, geen hogere troef, en — afhankelijk van regelset — geen mag-afgooien-situatie). Concreet: kun je de gevraagde niet-troefkleur niet bekennen en kun je niet overtroeven, maar heb je wel (alleen lagere) troef, dan ben je in de ROTTERDAMSE regelset verplicht die lagere troef te spelen (ondertroeven verplicht); je mag dan niet afgooien.
5) AFGOOIEN ("bok geven"): kun je niet bekennen en heb je in het geheel geen troef, dan speel je een willekeurige andere kaart.

VERSCHIL AMSTERDAMS vs ROTTERDAMS (de enige troefplicht-afwijking — implementeer als schakelaar):
- ROTTERDAMS (aanbevolen default — eenvoudiger/eenduidiger): troef-, overtroef- en (bij gebrek aan hogere troef) ondertroefplicht gelden ONVOORWAARDELIJK, OOK als je maat de slag op dat moment al heeft. Heb je de gevraagde kleur niet, dan MOET je (over- of onder)troeven indien je troef bezit; afgooien mag alleen zonder troef.
- AMSTERDAMS: als je de gevraagde kleur niet hebt EN je maat staat op dat moment het hoogst in de slag (de slag ligt "aan de maat"), dan vervalt de (over)troefplicht en mag je vrij afgooien. Staat de tegenstander hoog, dan geldt de troef-/overtroefplicht weer als in Rotterdams.

WINNAAR SLAG: ligt er troef in de slag, dan wint de hoogste troef (rang Boer>9>A>10>H>V>8>7). Ligt er geen troef, dan wint de hoogste kaart van de gevraagde kleur. Winnaar speelt de volgende slag uit.

== ROEM (meld/bonus, los van kaartpunten) ==
Volgorde voor REEKSEN (opeenvolgende kaarten) gebruikt de NATUURLIJKE kaartvolgorde, NIET de troef-puntvolgorde:
A - H - V - B - 10 - 9 - 8 - 7 (de Tien staat tussen Boer en 9). Geldige reeksen zijn aaneengesloten in deze volgorde en in dezelfde kleur. Voorbeeld: H-V-B is geldig; A-10-H-V is GEEN reeks (Boer ontbreekt tussen V en 10).
- Drie opeenvolgende kaarten zelfde kleur = 20 roem.
- Vier opeenvolgende kaarten zelfde kleur = 50 roem. (Niet 30 — die waarde is een fout in een enkele bron.)
- Een reeks van 4 telt als 50 (niet als 20+50); bij langere reeksen tel je losse maximale reeksen, bv. 5 op een rij = 50 + (resterende 2 vormen geen reeks). Praktisch: bij 8 kaarten in een hand is max 1 reeks per kleur relevant; implementeer "langste aaneengesloten reeks per kleur" -> 3=20, 4=50.
- STUK = Heer + Vrouw van de TROEFkleur (samen in handbezit / vallend in dezelfde slag, afhankelijk van meldconventie) = 20 roem.
- VIER GELIJKE hoge kaarten (vier Tienen, vier Heren, vier Vrouwen of vier Azen) = 100 roem.
- VIER BOEREN = 200 roem (Nederlandse standaardconventie — bevestigd door meerdere NL-bronnen; dit is GEEN fout).
- COMBINATIE stuk + reeks: het stuk telt apart bovenop de reeks. Stuk binnen een drie-kaart-reeks (H-V-B troef) = 20 (reeks) + 20 (stuk) = 40 roem. Stuk binnen een vier-kaart-reeks (bv. A-H-V-B troef) = 50 + 20 = 70 roem.
- Roem wordt aangezegd/gemeld bij het spelen van de relevante kaart (huisregel: automatisch tellen mag in een digitale implementatie).

== SLAGGEBONDEN BONUSSEN ==
- Laatste slag: het team dat de 8e (laatste) slag wint krijgt 10 extra punten (zit in de 162 verdisconteerd).
- Pit / mars: wint een team ALLE 8 slagen, dan +100 bonuspunten. De tegenpartij krijgt 0 (alle 162 + roem gaan naar het pit-team). Pit kan alleen het hele-spel-team maken.

== NAT GAAN & RONDETELLING ==
- Het SPELENDE (troefmakende/verplichte) team moet strikt MEER dan de helft halen, d.w.z. >= 82 punten van de 162 slag-/kaartpunten.
- ROEM telt mee voor het bepalen of de helft gehaald is: vergelijk (kaartpunten spelend team + roem spelend team) versus (kaartpunten tegenpartij + roem tegenpartij). Het spelende team "maakt" de ronde als zijn totaal STRIKT GROTER is dan dat van de tegenpartij. (Equivalente formulering bij gelijke totale roem: >= 82 kaart-/slagpunten.) Implementeer als: spelend_totaal > tegen_totaal -> ronde gehaald.
- GEHAALD ("nat is niet"): beide teams behouden hun eigen verzamelde kaartpunten + eigen roem als ronde-score.
- NAT (spelend team haalt NIET meer dan de helft, d.w.z. spelend_totaal <= tegen_totaal): het spelende team krijgt 0; de tegenpartij krijgt ALLE 162 kaart-/slagpunten + ALLE roem van beide teams.
- PIT door spelend team: spelend team krijgt 162 + alle roem + 100; tegenpartij 0. PIT door verdedigende partij: die partij krijgt 162 + alle roem + 100 (en het spelende team gaat per definitie nat).

== RANDGEVALLEN ==
- Geen kaart van de gevraagde kleur en geen troef: vrij afgooien (elke kleur).
- Alleen troef in de hand terwijl niet-troef gevraagd is: troefplicht/overtroefplicht zoals boven; bij alleen lagere troef -> Rotterdams: verplicht ondertroeven; Amsterdams: alleen verplicht als tegenstander hoog staat.
- Stuk waarvan slechts H of V in eigen hand: geen stuk-roem (beide nodig).
- Gelijkstand in rondetotaal: spelend team staat NIET strikt boven -> nat.
- Roem die niet aangezegd is (bij aanzeg-conventie): telt niet; in een digitale implementatie wordt roem standaard automatisch toegekend.

== EINDVOORWAARDE SPEL (instelbaar) ==
- Default aanbevolen: vast aantal van 16 bomen/ronden (4 x volledige deelronde), team met het hoogste cumulatieve totaal wint; of, alternatief, eerste team dat 1500 punten bereikt. Implementeer als instelling; 16 spellen is de meest gangbare verenigingsvorm.

### Implementatie-ontwerp
- **State-model:** KlaverjasState (clone van KingenState-vorm): config: KlaverjasConfig (gewest: 'rotterdams'|'amsterdams'; trumpSelection: 'verplichtDraaien'|'bieden'(Leids)|'vastKlaverenRonde1'; dealPattern: '3-2-3'|'4-4'; eindvoorwaarde: {type:'aantalBomen', n:16}|{type:'punten', n:1500}); params: vaste 32-kaart deck (createDeck met removedCards = alle rangen 2..6 = 16 ids), 8 slagen, 8 krt p.p.. teams: vast [0,2] (Wij) vs [1,3] (Zij) — partners tegenover elkaar. phase: 'dealing'|'bidding'|'playing'|'roundScored'|'gameFinished'. roundIndex (boom-teller), dealer:Seat, voorhand=leftOf(dealer). trump:Suit|null, makingTeam:0|1|null (spelende/verplichte team). hands:Card[][], currentTrick, completedTricks, capturedCards per team (afgeleid). roem: meldEvents[] per team met bron (reeks20/reeks50/stuk20/vier-gelijk100/vier-boeren200) gedetecteerd bij spelen of bij hand-deal. teamCardPoints:[0,0] (lopend), teamRoem:[0,0]. totals per team (cumulatief). bidding-substate: biedIndex (welke speler aan de beurt in biedronde), passes:Seat[]. Geen per-stoel-totals zoals Kingen; score is per TEAM.
- **Move-types:** playCard, bid (kies troefkleur of pas — alleen in bieden/Leids-modus), pass (in biedronde), declareRoem (optioneel; default automatisch tellen, geen expliciete zet)
- **Nieuwe events:** bidRequest/bidMade { seat, choice: 'pass' | { trump: Suit }, makingTeam }, trumpTurned { trump, dealer } (verplicht-draaien-variant, vervangt trumpChosen-semantiek met 'team wordt verplicht'), roemDeclared { team, seat, kind: 'reeks20'|'reeks50'|'stuk'|'vierGelijk'|'vierBoeren', points, cards }, lastTrickBonus { team, points: 10 }, pit { team, points: 100 } (mars/alle 8 slagen), natResult { makingTeam, gehaald: boolean, makingTotal, defendingTotal } (ronde nat/gehaald incl. roem-verrekening)
- **PublicGameView-extensies:** teams: { wij: Seat[]; zij: Seat[] } en viewerTeam: 0|1, makingTeam: 0|1|null + trumpForced/biddingState (wie aan de beurt in biedronde, reeds gepaste stoelen), roundCardPoints per team + roundRoem per team (lopend, voor HUD), totals als per-TEAM (2 waarden) i.p.v. per-stoel — huidige PublicGameView.totals is per-stoel en moet team-aware worden of een apart teamTotals-veld krijgen, ledSuit/trumpStrengthOrder-hint (UI moet J>9>A>10>K>Q>8>7 binnen troef tonen; rank-sortering in sortHand klopt niet voor troefkracht), legalCards blijft bestaan maar moet de over-/ondertroefplicht + Amsterdams 'maat staat hoog'-uitzondering al hebben verwerkt (engine-zijde, view exposeert alleen het resultaat)
- **UI-behoeften:** Bied-/troefdialoog: hergebruik createChoiceDialogs troefkeuze-paneel; uitbreiden met 'pas'-knop voor Leids bieden; bij verplicht-draaien een niet-interactieve troef-aankondiging (toast/announcement via notifications.ts), HUD: troefbadge herbruikbaar; slagentellers vervangen door TEAM-score (kaartpunten + roem live) Wij vs Zij — hud.ts toont nu per-stoel slagen, moet team-paneel krijgen, Roem-weergave: nieuwe HUD/animatie 'Roem +20/+50/stuk/100/200' bij het vallen van de melding (kan via notifications-toast + naamlabel), Scorebord (scoreboard.ts): per-boom team-tabel Wij/Zij met kaartpunten+roem+pit; nat-markering, 3D-tafel/kaarten/tween-engine (scene.ts, animations.ts, table.ts): volledig herbruikbaar — slag-render is identiek aan Kingen, Team-kleuring van naamlabels (Wij/Zij) en partner-tegenover-indicatie, i18n NL/EN sleutels voor bieden, roem, stuk, pit, nat/gehaald
- **AI-aanpak:** Conform AI-beleid 'zoekgebaseerd' voor diepe slagenspellen met bieden. METHODE: Determinisatie + Monte-Carlo (Perfect-Information Monte-Carlo / lichte ISMCTS). DETERMINISATIE van onbekende handen: vanuit de PublicGameView bouw de set 'onuitgegeven kaarten' (zoals unseenCards() in strategies.ts al doet) en verdeel die over de drie verborgen handen onder constraints: (a) bekende handgroottes (view.handSizes), (b) renonces — als een speler eerder niet bekende/niet troefde terwijl dat moest, is hij void in die kleur (afleidbaar uit completedTricks, vgl. someOpponentShownVoid()), (c) reeds aangezegde roem beperkt mogelijke kaarten. Sample N (bijv. 20-50) geldige verdelingen; speel per sample de resterende slagen uit met een snelle rollout-policy (de bestaande heuristiek chooseTrumpRoundCard als playout) of een ondiepe minimax; kies de kaart met hoogste gemiddelde teampunt-verwachting (kaartpunten + roem + nat/pit-kans). FEATURES/HEURISTIEKEN in evaluatie: kaartpunt-waarde van de slag, kans dat het spelende team >=82 haalt, troefcontrole (aantal+kracht troef J/9), partner-positie (zit maat al hoog → low-spelen i.p.v. overtroeven, Amsterdams-besef), roem-potentieel in de hand. BIEDEN (Leids): EV-schatting per troefkleur via handsterkte (troeflengte + Boer/9 bezit + azen) — kies 'speel' met die kleur als geschatte makende-kans > drempel, anders 'pas'; verplicht-draaien-variant kent geen AI-bied. Lagere moeilijkheid: pure heuristiek (uitgebreide chooseTrumpRoundCard met bekenplicht/overtroefplicht-besef) zonder simulatie; 'slim' = volledige determinisatie-MC.
- **Hergebruik:** DIRECT herbruikbaar zonder wijziging: core/deck.ts createDeck/createRng/shuffle/deal/sortHand; core/events.ts EventBus; core/scoresheet.ts; GameDefinition-contract (types.ts); client render volledig (scene.ts, animations.ts, table.ts, cards/cardTextures/cardArt); ui/lobby.ts, ui/chat.ts, ui/notifications.ts toast+announcement-basis, ui/i18n.ts patroon, scoreboard.ts skelet; server/gameHost.ts AiPlayer+RemotePlayerController-wiring; integration.test-manual.ts als test-template. STERK als TEMPLATE (kopiëren+aanpassen): games/kingen/engine.ts (slag-loop applyPlayCard/trickWon/finishRound/getView/getLegalMoves vrijwel 1-op-1), rules.ts (bekennen/troeven/overtroeven-logica is 80% aanwezig — uitbreiden met ondertroefplicht + Amsterdams-uitzondering), params.ts, scoring.ts. AANPASSEN/GENERALISEREN (Phase 0, gedeeld met alle nieuwe spellen): trickWinner moet een per-spel kracht-comparator krijgen (Klaverjas troefkracht J>9>A>10>K>Q>8>7 ≠ rank); TurnManager.pickMove + PlayerController + AiStrategy + protocol.moveType + RemotePlayerController hardcoden card/trump/roundKind → generieke chooseMove(view, legalMoves); game-registry i.p.v. createKingenDefinition() in gameHost/room/roomManager.
- **Risico's:** trickWinner in core/deck.ts gebruikt rank-vergelijking; Klaverjassen-troefkracht (Boer>9>A>10>H>V>8>7) en niet-troef-puntvolgorde wijken af van rang — vereist een spel-specifieke strength-comparator, anders worden slagen fout gewonnen, Over-/ondertroefplicht + Amsterdams 'maat staat hoog'-uitzondering is subtiel en regelgevoelig; legalCards-uitbreiding is de grootste bron van bugs en moet zwaar getest worden (edge cases: alleen lagere troef, troef gevraagd, void-detectie), Roem-detectie (reeksen via NATUURLIJKE volgorde A-H-V-B-10-9-8-7, stuk H+V troef, 4 boeren=200) los van kaartpunt-telling; reeks-detectie en stuk-binnen-reeks-stapeling (40/70) zijn foutgevoelig, Team-scoring breekt aannames in PublicGameView/HUD/scoreboard die per-STOEL zijn (Kingen kent geen teams) — view-extensie en client-aanpassing nodig, Bieden (Leids) introduceert een nieuw move-type/fase die de hardcoded moveType-keten (TurnManager/protocol/RemotePlayer) raakt; zonder Phase 0-generalisatie lekt Klaverjas-specifieke biedlogica in generieke laag, Nat-telling met roem-verrekening (spelend_totaal > tegen_totaal, bij nat gaan ALLE 162+roem naar tegenpartij) en pit/mars-detectie hebben veel randgevallen (gelijkstand = nat), AI determinisatie-MC kan traag zijn (N samples x 8 slagen rollout); thinkDelay-budget + sample-count tunen, evt. async om main thread/serverloop niet te blokkeren
