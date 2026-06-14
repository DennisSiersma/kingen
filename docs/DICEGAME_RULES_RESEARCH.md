# Dobbelspellen — regelonderzoek + graphics

> Diepgaand, geverifieerd onderzoek t.b.v. het toevoegen van dobbelspellen aan de engine,
> met **primaire nadruk op Mexen** (de Nederlandse blufvariant met doorgeven) en zijn
> varianten, volledige implementeerbare regelsets voor de overige dobbelspellen, en een
> sectie over grafisch hoogwaardige procedurele dobbelstenen + dobbelbeker in Three.js.
> Methode: deep-research — 5+ parallelle web-research-agents, bronnen adversarieel gekruist.
> Datum: 2026-06-14. Status: **onderzoek** (nog geen code). Zie ook `DICEGAME_PLAN.md`
> (engine-haalbaarheid).

## Methode & betrouwbaarheid

Bronnen zijn per claim gekruist over onafhankelijke EN/NL/DE-sites (pagat/dice-play,
Wikipedia EN/NL/DE, spielregeln.de, gamerules.com, Nederlandse spelregelsites, officiële
Hasbro/Gamewright-teksten en GitHub-broncode voor de graphics). **Caveat:** `WebFetch` gaf
in deze omgeving HTTP 403 op vrijwel alle URL's; de claims leunen op de zoekresultaat-
samenvattingen (die de paginatekst wél lazen) plus de wél-leesbare GitHub-bronnen. Dragende
feiten zijn door ≥2 onafhankelijke bronnen bevestigd; echte bronafwijkingen zijn expliciet
gemarkeerd als **config-keuze**.

## ⚠️ Belangrijkste bevinding vooraf: "Mexen" = twee verschillende spellen

In Nederlands gebruik dekt "Mexen/Mexxen" **twee mechanisch verschillende spellen** die dice
+ levens delen maar fundamenteel verschillen — bronnen halen ze geregeld door elkaar:

1. **Bluf-en-doorgeven** (= het Duitse *Mäxchen / Meiern / Mia*): verdekt gooien onder een
   beker, aankondigen-of-liegen, volgende speler gelooft-of-twijfelt. **Dit is wat we bouwen.**
2. **Hoogste-van-N-worpen**: open gooien, geen verberging, geen bluf; laagste worp verliest.
   De bekende **"halve mex = 1+4"**-regel hoort bij *dit* spel.

➡️ **Implicatie:** bouw géén "halve mex"-waardetier in de blufversie — die regel komt uit het
andere spel en zou het blufmodel corrumperen. Wat in de blufversie het dichtst in de buurt
komt is de actie **"beker ongezien doorgeven"**.

---

# 1. MEXEN (primair) — Nederlandse blufvariant met doorgeven

**Engelse/Duitse namen:** Mia / Mäxchen / Meiern / "Liar Dice (2 dobbelstenen)". **Familie:**
bluf/verborgen-info dobbelspel. **Spelers:** 3+. **Vertrouwen regels:** hoog (kernregels door
meerdere onafhankelijke bronnen verbatim bevestigd); twee punten zijn config-keuzes.

## 1.1 Canonieke regels (aanbevolen NL-default)

**Opstelling.** 2 dobbelstenen + 1 beker. Elke speler start met **6 levens** (breed bevestigd;
scommonste conventie — sommige groepen gebruiken 3). Levens aftellen tot 0 = af.

**Waarde-ordening (sterke consensus, verbatim identiek over EN/NL/DE).** De twee stenen
vormen een tweecijferig getal met de **hoogste steen als tiental**. Volgorde **laag → hoog**:

```
31 < 32 < 41 < 42 < 43 < 51 < 52 < 53 < 54 < 61 < 62 < 63 < 64 < 65   (niet-paren, oplopend)
   < 11 < 22 < 33 < 44 < 55 < 66                                       (paren — bóven alle niet-paren)
   < 21                                                                (Mex/Mäxchen — hoogste, onverslaanbaar)
```

- Paren (Pasch) verslaan álle niet-paren; **21 is de absolute top** en kan niet overboden worden.
- Geen enkele geraadpleegde bron degradeert 21 of herordent de paren — behandel dit als vast.

**Beurtverloop.** Een speler schudt de beker, kijkt verdekt (alleen voor zichzelf), en
**kondigt een waarde aan** die **strikt hoger** moet zijn dan die van de vorige speler (eerste
speler van een ronde mag alles aankondigen). De aankondiging **mag een leugen zijn**. Daarna
gaat de beker naar de volgende speler.

**Geloven of twijfelen.** Wie de beker krijgt, kiest:
- **(a) geloven** → zelf gooien (zonder de oude stenen te bekijken) en hoger aankondigen, doorgeven; of
- **(b) twijfelen** → de beker optillen en de worp van de vorige speler onthullen.

**Resolutie (verbatim bevestigd, meerdere bronnen):**
- Was de aankondiging **waar** (echte worp ≥ aangekondigd) → de **twijfelaar** verliest een leven.
- Was het **gelogen** (echte worp lager) → de **aankondiger** verliest een leven.
- *Onder-aankondigen* (lager aankondigen dan je echt gooide) is toegestaan: bij twijfel is de
  gooier dan alsnog "waar" en verliest de twijfelaar.

**Mex (21) speciaal.** Wordt 21 aangekondigd, dan kan de volgende speler niet meer overbieden:
hij moet twijfelen (of, in een variant, "instellen" door zelf 21 te gooien). **Een Mäxchen-
resolutie telt dubbel: de verliezer verliest 2 levens** (breed gedeeld; zie variant-noot).

**Winnen.** Wie alle levens kwijt is, ligt eruit; de laatste speler met levens wint. Na elk
verloren leven start een **nieuwe ronde** met verse beker (geen carry-over), begonnen door de
speler die fout zat (betrapte leugenaar óf foute twijfelaar). Met de klok mee.

## 1.2 Varianten & config-keuzes

| Onderwerp | Default (NL/Mia-standaard) | Variant (toggle) | Bronafwijking |
|---|---|---|---|
| Aankondigen | **strikt hoger** | "mit": gelijk mag (Duitse stijl) | **Echte divergentie** — config-flag |
| Mex-straf | **2 levens** bij Mäxchen-resolutie | flat "21 gooien = 2 levens" (NL-drankversie) | scope verschilt per bron |
| Levens | **6** | 3 | huisregel |
| Beker ongezien doorgeven | **aan** (eigen zet) | uit | breed gedocumenteerd |
| Geketend "op goed vertrouwen" doorgeven | uit | aan | secundaire variant |
| "Dubbele mex" doorschuiven | uit | aan (NL-elaboratie, oplopende straf) | regionaal |
| Score-systeem | eliminatie (levens) | strepen/punten verzamelen | beide breed |

**Niet-canoniek / weglaten:** "halve mex = 1+4" (ander spel, zie ⚠ boven). Een aparte
"klopfen/knock kost een leven"-regel kon niet in primaire tekst bevestigd worden — weglaten.

## 1.3 Edge cases

- Exact de vorige waarde aankondigen: illegaal bij strikt-hoger; legaal als "mit" in de
  tie-variant. (config)
- De *aankondiging* is begrensd op > vorige; de *echte worp* mag alles zijn (dat is de bluf).
- Mex op de eerste worp van een ronde: legitiem; zet meteen het plafond. Geen instant-win.
- Twijfelen aan een ware aankondiging: twijfelaar verliest (de worp haalde/oversteeg de claim).

## 1.4 Implementatie-notities (sluit aan op `DICEGAME_PLAN.md`)

- **Dit is het enige archetype met verborgen informatie** → vergt de `room.personalize()`-
  uitbreiding (per-stoel filteren van de worp-events), dezelfde info-verberg-naad die het
  multi-game-plan voorziet voor de geheime trekstapel. De worp van een speler mag nooit in een
  view/event naar andere clients of hun AI lekken.
- **Move-types:** `roll`, `announce {value}`, `believe`, `doubt`, `passUnseen`.
- **State:** `lives[]`, `currentAnnouncement`, `actualRoll` (geheim, host-only), `cupHolder`,
  `phase ('rolling'|'announcing'|'responding')`, `direction`.
- **Multi-actor:** de "geloven/twijfelen"-respons is een tweede-actor-interactie — leunt op
  dezelfde "per-stoel pending / verzamel-fase"-helper als Hartenjagen-doorgeven en Toepen-respons.
- **AI:** bluf-/uitdaag-EV-model: kans dat de aangekondigde waarde haalbaar/waarschijnlijk is
  gegeven de bekende ondergrens; bluf-frequentie schalen met difficulty. Geen zoekboom nodig.

## 1.5 Bronnen (Mexen)
spielregeln.de/meiern.html & /maexchen.html · de.wikipedia.org/wiki/Mäxchen ·
en.wikipedia.org/wiki/Mia_(game) · gamerules.com/rules/mia-dice-game · greatime.de/en/mexican-dice-game ·
spielewiki.org/wiki/Mäxchen · spellenfans.nl/mexen-spelregels · lekkerdronken.com/mexen-drankspel ·
drinkspel.nl/mexen (let op: beschrijft deels het hoogste-van-N-spel) · dice-play.com/Games/Mia.htm

---

# 2. YAHTZEE / YATZY / GENERALA (volledig)

**Familie:** roll-keep-score (vaste scorekaart). **Kern (alle drie):** 5 dobbelstenen, **3
worpen per beurt** (2 herworpen, vrij deelverzamelingen houden), daarna verplicht exact één
ongebruikte categorie invullen (mag 0). Spel eindigt als alle categorieën vol zijn; hoogste totaal wint.

## 2.1 Yahtzee (Hasbro / Noord-Amerikaans) — 13 categorieën

**Bovensectie** (som van de stenen met dat oog): Enen, Tweeën, …, Zessen.
**Bovenbonus:** +**35** als de subtotaal van de bovensectie ≥ **63** (= drie van elk oog).

| Ondersectie | Eis | Score |
|---|---|---|
| Three of a Kind | ≥3 gelijk | som van **alle 5** stenen |
| Four of a Kind | ≥4 gelijk | som van **alle 5** stenen |
| Full House | 3 + 2 | **25** (vast) |
| Small Straight | 4 opeenvolgend (elke) | **30** (vast) |
| Large Straight | 5 opeenvolgend (elke) | **40** (vast) |
| Yahtzee | 5 gelijk | **50** (vast) |
| Chance | alles | som van alle 5 stenen |

**Yahtzee-bonus + joker (subtiel — verbatim uit Hasbro):**
- Eerste Yahtzee = 50 in het Yahtzee-vak.
- **Extra-Yahtzee = +100 elk**, mits het Yahtzee-vak een **50** bevat (zet vinkje in het bonusvak).
- Staat er een **0** in het Yahtzee-vak, dan vervalt de 100-bonus **permanent**, maar je moet
  alsnog volgens de jokerregels plaatsen.
- **Joker-plaatsingsvolgorde** (bij een Yahtzee nadat het Yahtzee-vak vol is, met 50 óf 0):
  1. **verplicht** in het bijbehorende **bovenvak** (het oog waarvan je er vijf hebt), als dat open is;
  2. anders in een willekeurig open **ondervak** — en dan tellen Full House/Small/Large Straight
     op **vol tarief** (25/30/40), ook al is het technisch geen straat/full house;
  3. anders een **0** in een open bovenvak.
- Een geforceerde 0-joker geeft tóch de 100-bonus, mits het Yahtzee-vak 50 bevat.
- ⚠ Tie-break: officieel niet gespecificeerd → implementatie-keuze (bv. extra Chance-worp).

## 2.2 Yatzy (Scandinavisch/Europees) — 15 categorieën, verschillen

| Categorie | Eis | Score |
|---|---|---|
| Enen…Zessen | — | som matchende stenen (boven); **bovenbonus +50 bij ≥63** |
| One Pair | 2 gelijk | som van die 2 (max 12) |
| Two Pairs | twee verschillende paren | som van de 4 stenen |
| Three / Four of a Kind | 3 / 4 gelijk | som van **alleen de matchende** stenen |
| Small Straight | **exact 1-2-3-4-5** | **15** (vast) |
| Large Straight | **exact 2-3-4-5-6** | **20** (vast) |
| Full House | 3 + 2 | **som van alle 5** (niet vast 25) |
| Chance | alles | som van alle 5 |
| Yatzy | 5 gelijk | **50** (vast) |

Kernverschillen vs Yahtzee: bonus **+50** (niet 35); straten zijn *specifieke* reeksen; Full
House = som; 3/4-of-a-kind tellen **alleen de matchende** stenen; standaard **geen** extra-bonus/joker.
**Maxi Yatzy**-variant: 6 stenen, ~20 categorieën (volledige tabel niet bevestigd — eerst verifiëren).

## 2.3 Generala (Latijns-Amerikaans) — ~10 categorieën

Bovensectie als Yahtzee (geen bovenbonus in klassiek Generala). **"Served"-bonus: +5** voor
een combinatie op de **eerste** worp.

| Categorie | Worp 2-3 | Served (1e worp) |
|---|---|---|
| Straight (1-5 of 2-6) | 20 | 25 |
| Full | 30 | 35 |
| Poker (4 gelijk) | 40 | 45 |
| Generala (5 gelijk) | **50** ⚠ | **wint het spel direct** |

⚠ Bronafwijking: niet-served Generala = **50 of 60** (kies en documenteer; 50 het meest geciteerd).
**Double Generala** (2e vijfling) = 100 (served 120), wint niet automatisch. Scratch-regel als Yahtzee.

---

# 3. TIENDUIZEND / 10.000 (volledig)

**Engelse naam:** Dice 10000 / Farkle-familie. **Familie:** push-your-luck, 6 dobbelstenen.
**Vertrouwen:** kern hoog; meerdere puntwaarden zijn bronafhankelijk (zie ⚠).

## 3.1 Scoretabel (gangbare NL-standaard)

| Combinatie | Punten | Vertrouwen |
|---|---|---|
| Losse **1** | 100 | hoog |
| Losse **5** | 50 | hoog |
| Drie **1-en** | 1000 | hoog |
| Drie 2/3/4/5/6 | 200 / 300 / 400 / 500 / 600 | hoog (= oog × 100) |
| Vier/vijf/zes gelijk | ⚠ zie divergentie | — |
| Straat 1-2-3-4-5-6 (in één worp) | 1500 | midden-hoog |
| Drie paren | ⚠ 600 / 1000 / **1500** | midden (bronafhankelijk) |

⚠ **Vier/vijf/zes-of-a-kind — twee elkaar uitsluitende conventies:**
- **Verdubbeling** (intern consistent, meest "standaard" geciteerd): vier = 2× het trio, vijf =
  4× trio, zes = 8× trio. (bv. vier 2-en = 400, vijf = 800, zes = 1600.)
- **Vaste jackpots:** vier = 1000/2000, vijf = 2000/4000, zes = 3000/6000 of **direct 10000 (win)**.

➡️ **Aanbevolen default:** verdubbelingsconventie + drie paren = 1500 + straat = 1500. Maak de
jackpot-variant een toggle.

## 3.2 Push-your-luck-lus (consistent over bronnen)

Gooi 6 stenen → leg **minstens één** scorende steen apart → kies **banken** of de **rest
opnieuw** gooien. **Volle bak / "hot dice"**: scoren alle 6, dan mag je alle 6 opnieuw gooien
en blijven optellen. **Bust ("poep" / jezelf afgooien)**: levert een worp niets op, dan eindigt
je beurt en ben je **alle in die beurt verzamelde punten kwijt**.
(NL-termen: *binnen* = op het bord; *volle bak/hand/worp* = hot dice; *poep* = bust — `poep`
niet hard in bronnen bevestigd, behandel als regionaal.)

## 3.3 Drempel & einde

- ⚠ **Openingsdrempel** ("binnenkomen"): **350** (NL-sites, meest gangbaar) vs 500/1000
  (Wikipedia/Engelse varianten). Config-keuze; default 350.
- **Winnen:** eerste naar **10.000**. Gangbare egalisatie: zodra iemand 10.000 haalt, krijgen de
  overige spelers nog één beurt; hoogste wint. Variant: exact 10.000 (overschot = bust) — minder gangbaar.

---

# 4. CHICAGO (volledig)

2 dobbelstenen, elk aantal spelers. **11 rondes** met doelsommen **2 t/m 12**. Per ronde gooit
elke speler één keer; is de som gelijk aan het rondegetal, dan scoor je dat getal aan punten,
anders niets. Na ronde 12 wint het hoogste totaal; gelijkspel = gedeelde winst (of tiebreak-ronde).
Varianten: 3 stenen en beste 2 kiezen; bij niets-scoren één steen herrollen. (Rondelabeling
"2-12" vs "1-11" is dezelfde 11 rondes.)

---

# 5. QWIXX (volledig)

**Correctie t.o.v. eerste aanname:** **6 dobbelstenen = 2 witte + 4 gekleurde** (rood/geel/
groen/blauw). Scoreblad met 4 gekleurde rijen: rood & geel lopen **2→12**, groen & blauw **12→2**.

**Beurt (de actieve speler gooit alle 6):**
1. **Witte som** (witte actie): tel de twee witte stenen op; **iedere** speler mag die som in één
   rij aankruisen (optioneel voor allen).
2. **Wit + gekleurd** (gekleurde actie): **alleen de actieve speler** mag één witte + één
   gekleurde steen combineren en die som in de bijbehorende kleurrij kruisen.
3. De actieve speler mag beide / één / geen doen; kruist hij **niets** aan → **strafvak** (−5).

**Markeren:** binnen een rij strikt **links→rechts**; overgeslagen getallen vervallen.
**Slot:** om het uiterst rechtse getal (12 resp. 2) te kruisen moet je al **≥5 kruisjes** in die
rij hebben; dat kruist het slotsymbool (telt als extra kruisje) en **vergrendelt** de rij — de
bijbehorende steen verdwijnt voor iedereen. **Einde:** zodra **2 rijen vergrendeld** zijn óf een
speler zijn **4e strafvak** kruist. **Score per rij** (driehoeksgetallen, slot telt mee):
1→1, 2→3, 3→6, 4→10, 5→15, 6→21, 7→28, 8→36, 9→45, 10→55, 11→66, **12→78**. Eindscore = som van
de vier rijen **− 5 per strafvak**. Hoogste wint.

---

# 6. ZILVERVLOOT — niet gevonden

Geen gedocumenteerd dobbel-/bordspel "Zilvervloot" gevonden. Zoekresultaten betreffen het
historische schip (Piet Hein, 1628) of *Zilvervlootsparen* (spaarregeling). ➡️ **Vraag aan jou:**
heb je een specifiek fysiek spel/uitgever in gedachten? Dan zijn regels alleen via doos/insteek
te achterhalen, niet online.

---

# 7. GRAPHICS — hoogwaardige procedurele dobbelstenen + beker (Three.js)

Volledig procedureel/in-code, geen externe assets — sluit aan op het projectprincipe. Cruciaal:
de **animatie moet de door de seeded engine bepaalde worp tonen**, dus deterministisch landen.

## 7.1 Aanbevolen stack (procedureel, dependency-arm, deterministisch)

- **Renderer/licht:** `WebGLRenderer` + `ACESFilmicToneMapping`; `scene.environment` uit
  `RoomEnvironment` → `PMREMGenerator.fromScene()` (procedurele IBL, **geen HDRI-bestand**).
- **Dobbelsteen-body:** `RoundedBoxGeometry(1,1,1, segments≈6, radius≈0.12)` (uit
  `three/addons/geometries/RoundedBoxGeometry.js`).
- **Ogen (high-end):** uitgeboorde `SphereGeometry`-putjes + `RingGeometry`-randen, ingelegd per
  vlak, daarna `computeVertexNormals()` — pips vangen écht licht en self-shadowen. **Lichter
  alternatief:** per-vlak `CanvasTexture` die `map` + `normalMap` + `aoMap` voedt, als 6-element
  materials-array (BoxGeometry levert al per-vlak material-groups).
- **Materiaal (`MeshPhysicalMaterial`):**
  - *Casinohars (doorschijnend):* `transmission 0.95, thickness ~1, ior 1.5, roughness 0.1,
    metalness 0, clearcoat 1, clearcoatRoughness 0.05, attenuationColor = body-tint`.
  - *Ivoor/been:* geen transmission; `sheen 1, sheenRoughness 0.5, roughness 0.3-0.5`.
  - (Vereist een env-map om goed te ogen — vandaar de PMREM-stap.)
- **Beker:** `LatheGeometry` (geprofileerd, met wanddikte) of open `CylinderGeometry`; vilt-
  interieur = `MeshPhysicalMaterial { roughness 0.95, sheen 1, sheenRoughness 0.8, donkere
  sheenColor }`, binnenschil `side: THREE.BackSide`.
- **Animatie (tween-pseudofysica — aanbevolen):** schud-oscillatie → worp-boog → multi-as spin →
  ease-out settle met kleine overshoot-bounce. **Eindoriëntatie =
  `Quaternion.setFromUnitVectors(doelvlak-normaal, +Y)`** voorvermenigvuldigd met een
  willekeurige spin → de seeded uitkomst wordt exact getoond, **zonder physics-engine en
  zonder material-remap**. Volledig deterministisch.
- **Polish:** procedurele contact-shadow (radiale gradient-canvas op een grondvlak, of de
  `webgl_shadow_contact`-bake-techniek); settle-bounce; motion-blur alleen optioneel als
  postprocessing (geen in-core class).

## 7.2 Als je later échte tuimelfysica wilt

Vervang de tween door **cannon-es** (`ConvexPolyhedron`-bodies, mass ~300-400, damping ~0.1,
sleep-events voor "stenen liggen stil"), en forceer de seeded uitkomst met de `byWulf/threejs-dice`
`prepareValues`/material-remap-truc (detecteer gelande vlak, hermap material-indices). Zwaarder en
een extra dependency — alleen doen als de tween-look onvoldoende blijkt.

## 7.3 Bronnen (graphics)
threejs.org/docs (RoundedBoxGeometry, MeshPhysicalMaterial, RoomEnvironment, PMREMGenerator,
Quaternion.setFromUnitVectors) · Codrops "Crafting a Dice Roller with Three.js and Cannon-es"
(tympanus.net, 2023) · Codrops "transparent glass and plastic in three.js" (2021) ·
github.com/byWulf/threejs-dice (deterministisch landen) · github.com/TonPlaygramBot/TonPlaygramWebApp
(procedurele uitgeboorde pips + tween-roll) · pmndrs.github.io/cannon-es/docs ·
threejs.org/examples/webgl_shadow_contact.html

---

# Open beslissingen (config-keuzes om vast te leggen)

1. **Mexen aankondigen:** strikt-hoger (default, aanbevolen) vs "mit"/gelijk toegestaan.
2. **Mexen Mex-straf:** alleen bij Mäxchen-resolutie (2 levens) vs ook flat bij 21-gooien.
3. **Mexen levens:** 6 (default) vs 3; eliminatie vs strepen-score.
4. **Tienduizend openingsdrempel:** 350 (default) vs 500/1000.
5. **Tienduizend 4/5/6-of-a-kind:** verdubbeling (default) vs vaste jackpots.
6. **Tienduizend drie paren / straat:** 1500 (aanbevolen) — bevestig tegen je gewenste tafel.
7. **Generala vijfling-waarde:** 50 (default) vs 60.
8. **Dobbelsteen-look:** doorschijnende casinohars vs ivoor/been (of beide als skin).
9. **Zilvervloot:** welk fysiek spel bedoel je? (anders schrappen).

# Aanbevolen startvolgorde

Per `DICEGAME_PLAN.md` is **Mexen het door jou gewenste startpunt**, maar het is mechanisch het
duurste archetype (verborgen info + `personalize()`-verbouwing + multi-actor-respons + beker-
render). Twee opties:
- **A — direct Mexen** (jouw voorkeur): bouw Phase D0 (dobbel-infra + DiceRenderer + beker) en
  meteen de verborgen-worp-/personalize-naad. Hoogste leerwaarde, maar je raakt meteen de
  zwaarste stukken.
- **B — Yahtzee als opwarmer, dan Mexen:** Yahtzee (open worp, geen kern-impact) bewijst eerst de
  dobbel-assembly-line en de DiceRenderer; daarna Mexen op een beproefd fundament.

Gezien je nadruk op grafische kwaliteit en op Mexen: ik adviseer **een korte Phase D0 met de
DiceRenderer + beker als eerste tastbare resultaat**, en dan Mexen — desnoods met Yahtzee als
parallelle, goedkope validatie van de scorekaart-HUD.

---

# 8. REGENWORMEN (toegevoegd 2026-06-14) — Heckmeck am Bratwurmeck / Pickomino

> Onderzoek via NL-Wikipedia + 999 Games/spelregels.eu + academische strategie-paper (IEEE/ResearchGate) + Frozen Fractal EV-analyse. Origineel: Zoch, Reiner Knizia 2005. NL-uitgave: 999 Games. **Press-your-luck met gedeelde tegelmarkt + stelen** — een NIEUWE motor t.o.v. Mexen/Qwixx/Fritzen/Yahtzee/Tienduizend.

## 8.1 Canonieke regels (NL-default)
- **Spelers:** 2–7. **Materiaal:** 8 dobbelstenen + 16 wormtegels.
- **Dobbelstenen:** vlakken `1,2,3,4,5,worm`; **worm = 5 punten** én het verplichte symbool om te incasseren.
- **Tegels:** 21–36, open oplopend op tafel ("grill"). Wormwaarde: 21–24=1, 25–28=2, 29–32=3, 33–36=4.
- **Beurt:** gooi alle resterende stenen → kies één symbool en leg ÁLLE stenen met dat symbool opzij → een symbool mag per beurt maar één keer → stop of gooi door. Totaal = som (worm=5).
- **Tegel pakken (bij stoppen):** vereist totaal ≥21 ÉN ≥1 worm opzij. Van tafel: hoogste tegel met nummer ≤ totaal. Stelen: alleen bij EXACTE match op de BOVENSTE tegel van een tegenstanders (LIFO-)stapel; exacte match heeft voorrang.
- **Bust:** als je geen nieuw symbool kunt opzijleggen, óf stopt met <21 / geen worm / geen pakbare tegel. Gevolg: eigen bovenste tegel terug op tafel + de hoogste open tafeltegel wordt omgedraaid (uit het spel). Markt krimpt altijd bij een bust.
- **Einde & winnaar:** zodra de open rij leeg is. Meeste wormen wint. **Gelijkspel:** NL-Wikipedia laat het open; gangbare/officiële ruling = hoogst genummerde tegel wint → config-toggle (default "hoogste tegel").

## 8.2 Variant-/configmatrix
- Default = NL 999-Games/Heckmeck-standaard (boven). 2-spelervariant: stelen weegt extra zwaar.
- Gelijkspel-regel als toggle (default hoogste tegel).
- Edities buiten v1: Regenwormen Junior, XL/Extreme, Heckmeck Extrawurm-uitbreiding.

## 8.3 Edge-cases voor de engine
- "Gebruikte symbolen" per beurt bijhouden (set); ≥1 worm + ≥21 + pakbare tegel apart checken.
- Bust met/zonder eigen tegel; teruggelegde tegel kan zelf de hoogste worden die meteen omgedraaid wordt.
- Exacte-match-steal vóór tafel-pak; alleen bovenste tegel van een tegenstander.
- Einde = open rij leeg (door pakken én omdraaien).

## 8.4 AI-strategie
- Diepste AI-spel van de familie; academisch onderzocht (Monte-Carlo "MC4C", ~10% risicodrempel presteert het best).
- Symboolkeuze: punten verzamelen maar ZORG voor ≥1 worm ("pak wormen als het kan", zeker vanaf de 3e worp).
- Stop-criterium: stop als EV(doorgooien) < zekere opbrengst. Praktische heuristiek: stop zodra (wormen op eigen stapel + wormen die je nu zou pakken) ≥ 2.
- Stelen weegt dubbel in 2-speler (≈ w + w/(p−1)).
- Aanpak voor ons: EV/Monte-Carlo-rollout over getLegalMoves/applyMove (gedeeld determinisatie-skelet) + heuristische fallback. Zelfs goede heuristiek ≈ 30–40% van perfect spel → heuristiek volstaat voor v1.

## 8.5 Stack-fit
- Nieuwe motor: press-your-luck + gedeelde markt + per-speler LIFO-tegelstapels + stelen. Beurtstaat = {opzijgelegd[], gebruikteSymbolen, totaal}, meerdere worpen per beurt.
- dice.ts uitbreiden: nu DieValue 1-6 + worp-paar (Mexen); nodig: 8 stenen + worm-vlak (waarde 5, apart symbool) + keep/bank-helpers.
- Render: bestaande 3D-dobbel-render (beker/stenen) + tegel-rij ("grill") + per-speler tegelstapels (nieuw, vgl. Qwixx-scorebord).
- Galerij-tegel onder Dobbelspellen; i18n NL/EN; integratietest + localhost-smoke zoals de rest.

## 8.6 Bronnen (Regenwormen)
- NL Wikipedia: https://nl.wikipedia.org/wiki/Regenwormen_(spel)
- 999 Games / spelregels.eu: https://www.spelregels.eu/regenwormen/
- Heckmeck (1d6chan): https://1d6chan.miraheze.org/wiki/Heckmeck
- Frozen Fractal — How to win at Pickomino: https://frozenfractal.com/blog/2015/5/3/how-to-win-at-pickomino/
- Academisch (IEEE/ResearchGate): Determination and Evaluation of Efficient Strategies for Heckmeck am Bratwurmeck (Pickomino)
