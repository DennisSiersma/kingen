/**
 * src/ai/strategies.ts
 * Concrete AI-strategieën. Register + factory.
 *
 * Drie niveaus:
 *  - 'random'      ('makkelijk', "Eenvoudig"):   legale random met simpele bias.
 *  - 'heuristisch' ('gemiddeld', "Gemiddeld"):   rondebewuste heuristieken.
 *  - 'slim'        ('moeilijk',  "Slim"):        heuristieken + kaarttelling
 *                                                over view.playedCards/slagen.
 *
 * INVARIANT: alle strategieën kiezen UITSLUITEND uit view.legalCards en zien
 * alleen de PublicGameView — nooit verborgen handen.
 */

import type { Card, PublicGameView, Suit, Trick } from '../core/types.ts';
import { ACE, JACK, KING, QUEEN, SUITS } from '../core/types.ts';
import { createDeck, trickWinner } from '../core/deck.ts';
import type { KingenRoundKind } from '../games/kingen/types.ts';
import type { AiDifficulty, AiStrategy } from './types.ts';

/**
 * Kingen is een slagenspel, dus zijn views hebben altijd de slag-velden gevuld.
 * De interne helpers werken op deze view met vereiste slag-velden; de publieke
 * AiStrategy-methodes (die de generieke PublicGameView krijgen) casten ernaar.
 */
type KingenView = PublicGameView & {
  currentTrick: Trick;
  completedTricks: Trick[];
  playedCards: Card[];
  trickCounts: number[];
};

// ---------------------------------------------------------------------------
// Denkvertraging
// ---------------------------------------------------------------------------

/** Standaard denkvertraging (min, max) in ms, zodat zetten visueel te volgen zijn. */
export const DEFAULT_THINK_DELAY_MS: readonly [number, number] = [600, 1200];

/** Trek een willekeurige denktijd uit het opgegeven bereik. */
export function randomThinkDelayMs(
  range: readonly [number, number] = DEFAULT_THINK_DELAY_MS,
): number {
  const [min, max] = range;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

/** Wacht een natuurlijke, willekeurige denktijd. */
export function thinkDelay(range: readonly [number, number] = DEFAULT_THINK_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomThinkDelayMs(range)));
}

/**
 * Wikkel een strategie in een instelbare denkvertraging: elke beslissing wordt
 * pas na een willekeurige pauze (default ~600-1200 ms) teruggegeven.
 * Handig voor AiPlayer (src/core/player.ts) of direct gebruik.
 */
export function withThinkDelay(
  strategy: AiStrategy,
  range: readonly [number, number] = DEFAULT_THINK_DELAY_MS,
): AiStrategy {
  const wrapped: AiStrategy = {
    id: strategy.id,
    naam: strategy.naam,
    difficulty: strategy.difficulty,
    async chooseCard(view) {
      await thinkDelay(range);
      return strategy.chooseCard(view);
    },
    async chooseTrump(view, legal) {
      await thinkDelay(range);
      return strategy.chooseTrump(view, legal);
    },
    async chooseRoundKind(view, available) {
      await thinkDelay(range);
      return strategy.chooseRoundKind(view, available);
    },
  };
  if (strategy.shouldClaim) {
    wrapped.shouldClaim = (view) => strategy.shouldClaim!(view);
  }
  return wrapped;
}

// ---------------------------------------------------------------------------
// Algemene hulpfuncties
// ---------------------------------------------------------------------------

const HEART_KING_ID = 'hearts-13';

function pick<T>(items: readonly T[]): T {
  const v = items[Math.floor(Math.random() * items.length)];
  if (v === undefined) throw new Error('AI: keuze uit lege lijst');
  return v;
}

function minBy<T>(items: readonly T[], score: (item: T) => number): T {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const item of items) {
    const s = score(item);
    if (best === undefined || s < bestScore) {
      best = item;
      bestScore = s;
    }
  }
  if (best === undefined) throw new Error('AI: minBy over lege lijst');
  return best;
}

function maxBy<T>(items: readonly T[], score: (item: T) => number): T {
  return minBy(items, (item) => -score(item));
}

function roundKindOf(view: PublicGameView): KingenRoundKind {
  return view.round.kind as KingenRoundKind;
}

/** Wint `candidate` van de huidige winnende kaart `winning` (uitkomstkleur `led`)? */
function beats(candidate: Card, winning: Card, led: Suit, trump: Suit | null): boolean {
  if (candidate.suit === winning.suit) return candidate.rank > winning.rank;
  if (trump !== null && candidate.suit === trump) return true;
  // De huidige winnaar is altijd troef of de uitkomstkleur; al het andere verliest.
  void led;
  return false;
}

/** De op dit moment winnende kaart van de lopende slag, of null als nog leeg. */
function currentWinningCard(trick: Trick, trump: Suit | null): Card | null {
  if (trick.plays.length === 0) return null;
  const seat = trickWinner(trick.plays, trump);
  const play = trick.plays.find((p) => p.seat === seat);
  return play ? play.card : null;
}

/**
 * Alle kaarten die de kijker nog NIET gezien heeft: het volledige spel minus
 * eigen hand, gespeelde kaarten en de lopende slag. Bij 3/5 spelers worden de
 * gestripte lage zwarte kaarten meegeschrapt (afgeleid uit seatCount).
 */
function unseenCards(view: KingenView): Card[] {
  const seen = new Set<string>();
  for (const c of view.hand) seen.add(c.id);
  for (const c of view.playedCards) seen.add(c.id);
  for (const p of view.currentTrick.plays) seen.add(p.card.id);
  for (const t of view.completedTricks) for (const p of t.plays) seen.add(p.card.id);
  if (view.seatCount === 3) seen.add('spades-2');
  if (view.seatCount === 5) {
    seen.add('spades-2');
    seen.add('clubs-2');
  }
  return createDeck().filter((c) => !seen.has(c.id));
}

/** Totaal aantal slagen in deze ronde (voltooid + nog te spelen vanaf nu). */
function totalTricksThisRound(view: KingenView): number {
  return view.completedTricks.length + view.hand.length;
}

/** Gevaarlijke slag in 'zevenLaatste': de 7e (index 6) of de allerlaatste. */
function isDangerTrick(view: KingenView): boolean {
  const idx = view.currentTrick.index;
  return idx === 6 || idx === totalTricksThisRound(view) - 1;
}

/** Heeft een tegenstander aantoonbaar geen kaarten meer in `suit` (renonce getoond)? */
function someOpponentShownVoid(view: KingenView, suit: Suit): boolean {
  const tricks: Trick[] = [...view.completedTricks, view.currentTrick];
  for (const trick of tricks) {
    const first = trick.plays[0];
    if (!first || first.card.suit !== suit) continue;
    for (const play of trick.plays.slice(1)) {
      if (play.seat !== view.seat && play.card.suit !== suit) return true;
    }
  }
  return false;
}

/**
 * Afgooi-prioriteit in negatieve rondes: hoger = eerst lozen.
 * Strafkaarten van het lopende onderdeel ver bovenaan, daarna hoge kaarten.
 */
function discardPriority(card: Card, kind: KingenRoundKind): number {
  switch (kind) {
    case 'geenHarten':
      return card.suit === 'hearts' ? 200 + card.rank : card.rank;
    case 'geenHerenBoeren':
      return card.rank === KING || card.rank === JACK ? 200 + card.rank : card.rank;
    case 'geenDames':
      return card.rank === QUEEN ? 200 : card.rank;
    case 'hartenheer':
      if (card.id === HEART_KING_ID) return 1000;
      return card.suit === 'hearts' && card.rank > KING ? 100 + card.rank : card.rank;
    default:
      // geenSlagen / zevenLaatste / troef: hoge kaarten winnen slagen → eerst weg.
      return card.rank;
  }
}

// ---------------------------------------------------------------------------
// Kaartkeuze — negatieve rondes
// ---------------------------------------------------------------------------

function chooseNegativeRoundCard(view: KingenView, kind: KingenRoundKind, counting: boolean): Card {
  const legal = view.legalCards;
  const trick = view.currentTrick;
  const leading = trick.plays.length === 0;
  const lastToPlay = trick.plays.length === view.seatCount - 1;
  // 'zevenLaatste': alle slagen behalve de 7e en de laatste zijn gratis —
  // gebruik ze om hoge kaarten te dumpen (dumpMode).
  const dumpMode = kind === 'zevenLaatste' && !isDangerTrick(view);

  if (leading) {
    if (dumpMode) return maxBy(legal, (c) => c.rank);
    if (counting) {
      // Slim: kom uit met een lage kaart waar nog hogere kaarten van bestaan,
      // zodat een ander de slag vrijwel zeker moet nemen.
      const unseen = unseenCards(view);
      const scored = legal.map((c) => ({
        card: c,
        higherUnseen: unseen.filter((u) => u.suit === c.suit && u.rank > c.rank).length,
      }));
      const safe = scored.filter((s) => s.higherUnseen > 0);
      const pool = safe.length > 0 ? safe : scored;
      return minBy(pool, (s) => s.card.rank * 100 - s.higherUnseen).card;
    }
    return minBy(legal, (c) => c.rank + Math.random() * 0.5);
  }

  const ledPlay = trick.plays[0];
  if (!ledPlay) return minBy(legal, (c) => c.rank); // kan niet voorkomen
  const led = ledPlay.card.suit;
  const followers = legal.filter((c) => c.suit === led);
  const winning = currentWinningCard(trick, null);

  if (followers.length > 0 && winning !== null) {
    const losing = followers.filter((c) => !beats(c, winning, led, null));

    if (dumpMode) {
      // Gratis slag: pak hem met de hoogste kaart, of dump de hoogste verliezer.
      const winners = followers.filter((c) => beats(c, winning, led, null));
      if (winners.length > 0) return maxBy(winners, (c) => c.rank);
      return maxBy(followers, (c) => c.rank);
    }

    // Hartenheer: speel ♥H zodra hij gegarandeerd verliest (♥A wint de slag al).
    if (kind === 'hartenheer' && led === 'hearts') {
      const heartKing = followers.find((c) => c.id === HEART_KING_ID);
      if (heartKing && winning.rank > KING) return heartKing;
    }

    if (losing.length > 0) {
      // Duik: hoogste kaart die nog nét verliest (loost gelijk hoge kaarten).
      return maxBy(losing, (c) => c.rank);
    }

    // Gedwongen erboven: vermijd ♥H zelf winnen in het hartenheer-onderdeel.
    const pool = followers.filter((c) => !(kind === 'hartenheer' && c.id === HEART_KING_ID));
    const options = pool.length > 0 ? pool : followers;
    if (lastToPlay) {
      // We winnen sowieso: dump meteen de hoogste kaart.
      return maxBy(options, (c) => c.rank);
    }
    // Niet als laatste: speel de laagste winnaar en hoop dat iemand eroverheen gaat.
    return minBy(options, (c) => c.rank);
  }

  // Niet kunnen bekennen: loos de gevaarlijkste kaart (strafkaarten eerst).
  return maxBy(legal, (c) => discardPriority(c, kind));
}

// ---------------------------------------------------------------------------
// Kaartkeuze — troefronde
// ---------------------------------------------------------------------------

function chooseTrumpRoundCard(view: KingenView, counting: boolean): Card {
  const legal = view.legalCards;
  const trump = view.round.trump;
  const trick = view.currentTrick;
  const leading = trick.plays.length === 0;
  const lastToPlay = trick.plays.length === view.seatCount - 1;

  if (leading) {
    if (counting && trump !== null) {
      const unseen = unseenCards(view);
      const unseenTrumps = unseen.filter((c) => c.suit === trump);
      const myTrumps = legal.filter((c) => c.suit === trump);

      // 1. Troef trekken zodra wij de hoogste resterende troef hebben.
      if (myTrumps.length > 0 && unseenTrumps.length > 0) {
        const top = maxBy(myTrumps, (c) => c.rank);
        const highestOut = maxBy(unseenTrumps, (c) => c.rank);
        if (top.rank > highestOut.rank) return top;
      }

      // 2. Vrije winnaar incasseren: hoogste resterende kaart van een bijkleur,
      //    zonder aantoonbaar introef-gevaar.
      const sureWinners = legal.filter((c) => {
        if (c.suit === trump) return false;
        if (unseen.some((u) => u.suit === c.suit && u.rank > c.rank)) return false;
        if (unseenTrumps.length === 0) return true;
        return !someOpponentShownVoid(view, c.suit);
      });
      if (sureWinners.length > 0) return maxBy(sureWinners, (c) => c.rank);

      // 3. Anders: laag uitkomen, troeven sparen.
      return minBy(legal, (c) => c.rank + (c.suit === trump ? 20 : 0));
    }

    // Heuristiek: hoge bijkleur-kaarten cashen; met veel troef de troef eruit halen.
    const highSide = legal.filter((c) => c.rank >= KING && c.suit !== trump);
    if (highSide.length > 0) return maxBy(highSide, (c) => c.rank);
    const myTrumps = trump === null ? [] : legal.filter((c) => c.suit === trump);
    if (myTrumps.length >= 5) return maxBy(myTrumps, (c) => c.rank);
    return minBy(legal, (c) => c.rank + (c.suit === trump ? 20 : 0));
  }

  const ledPlay = trick.plays[0];
  if (!ledPlay) return minBy(legal, (c) => c.rank);
  const led = ledPlay.card.suit;
  const winning = currentWinningCard(trick, trump);
  if (winning === null) return minBy(legal, (c) => c.rank);

  const winners = legal.filter((c) => beats(c, winning, led, trump));

  if (winners.length === 0) {
    // Kunnen niet winnen: gooi de laagste kaart weg, troeven het laatst.
    return minBy(legal, (c) => c.rank + (c.suit === trump ? 20 : 0));
  }

  if (lastToPlay) {
    // Niemand komt nog na ons: win zo goedkoop mogelijk.
    return minBy(winners, (c) => c.rank + (c.suit === trump && led !== trump ? 15 : 0));
  }

  if (counting && trump !== null) {
    // Slim: als er een onverslaanbare winnaar is, speel de goedkoopste daarvan.
    const unseen = unseenCards(view);
    const unbeatable = winners.filter((c) => {
      const higherSame = unseen.some((u) => u.suit === c.suit && u.rank > c.rank);
      if (c.suit === trump) return !higherSame;
      return !higherSame && !unseen.some((u) => u.suit === trump);
    });
    if (unbeatable.length > 0) return minBy(unbeatable, (c) => c.rank);
  }

  // Niet als laatste: in de kleur zo hoog mogelijk (moeilijk te overtreffen),
  // anders de kleinst mogelijke troefwinnaar.
  const inSuit = winners.filter((c) => c.suit === led);
  if (inSuit.length > 0) return maxBy(inSuit, (c) => c.rank);
  return minBy(winners, (c) => c.rank);
}

function chooseCardCore(view: KingenView, counting: boolean): Card {
  const legal = view.legalCards;
  const first = legal[0];
  if (first === undefined) throw new Error('AI: geen legale kaarten beschikbaar');
  if (legal.length === 1) return first;
  const kind = roundKindOf(view);
  if (kind === 'troef') return chooseTrumpRoundCard(view, counting);
  return chooseNegativeRoundCard(view, kind, counting);
}

// ---------------------------------------------------------------------------
// Troefkeuze en spelkeuze (dubbelkingen)
// ---------------------------------------------------------------------------

function suitStrength(hand: readonly Card[], suit: Suit): number {
  const cards = hand.filter((c) => c.suit === suit);
  const honors = cards.reduce((acc, c) => acc + (c.rank >= JACK ? c.rank - 10 : 0), 0);
  return cards.length * 3 + honors;
}

function bestTrumpSuit(view: PublicGameView, legal: readonly Suit[]): Suit {
  return maxBy(legal, (s) => suitStrength(view.hand, s));
}

/** Risicoschatting per speltype voor de huidige hand (lager = aantrekkelijker). */
function roundKindRisk(kind: KingenRoundKind, hand: readonly Card[]): number {
  const count = (pred: (c: Card) => boolean) => hand.filter(pred).length;
  const hearts = hand.filter((c) => c.suit === 'hearts');
  switch (kind) {
    case 'geenSlagen':
      return hand.reduce((acc, c) => acc + Math.max(0, c.rank - 9), 0) * 0.6;
    case 'geenHarten':
      return hearts.length * 1.5 + hearts.reduce((acc, c) => acc + Math.max(0, c.rank - 9), 0) * 0.7;
    case 'geenHerenBoeren':
      return count((c) => c.rank === KING || c.rank === JACK) * 4 + count((c) => c.rank === ACE) * 1.5;
    case 'geenDames':
      return count((c) => c.rank === QUEEN) * 6 + count((c) => c.rank === ACE || c.rank === KING) * 1.5;
    case 'hartenheer': {
      const hasKing = hand.some((c) => c.id === HEART_KING_ID);
      const lowHearts = hearts.filter((c) => c.rank < KING).length;
      if (hasKing) return Math.max(4, 14 - lowHearts * 3);
      const aceHearts = hearts.filter((c) => c.rank > KING).length;
      return aceHearts * 4 + Math.max(0, 3 - hearts.length);
    }
    case 'zevenLaatste':
      return 3 + hand.reduce((acc, c) => acc + Math.max(0, c.rank - 11), 0) * 0.3;
    case 'troef': {
      const best = Math.max(...SUITS.map((s) => suitStrength(hand, s)));
      const topCards = hand.filter((c) => c.rank >= KING).length;
      // Sterke hand → lage 'risico'-score → troef wordt gekozen.
      return 18 - (best + topCards);
    }
  }
}

function chooseRoundKindByRisk(view: PublicGameView, available: readonly KingenRoundKind[]): KingenRoundKind {
  return minBy(available, (k) => roundKindRisk(k, view.hand) + Math.random() * 0.4);
}

// ---------------------------------------------------------------------------
// Strategieën
// ---------------------------------------------------------------------------

/** 'makkelijk': willekeurige legale kaart met een simpele bias (laag in strafrondes). */
export function createRandomStrategy(): AiStrategy {
  return {
    id: 'random',
    naam: 'Eenvoudig',
    difficulty: 'makkelijk',
    chooseCard(view) {
      const legal = view.legalCards;
      const first = legal[0];
      if (first === undefined) throw new Error('AI: geen legale kaarten beschikbaar');
      if (legal.length === 1) return first;
      if (roundKindOf(view) === 'troef') return pick(legal);
      // Simpele heuristiek: kies willekeurig uit de lagere helft van de legale kaarten.
      const sorted = [...legal].sort((a, b) => a.rank - b.rank);
      const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.6)));
      return pick(pool);
    },
    chooseTrump(view, legal) {
      // Simpel maar niet dom: de kleur waarvan we de meeste kaarten hebben.
      return maxBy(legal, (s) => view.hand.filter((c) => c.suit === s).length + Math.random() * 0.5);
    },
    chooseRoundKind(_view, available) {
      return pick(available);
    },
  };
}

/**
 * 'gemiddeld': heuristieken per rondesoort — strafkaarten lozen, laag duiken
 * in negatieve rondes, hoog spelen/aftroeven in troefrondes, ♥H wegwerken.
 */
export function createHeuristicStrategy(): AiStrategy {
  return {
    id: 'heuristisch',
    naam: 'Gemiddeld',
    difficulty: 'gemiddeld',
    chooseCard(view) {
      return chooseCardCore(view as KingenView, false);
    },
    chooseTrump(view, legal) {
      return bestTrumpSuit(view, legal);
    },
    chooseRoundKind(view, available) {
      return chooseRoundKindByRisk(view, available);
    },
  };
}

/**
 * 'moeilijk' ("Slim"): heuristieken + kaarttelling over view.playedCards en de
 * gespeelde slagen (onuitgegeven kaarten, getoonde renonces) plus een
 * eenvoudige vooruitberekening van de lopende slag.
 */
export function createSmartStrategy(): AiStrategy {
  return {
    id: 'slim',
    naam: 'Slim',
    difficulty: 'moeilijk',
    chooseCard(view) {
      return chooseCardCore(view as KingenView, true);
    },
    chooseTrump(view, legal) {
      return bestTrumpSuit(view, legal);
    },
    chooseRoundKind(view, available) {
      return chooseRoundKindByRisk(view, available);
    },
    shouldClaim(view) {
      // De engine staat claimen alleen toe in strafrondes (niet bij troef).
      // Alleen waterdicht claimen: wij komen uit en elke kaart in onze hand is
      // hoger dan álle nog onuitgegeven kaarten van dezelfde kleur. Zonder
      // troef winnen we dan gegarandeerd elke resterende slag (wie niet kan
      // bekennen, kan ons niet kloppen), dus de claim is gelijk aan de
      // onvermijdelijke straf en versnelt alleen het spel.
      if (roundKindOf(view) === 'troef') return false;
      if (view.turn !== view.seat) return false;
      const v = view as KingenView;
      if (v.currentTrick.plays.length > 0) return false;
      if (v.hand.length === 0) return false;
      const unseen = unseenCards(v);
      return view.hand.every((c) =>
        unseen.every((u) => u.suit !== c.suit || u.rank < c.rank),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Register + factory
// ---------------------------------------------------------------------------

/** Alle beschikbare strategieën (voor setup-UI en aiStrategyId-lookup). */
export function listStrategies(): AiStrategy[] {
  return [createRandomStrategy(), createHeuristicStrategy(), createSmartStrategy()];
}

/** Vind een strategie op id ('random' | 'heuristisch' | 'slim'); undefined indien onbekend. */
export function getStrategyById(id: string): AiStrategy | undefined {
  return listStrategies().find((s) => s.id === id);
}

/** Standaardstrategie per moeilijkheidsgraad. */
export function getStrategyForDifficulty(difficulty: AiDifficulty): AiStrategy {
  switch (difficulty) {
    case 'makkelijk':
      return createRandomStrategy();
    case 'gemiddeld':
      return createHeuristicStrategy();
    case 'moeilijk':
      return createSmartStrategy();
  }
}
