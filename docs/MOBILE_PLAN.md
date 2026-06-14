# Mobiel/iOS speelbaar maken — onderzoek + gefaseerd plan

> Gegenereerd 2026-06-14 via een adversarieel geverifieerde multi-agent audit (42 agents, 5 dimensies, 34/36 bevindingen bevestigd) **plus** een empirische iPhone-emulatietest (Playwright, 390×844 portret + 844×390 landscape) **plus** een verificatie op de iOS Simulator (echte WebKit, iPhone 16 Pro / iOS 18.4). Doel: de bestaande multigame-stack (kaartspellen + Mexen) speelbaar maken op mobiel, in elk geval iOS Safari — zonder de desktop-ervaring te regresseren.

## Empirische verificatie op iOS Simulator (echte WebKit) — corrigeert de theorie

Op de iPhone 16 Pro-simulator (iOS 18.4, échte Safari/WebKit) een lokaal Kingen-potje gespeeld. Resultaat:
- ✅ **WebGL rendert** (3D-tafel + kaarten verschijnen) — contextcreatie is **geen** hard-blocker op dit toestel.
- ✅ **DOM-knoppen tikken werkt** (galerij → spelpagina → setup → deal).
- ✅ **Kaart spelen via canvas-tik werkt** — een handkaart aangetikt, kaart werd gespeeld, slag voltooid. De `touch-action`-kaping-hypothese **manifesteert zich niet** als hard-blocker.
- ✅ **Double-tap zoomt de pagina niet in** — de double-tap-zoom-blokker treedt hier niet op.
- ✅ **Landscape is prima speelbaar** op echte WebKit (volledige tafel, leesbare waaier).
- 🔴 **Portret is onspeelbaar** — de handwaaier is enorm uitvergroot, overlapt zwaar, loopt langs beide randen weg en deels achter de Safari-balk. Dit is **de** reproduceerbare blokker.

**Herziene prioriteit:** de twee door de code-audit vermoede hard-blockers (touch-action, WebGL-context-loss) zijn op de Simulator **niet** opgetreden → ze zakken naar *robuustheid/polish*. De dominante, bevestigde oorzaak van "werkt niet op iOS" = **portret-oriëntatie + layout** (camera/handwaaier op brede verhouding). **Landscape-first is daarmee de snelste route naar speelbaar.**

**Caveats (eerlijk):** (a) de Simulator heeft desktop-RAM → geheugendruk-context-loss is hier niet uit te lokken; op een echte low-RAM iPhone blijft dat een reëel robuustheidsrisico (vandaar Fase 2 behouden, maar gede-prioriteerd). (b) computer-use-taps zijn schoon; echte vingers jitteren meer → de 7px-drempel kan op een fysiek toestel alsnog taps verwerpen, maar canvas-taps werken fundamenteel.

## Diagnose in één alinea

De app **laadt en rendert wél** op mobiel (geen crash, geen horizontale overflow, 0 console-fouten; galerij/spelpagina/setup zijn al verrassend responsive). Het "werkt niet" komt uit een samenspel van oorzaken in het 3D-spelpad:

1. **Oriëntatie (empirisch bevestigd):** de 3D-camera + handwaaier zijn op een **brede (landscape/desktop) beeldverhouding** afgesteld. In portret wordt de tafel uitgerekt en loopt de eigen handwaaier van het scherm af (slechts ~3 reuzenkaarten zichtbaar, afgesneden) → **onspeelbaar in portret**. Exact hetzelfde potje is in landscape (844×390) wél prima speelbaar.
2. **Touch-gesture-kaping (vermoed hard-blocker, iOS-only):** het canvas zet geen `touch-action: none` en er is geen `pointercancel`-handler → iOS kaapt tap/sleep voor pan/pinch/double-tap-zoom en breekt de kaart-interactie af. Niet reproduceerbaar in Chromium-emulatie; **op echt iOS-toestel te verifiëren**.
3. **WebGL-geheugendruk → context-loss (vermoed hard-blocker, iOS-only):** kaarttextures van 1024×1434 RGBA + mipmaps (~7,8 MB elk), een cache die mid-sessie nooit geleegd wordt, plus zware omgevings-textures. iOS Safari dropt bij geheugendruk de GL-context; er is **geen `webglcontextlost/restored`-handler**, dus het canvas blijft permanent zwart. **Op echt iOS te verifiëren.**
4. **iOS-bedienings-/layout-degradaties (bevestigd):** inputs erven `font-size < 16px` → iOS auto-zoomt bij focus; viewport mist `viewport-fit=cover` + `env(safe-area-inset-*)` (notch/home-indicator dekt HUD af); `vh` i.p.v. `dvh`; muis-gekalibreerde 7px klik-drempel verwerpt vinger-taps; touch-targets <44px.

**Belangrijk:** de twee vermoede hard-blockers (2 en 3) zijn de meest waarschijnlijke "werkt-niet"-oorzaken, maar zijn iOS-Safari-specifiek en moeten **op een echt toestel** worden bevestigd na Fase 1+2 voordat we in de zwaardere fasen investeren. De oriëntatie-blokker (1) is wél direct gereproduceerd.

## Productbeslissing (open)

**Oriëntatiestrategie** bepaalt de omvang van Fase 3/5:
- **A. Portret-responsive** — camera + handwaaier aspect-bewust herzien zodat portret werkt. Natuurlijkst voor telefoons, maar het meeste 3D-layoutwerk.
- **B. Landscape-first** — draai-prompt + advies/lock op landscape; portret toont "draai je toestel". Pragmatische snelle winst, sluit aan op de huidige brede render.
- **C. Beide** — portret bruikbaar + landscape optimaal.

## Gefaseerd plan (strikt incrementeel: per fase committen, daarna unit-tests + `npm run test:server` + `npm run check` + builds groen)

Alle mobiele aanpassingen via feature-detectie (`matchMedia('(pointer: coarse)')`/`maxTouchPoints`) + media queries — desktop ongewijzigd.

### Fase 1 — Touch hard-blocker wegnemen *(klein)*
`index.html`, `render/scene.ts`, `styles.css`
- `viewport-fit=cover` in de viewport-meta (let op: insets volgen in Fase 4 — anders tussentijdse regressie; zie risico's).
- `touch-action: none` op het canvas (+ `-webkit-user-select`, `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none`).
- `pointercancel`-handler die de interactie-state reset; afmelden in `dispose()`.
- Pointer-type-afhankelijke klik-drempel: 16px touch / 7px muis.
- Hover-effecten in `@media (hover: hover)` wikkelen zodat ze niet op touch blijven plakken.

### Fase 2 — WebGL context-loss robuustheid *(middel)*
`render/scene.ts`, `main.ts`, `ui/i18n.ts`, `ui/notifications.ts`
- `webglcontextlost` (preventDefault + animationLoop op null) en `webglcontextrestored` (textures/environment opnieuw opbouwen, of nette i18n-melding "herlaad de pagina").
- WebGL-availability-check met leesbare fallback i.p.v. diep gegooide error.
- Nieuwe i18n-strings NL/EN (geen hardcoded strings).

### Fase 3 — Mobiel render-pad: geheugendruk wegnemen *(groot)*
`render/scene.ts`, `render/cards.ts`, `render/environments.ts`
- Centrale `compact`/low-power-detectie (helper).
- Kaart-textuurresolutie op mobiel 384 (≈0,8 MB i.p.v. 5,9 MB/textuur); clamp tegen `maxTextureSize`/`getMaxAnisotropy()`.
- Procedurele omgevings-textures op mobiel 512 (café 1024×256), `voegRuisToe` beperken/overslaan, per-id cachen.
- Verlicht render-pad: `antialias:false`, `BasicShadowMap`/schaduwen uit, kleinere shadow maps, `setPixelRatio` cap ~1,5. Desktop blijft hoog.

### Fase 4 — Responsive CSS-reflow, safe-area & dvh *(middel)*
`styles.css`, `ui/mexenPanel.ts`
- `env(safe-area-inset-*)` via `calc()` op alle vaste rand-offsets (HUD, chat, credit, toepknop, banners, mexenPanel).
- Minimaal 16px op alle focusbare velden (tegen auto-zoom).
- `dvh`/`svh` met `@supports`-fallback op `vh` waar zichtbare hoogte telt.
- Portret-reflow `@media (max-width:560px)` (+ evt. 400px-breakpoint); tap-targets ≥44px; `overscroll-behavior: contain`.

### Fase 5 — Touch-feedback, resize-correctheid & perf-verfijning *(groot)*
`render/scene.ts`, `render/animations.ts`
- Pre-tap-feedback op touch (lift bij `pointerdown` i.p.v. hover); evt. hit-slop.
- Smalle viewports: hand breder uitwaaieren (grotere stap/straal/schaal) → overlappende kaarten raakbaar. **(Dekt de portret-oriëntatie-blokker bij keuze A/C.)**
- Resize robuust: `orientationchange` + `visualViewport` resize/scroll → `herschaal()`; afmelden in `dispose()`.
- `visibilitychange` pauzeert de render-loop; dirty-aware `tik` (alleen renderen bij beweging).

### Fase 6 — PWA, load-splitsing & build-target *(middel)*
`main.ts`, `index.html`, `public/manifest.json`, `vite.config.ts`, `server/src/index.ts`
- Three.js lazy uit de entry-bundel (galerij vrijwel direct interactief; ~180 kB chunk pas bij spelstart).
- PWA-meta + minimaal `manifest.json` (standalone, theme `#0a0a0f`).
- `Cache-Control: immutable` op gehashte assets (sirv `maxAge`+`immutable`).
- Build-target bewust (`es2020` of `@vitejs/plugin-legacy`); dynamic imports in try/catch met i18n-melding.

## Risico's
- `viewport-fit=cover` zónder safe-area-insets verslechtert iOS juist → cover (Fase 1) en insets (Fase 4) in nauw opeenvolgende commits, of cover pas in Fase 4.
- `touch-action:none` blokkeert ook pinch-zoom op de 3D-scene — gewenst bij vaste camera, maar bevestig dat er geen pinch-to-zoom-feature gepland is.
- Mobiel render-pad mag desktop niet raken → strikt gaten op de pointer-coarse-vlag + desktop visueel hertesten na Fase 3.
- `webglcontextrestored` vereist volledige her-init → testen met `WEBGL_lose_context`.
- De twee iOS-hard-blockers zijn vermoed, niet gediagnosticeerd op echt toestel → **verifieer op echt iOS na Fase 1+2** vóór Fase 3+.
- `dvh`/`svh` pas vanaf iOS 15.4 → `@supports`-fallback.
- Lazy-load three.js verandert chunk-splitsing → alle spelpaden (lokaal/online/Mexen) hertesten.
