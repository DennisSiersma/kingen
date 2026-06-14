/**
 * src/ui/i18n.ts
 * Lichtgewicht i18n voor de hele DOM-overlay: één bron van waarheid met
 * vertaalsleutels (NL/EN), t() met {placeholder}-interpolatie, taalkeuze met
 * persistentie in localStorage en een subscribe-mechanisme zodat
 * UI-componenten live kunnen herrenderen bij een taalwissel.
 *
 * De engine blijft taalneutraal: de UI leidt alle zichtbare namen (rondesoort,
 * kleur, omgeving) zelf af uit de neutrale id's via dit bestand.
 */

import type { Rank, Suit } from '@shared/core/types.ts';
import { RANK_LABELS_EN, RANK_LABELS_NL } from '@shared/core/types.ts';
import type { KingenRoundKind, TrumpSelectionMode } from '@shared/games/kingen/types.ts';
import type { EnvironmentId } from '../render/types.ts';

export type Lang = 'nl' | 'en';

const STORAGE_KEY = 'kingen.lang';
const DEFAULT_LANG: Lang = 'nl';

// ---------------------------------------------------------------------------
// Vertalingen — NL is de bron van waarheid voor de sleutelset.
// ---------------------------------------------------------------------------

const nl = {
  // Algemeen
  'app.title': 'Kingen',
  'app.startError': 'Er ging iets mis bij het starten: {message}',
  'app.roomName': 'Tafel van {name}',
  'app.seat': 'Stoel {num}',

  // Kleuren
  'suit.hearts': 'Harten',
  'suit.diamonds': 'Ruiten',
  'suit.clubs': 'Klaveren',
  'suit.spades': 'Schoppen',

  // Rondesoorten (KingenRoundKind)
  'round.geenSlagen': 'Geen slagen',
  'round.geenHarten': 'Geen harten',
  'round.geenHerenBoeren': 'Geen heren en boeren',
  'round.geenDames': 'Geen dames',
  'round.hartenheer': 'De King (geen hartenheer)',
  'round.zevenLaatste': 'Geen 7e en laatste slag',
  'round.troef': 'Troef',

  // Uitleg per rondesoort
  'roundInfo.geenSlagen': 'Elke gewonnen slag kost 1 strafpunt. Vermijd dus elke slag.',
  'roundInfo.geenHarten': 'Elke hartenkaart in je gewonnen slagen kost 1 strafpunt.',
  'roundInfo.geenHerenBoeren': 'Elke heer of boer die je binnenhaalt kost 1 strafpunt.',
  'roundInfo.geenDames': 'Elke dame die je binnenhaalt kost 2 strafpunten.',
  'roundInfo.hartenheer': 'Wie de hartenheer (de King) pakt, krijgt de volle straf. De ronde kan stoppen zodra hij valt.',
  'roundInfo.zevenLaatste': 'De zevende slag kost 2 strafpunten, de allerlaatste slag 3.',
  'roundInfo.troef': 'Positieve ronde: elke gewonnen slag levert 1 punt op. Er geldt een troefkleur.',
  'roundInfo.fallback': 'Speel de slagen volgens de opdracht van deze ronde.',

  // Omgevingen
  'env.cafe': 'Bruin café',
  'env.cafe.desc': 'Warm lamplicht, hout en gezelligheid',
  'env.keukentafel': 'Keukentafel',
  'env.keukentafel.desc': 'Huiselijk potje onder de hanglamp',
  'env.casino': 'Casino',
  'env.casino.desc': 'Groen vilt en gedempte spots',

  // AI-niveaus
  'ai.makkelijk': 'Makkelijk',
  'ai.gemiddeld': 'Gemiddeld',
  'ai.moeilijk': 'Moeilijk',

  // Troefbepaling
  'trumpMode.delerKiest': 'Deler kiest troef',
  'trumpMode.laatsteKaart': 'Laatste kaart bepaalt troef',
  'trumpMode.uitkomerKiest': 'Wie uitkomt kiest troef',

  // Setup-scherm
  'setup.you': 'Jij',
  'setup.subtitle': 'Het klassieke Nederlandse kaartspel — nu in 3D',
  'setup.playOnline': '🌐 Online spelen met anderen',
  'setup.language': 'Taal',
  'setup.playerCount': 'Aantal spelers',
  'setup.playersN': '{n} spelers',
  'setup.playerCountHint': 'Bij 3 of 5 spelers worden enkele tweetjes uit het spel genomen zodat de kaarten gelijk opgaan.',
  'setup.atTable': 'Aan tafel',
  'setup.playerPlaceholder': 'Speler {n}',
  'setup.human': 'Mens',
  'setup.computer': 'Computer',
  'setup.aiLevelTitle': 'Speelsterkte van de computerspeler',
  'setup.seat0Title': 'Stoel 1 is jouw eigen stoel',
  'setup.hotseatTitle': 'Meerdere menselijke spelers aan één scherm komt later',
  'setup.aiSeatTitle': 'Deze stoel wordt door de computer gespeeld',
  'setup.environment': 'Omgeving',
  'setup.rules': 'Spelregels',
  'setup.presetName': 'Standaard (Nederlands)',
  'setup.presetHint': '10 rondes, deler kiest troef, hartenheer 5 punten, strikte huisregels.',
  'setup.presetRestore': 'Herstel standaard',
  'setup.modeHeading': 'Spelmodus',
  'setup.modeLabel': 'Modus',
  'setup.modeStandard': 'Standaard (10 rondes)',
  'setup.modeDouble': 'Dubbelkingen (deler kiest het spel)',
  'setup.modeHintStandard': 'Vaste volgorde: zes negatieve rondes, daarna één troefronde per speler.',
  'setup.modeHintDouble': 'Deler kiest per ronde het spel; elk negatief spel max. 2x, troef precies 2x per speler.',
  'setup.trumpSelectionLabel': 'Troefbepaling',
  'setup.trumpSelectionHint': 'Hoe wordt in troefrondes de troefkleur gekozen?',
  'setup.heartKingLabel': 'Straf voor de hartenheer',
  'setup.heartKingHint': '5 punten is gangbaar in Nederland; 4 is de klassieke telling.',
  'setup.penaltyPoints': '{n} strafpunten',
  'setup.trumpRoundsHeading': 'Troefrondes',
  'setup.mustTrumpLabel': 'Verplicht troeven',
  'setup.mustTrumpHint': 'Wie geen kleur kan bekennen, moet een troefkaart spelen als hij die heeft.',
  'setup.mustOvertrumpLabel': 'Verplicht overtroeven',
  'setup.mustOvertrumpHint': 'Ligt er al een troef, dan moet je er met een hogere troef overheen als dat kan.',
  'setup.negativeRoundsHeading': 'Negatieve rondes',
  'setup.stopKingLabel': 'De King stopt de ronde',
  'setup.stopKingHint': 'Zodra de hartenheer gevallen is, wordt de King-ronde direct afgebroken.',
  'setup.strictHeading': 'Strikt afgooien (niet kunnen bekennen)',
  'setup.strictHeartsLabel': 'Strikt bij “Geen harten”',
  'setup.strictHeartsHint': 'Kun je geen kleur bekennen, dan móét je een harten afgooien als je die hebt.',
  'setup.strictKJLabel': 'Strikt bij “Geen heren en boeren”',
  'setup.strictKJHint': 'Kun je geen kleur bekennen, dan móét je een heer of boer afgooien als je die hebt.',
  'setup.strictQueensLabel': 'Strikt bij “Geen dames”',
  'setup.strictQueensHint': 'Kun je geen kleur bekennen, dan móét je een dame afgooien als je die hebt.',
  'setup.strictKingLabel': 'Strikt bij “De King”',
  'setup.strictKingHint': 'Kun je geen kleur bekennen, dan móét je de hartenheer afgooien als je hem hebt.',
  'setup.heartLeadHeading': 'Uitkomen met harten',
  'setup.heartLeadHeartsLabel': 'Hartenverbod bij “Geen harten”',
  'setup.heartLeadKingLabel': 'Hartenverbod bij “De King”',
  'setup.heartLeadHint': 'Niet met harten uitkomen, tenzij je alleen nog harten hebt.',
  'setup.otherRulesHeading': 'Overige regels',
  'setup.forcedTrumpLabel': 'Troefdwang bij derde keuzebeurt (dubbelkingen)',
  'setup.forcedTrumpHint': 'Wie bij zijn derde keuzebeurt nog nooit troef koos, wordt daartoe verplicht (WK-regel).',
  'setup.claimingLabel': 'Hand afleggen toegestaan',
  'setup.claimingHint': 'Een speler mag zijn hand afleggen en neemt dan in één keer alle resterende strafpunten (WK-regel).',
  'setup.lowestWinsLabel': 'Alles als straf — laagste wint',
  'setup.lowestWinsHint': 'Ook troefslagen tellen als strafpunten; wie het laagst eindigt, wint.',
  'setup.orderHeading': 'Volgorde van de negatieve rondes',
  'setup.orderHint': 'Alleen in standaardmodus; daarna volgen de troefrondes. Beweeg de muis over een ronde voor uitleg.',
  'setup.moveEarlier': 'Eerder spelen',
  'setup.moveLater': 'Later spelen',
  'setup.start': 'Deel de kaarten',

  // HUD
  'hud.scoreboard': '♛ Scorebord',
  'hud.scoreboardTitle': 'Scorebord tonen of verbergen',
  'hud.settings': '⚙ Instellingen',
  'hud.settingsHeading': 'Instellingen',
  'hud.environment': 'Omgeving',
  'hud.language': 'Taal',
  'hud.brightness': 'Helderheid',
  'hud.cameraMotion': 'Camerabeweging',
  'hud.cameraMotionHint': 'Camera volgt de muis licht (staat stil tijdens kaartkeuze)',
  'hud.sound': 'Geluid',
  'hud.comingSoon': 'komt later',
  'hud.quit': 'Partij afbreken',
  'hud.quitConfirm': 'Partij afbreken en terug naar het startscherm?',
  'hud.claim': '✋ Hand afleggen',
  'hud.claimTitle': 'Leg je hand af en neem in één keer alle resterende strafpunten van deze ronde',
  'hud.claimConfirm': 'Hand afleggen en alle resterende strafpunten van deze ronde op je nemen?',
  'hud.roundOf': 'Ronde {num} van {total}',
  'hud.trumpPrefix': 'Troef:',
  'hud.noTrump': 'Geen troef',
  'hud.roundInfoAria': 'Doel van deze ronde tonen of verbergen',
  'hud.roundGoal': 'Doel van deze ronde',
  'hud.tricksTitle': 'Gewonnen slagen deze ronde',
  'hud.pointsTitle': 'Totaal (straf)punten tot nu toe',
  'hud.speed': 'Speelsnelheid',
  'hud.speedLangzaam': 'Langzaam',
  'hud.speedNormaal': 'Normaal',
  'hud.speedSnel': 'Snel',
  'hud.speedDirect': 'Direct',
  'hud.chipHuman': 'mens',
  'hud.chipAi': 'computer',

  // Scorebord
  'score.title': 'Scorebord',
  'score.close': 'Sluiten',
  'score.tabScore': 'Score',
  'score.tabChat': 'Chat',
  'score.chatSoon': 'binnenkort',
  'score.chatLaterTitle': 'Online chat komt later',
  'score.chatLater': 'Online chat komt later.',
  'score.noRounds': 'Nog geen rondes gespeeld.',
  'score.roundColumn': 'Ronde',
  'score.total': 'Totaal',
  'score.best': 'Beste score',
  'score.worst': 'Slechtste score',
  'score.ariaLabel': 'Scorebord',

  // Dialogen
  'dialog.chooseTrump': 'Kies de troefkleur',
  'dialog.chooseTrumpSub': 'Elke gewonnen slag levert deze ronde 1 punt op.',
  'dialog.suitNotAllowed': 'Deze kleur is nu niet toegestaan',
  'dialog.passTitle': 'Geef 3 kaarten door',
  'dialog.passSub': 'Kies 3 kaarten om {dir} door te geven.',
  'dialog.passConfirm': 'Doorgeven ({n}/3)',
  'pass.left': 'naar links',
  'pass.right': 'naar rechts',
  'pass.across': 'naar de overkant',
  'pass.none': '(niet doorgeven)',
  'lobby.game': 'Spel',
  'game.kingen': 'Kingen',
  'game.hartenjagen': 'Hartenjagen',
  'toast.heartsBroken': 'Harten zijn gebroken!',
  'toast.shootMoon': '{name} schiet de maan! 26 strafpunten voor de rest.',
  'dialog.chooseGame': 'Kies het spel voor deze ronde',
  'dialog.chooseGameSub': 'Jij bent de deler — bekijk je hand onderin beeld. Uitgespeelde keuzes zijn uitgeschakeld.',
  'dialog.unavailable': 'niet meer beschikbaar',

  // Eindstand
  'end.title': 'Eindstand',
  'end.sharedWin': 'Gedeelde winst voor {names}!',
  'end.wins': '{name} wint de partij!',
  'end.nobody': 'Niemand',
  'end.and': ' en ',
  'end.playAgain': 'Opnieuw spelen',
  'end.changeSettings': 'Andere instellingen',

  // Meldingen (toasts) en aankondigingen
  'announce.round': 'Ronde {num} — {name}',
  'toast.trumpChosen': '{name} kiest {suit} als troef',
  'toast.dealerPicks': '{name} (deler) kiest het spel',
  'toast.trickWon': '{name} wint slag {num}',
  'toast.handClaimed': '{name} legt de hand af en neemt {points} strafpunt(en)',
  'toast.trumpForce': 'Derde keuzebeurt zonder troef: de volgende twee keuzes zijn verplicht troef.',
  'toast.illegalMove': 'Die zet is hier niet toegestaan.',
  'toast.hotseat': 'Meerdere menselijke spelers aan één scherm komt later; de computer speelt die stoelen.',

  // Online (Fase 1)
  'online.title': 'Online spelen',
  'online.disconnected': 'Niet verbonden',
  'online.connecting': 'Verbinden…',
  'online.connected': 'Verbonden',
  'online.connect': 'Verbinden',
  'online.start': 'Start de partij',
  'online.namePlaceholder': 'Je naam',
  'online.defaultName': 'Speler',
  'online.joined': 'Je zit op stoel {num}. Wacht op spelers of start.',
  'online.backLocal': '← Lokaal spelen',
  'online.gameOver': 'Partij voorbij — winnaar: {winner}',
  'online.connectFailed': 'Verbinden met de server mislukt.',
  'online.reconnecting': 'Verbinding kwijt — opnieuw verbinden…',
  'online.reconnected': 'Weer verbonden.',
  // Lobby (Fase 2)
  'lobby.openTables': 'Open tafels',
  'lobby.noTables': 'Nog geen open tafels — maak er een aan.',
  'lobby.join': 'Meedoen',
  'lobby.newTable': 'Nieuwe tafel',
  'lobby.tableName': 'Naam van de tafel',
  'lobby.players': 'Spelers',
  'lobby.visibility': 'Zichtbaarheid',
  'lobby.open': 'Open',
  'lobby.private': 'Privé',
  'lobby.create': 'Tafel maken',
  'lobby.joinByCode': 'Meedoen met code',
  'lobby.codePlaceholder': 'Code (bijv. KAB3C)',
  'lobby.waitingRoom': 'Wachtkamer',
  'lobby.shareCode': 'Deel deze code: {code}',
  'lobby.leave': 'Tafel verlaten',
  'lobby.tableFull': 'vol',
  'lobby.inProgress': 'bezig',
  'lobby.defaultTableName': 'Tafel van {name}',
  'lobby.youTag': '(jij)',
  'lobby.hostTag': '★ host',
  'lobby.waitingForHost': 'Wacht tot de host de partij start…',
  'lobby.playAgain': 'Opnieuw spelen',

  // Chat
  'chat.title': 'Chat',
  'chat.placeholder': 'Typ een bericht…',
  'chat.send': 'Stuur',
  'chat.sysJoined': '{name} is erbij',
  'chat.sysLeft': '{name} heeft de tafel verlaten',
  'chat.sysAiTakeover': '{name} is even weg — de computer speelt',
  'chat.sysAway': '{name} is weg — de computer neemt het over',
  'chat.sysBack': '{name} is terug',
} as const;

export type TranslationKey = keyof typeof nl;

const en: Record<TranslationKey, string> = {
  // General
  'app.title': 'Kingen',
  'app.startError': 'Something went wrong while starting: {message}',
  'app.roomName': "{name}'s table",
  'app.seat': 'Seat {num}',

  // Suits
  'suit.hearts': 'Hearts',
  'suit.diamonds': 'Diamonds',
  'suit.clubs': 'Clubs',
  'suit.spades': 'Spades',

  // Round kinds
  'round.geenSlagen': 'No tricks',
  'round.geenHarten': 'No hearts',
  'round.geenHerenBoeren': 'No kings & jacks',
  'round.geenDames': 'No queens',
  'round.hartenheer': 'The King (no King of Hearts)',
  'round.zevenLaatste': 'No 7th and last trick',
  'round.troef': 'Trumps',

  // Round explanations
  'roundInfo.geenSlagen': 'Every trick you win costs 1 penalty point, so avoid taking tricks.',
  'roundInfo.geenHarten': 'Every heart in the tricks you win costs 1 penalty point.',
  'roundInfo.geenHerenBoeren': 'Every king or jack you take in costs 1 penalty point.',
  'roundInfo.geenDames': 'Every queen you take in costs 2 penalty points.',
  'roundInfo.hartenheer': 'Whoever takes the King of Hearts gets the full penalty. The round may stop as soon as it falls.',
  'roundInfo.zevenLaatste': 'The seventh trick costs 2 penalty points, the very last trick 3.',
  'roundInfo.troef': 'Positive round: every trick you win scores 1 point. A trump suit applies.',
  'roundInfo.fallback': 'Play the tricks according to the goal of this round.',

  // Environments
  'env.cafe': 'Café',
  'env.cafe.desc': 'Warm lamplight, wood and cosiness',
  'env.keukentafel': 'Kitchen table',
  'env.keukentafel.desc': 'A homely game under the pendant lamp',
  'env.casino': 'Casino',
  'env.casino.desc': 'Green felt and dimmed spotlights',

  // AI levels
  'ai.makkelijk': 'Easy',
  'ai.gemiddeld': 'Medium',
  'ai.moeilijk': 'Hard',

  // Trump selection
  'trumpMode.delerKiest': 'Dealer chooses trump',
  'trumpMode.laatsteKaart': 'Last card dealt sets trump',
  'trumpMode.uitkomerKiest': 'Player who leads chooses trump',

  // Setup screen
  'setup.you': 'You',
  'setup.subtitle': 'The classic Dutch card game — now in 3D',
  'setup.playOnline': '🌐 Play online with others',
  'setup.language': 'Language',
  'setup.playerCount': 'Number of players',
  'setup.playersN': '{n} players',
  'setup.playerCountHint': 'With 3 or 5 players a few twos are removed from the deck so the cards deal out evenly.',
  'setup.atTable': 'At the table',
  'setup.playerPlaceholder': 'Player {n}',
  'setup.human': 'Human',
  'setup.computer': 'Computer',
  'setup.aiLevelTitle': 'Playing strength of the computer player',
  'setup.seat0Title': 'Seat 1 is your own seat',
  'setup.hotseatTitle': 'Multiple human players on one screen is coming later',
  'setup.aiSeatTitle': 'This seat is played by the computer',
  'setup.environment': 'Environment',
  'setup.rules': 'Rules',
  'setup.presetName': 'Standard (Dutch)',
  'setup.presetHint': '10 rounds, dealer chooses trump, King of Hearts 5 points, strict house rules.',
  'setup.presetRestore': 'Restore defaults',
  'setup.modeHeading': 'Game mode',
  'setup.modeLabel': 'Mode',
  'setup.modeStandard': 'Standard (10 rounds)',
  'setup.modeDouble': 'Double Kings (dealer picks the game)',
  'setup.modeHintStandard': 'Fixed order: six negative rounds, then one trump round per player.',
  'setup.modeHintDouble': 'The dealer picks the game each round; each negative game at most twice, trumps exactly twice per player.',
  'setup.trumpSelectionLabel': 'Trump selection',
  'setup.trumpSelectionHint': 'How is the trump suit decided in trump rounds?',
  'setup.heartKingLabel': 'Penalty for the King of Hearts',
  'setup.heartKingHint': '5 points is common in the Netherlands; 4 is the classic count.',
  'setup.penaltyPoints': '{n} penalty points',
  'setup.trumpRoundsHeading': 'Trump rounds',
  'setup.mustTrumpLabel': 'Must trump',
  'setup.mustTrumpHint': 'If you cannot follow suit, you must play a trump card if you have one.',
  'setup.mustOvertrumpLabel': 'Must overtrump',
  'setup.mustOvertrumpHint': 'If a trump has already been played, you must beat it with a higher trump if you can.',
  'setup.negativeRoundsHeading': 'Negative rounds',
  'setup.stopKingLabel': 'The King ends the round',
  'setup.stopKingHint': 'As soon as the King of Hearts falls, the King round ends immediately.',
  'setup.strictHeading': 'Strict discards (when unable to follow suit)',
  'setup.strictHeartsLabel': 'Strict in “No hearts”',
  'setup.strictHeartsHint': 'If you cannot follow suit, you must discard a heart if you have one.',
  'setup.strictKJLabel': 'Strict in “No kings & jacks”',
  'setup.strictKJHint': 'If you cannot follow suit, you must discard a king or jack if you have one.',
  'setup.strictQueensLabel': 'Strict in “No queens”',
  'setup.strictQueensHint': 'If you cannot follow suit, you must discard a queen if you have one.',
  'setup.strictKingLabel': 'Strict in “The King”',
  'setup.strictKingHint': 'If you cannot follow suit, you must discard the King of Hearts if you hold it.',
  'setup.heartLeadHeading': 'Leading with hearts',
  'setup.heartLeadHeartsLabel': 'No heart leads in “No hearts”',
  'setup.heartLeadKingLabel': 'No heart leads in “The King”',
  'setup.heartLeadHint': 'You may not lead with hearts unless hearts are all you have left.',
  'setup.otherRulesHeading': 'Other rules',
  'setup.forcedTrumpLabel': 'Forced trumps on third pick (Double Kings)',
  'setup.forcedTrumpHint': 'A dealer who has never picked trumps by their third pick is then forced to (championship rule).',
  'setup.claimingLabel': 'Throwing in your hand allowed',
  'setup.claimingHint': 'A player may throw in their hand and take all remaining penalty points at once (championship rule).',
  'setup.lowestWinsLabel': 'Everything counts as penalty — lowest wins',
  'setup.lowestWinsHint': 'Trump tricks also count as penalty points; the lowest total wins.',
  'setup.orderHeading': 'Order of the negative rounds',
  'setup.orderHint': 'Standard mode only; the trump rounds follow afterwards. Hover over a round for an explanation.',
  'setup.moveEarlier': 'Play earlier',
  'setup.moveLater': 'Play later',
  'setup.start': 'Deal the cards',

  // HUD
  'hud.scoreboard': '♛ Scoreboard',
  'hud.scoreboardTitle': 'Show or hide the scoreboard',
  'hud.settings': '⚙ Settings',
  'hud.settingsHeading': 'Settings',
  'hud.environment': 'Environment',
  'hud.language': 'Language',
  'hud.brightness': 'Brightness',
  'hud.cameraMotion': 'Camera motion',
  'hud.cameraMotionHint': 'Camera follows the mouse slightly (holds still while picking a card)',
  'hud.sound': 'Sound',
  'hud.comingSoon': 'coming soon',
  'hud.quit': 'Quit game',
  'hud.quitConfirm': 'Quit this game and return to the start screen?',
  'hud.claim': '✋ Throw in hand',
  'hud.claimTitle': 'Throw in your hand and take all remaining penalty points of this round at once',
  'hud.claimConfirm': 'Throw in your hand and take all remaining penalty points of this round?',
  'hud.roundOf': 'Round {num} of {total}',
  'hud.trumpPrefix': 'Trump:',
  'hud.noTrump': 'No trump',
  'hud.roundInfoAria': 'Show or hide the goal of this round',
  'hud.roundGoal': 'Goal of this round',
  'hud.tricksTitle': 'Tricks won this round',
  'hud.pointsTitle': 'Total (penalty) points so far',
  'hud.speed': 'Game speed',
  'hud.speedLangzaam': 'Slow',
  'hud.speedNormaal': 'Normal',
  'hud.speedSnel': 'Fast',
  'hud.speedDirect': 'Instant',
  'hud.chipHuman': 'human',
  'hud.chipAi': 'computer',

  // Scoreboard
  'score.title': 'Scoreboard',
  'score.close': 'Close',
  'score.tabScore': 'Score',
  'score.tabChat': 'Chat',
  'score.chatSoon': 'soon',
  'score.chatLaterTitle': 'Online chat is coming later',
  'score.chatLater': 'Online chat is coming later.',
  'score.noRounds': 'No rounds played yet.',
  'score.roundColumn': 'Round',
  'score.total': 'Total',
  'score.best': 'Best score',
  'score.worst': 'Worst score',
  'score.ariaLabel': 'Scoreboard',

  // Dialogs
  'dialog.passTitle': 'Pass 3 cards',
  'dialog.passSub': 'Choose 3 cards to pass {dir}.',
  'dialog.passConfirm': 'Pass ({n}/3)',
  'pass.left': 'to the left',
  'pass.right': 'to the right',
  'pass.across': 'across',
  'pass.none': '(no passing)',
  'lobby.game': 'Game',
  'game.kingen': 'Kingen',
  'game.hartenjagen': 'Hearts',
  'toast.heartsBroken': 'Hearts have been broken!',
  'toast.shootMoon': '{name} shot the moon! 26 penalty points for everyone else.',
  'dialog.chooseTrump': 'Choose the trump suit',
  'dialog.chooseTrumpSub': 'Every trick you win this round scores 1 point.',
  'dialog.suitNotAllowed': 'This suit is not allowed right now',
  'dialog.chooseGame': 'Choose the game for this round',
  'dialog.chooseGameSub': 'You are the dealer — check your hand at the bottom of the screen. Used-up options are disabled.',
  'dialog.unavailable': 'no longer available',

  // Final standings
  'end.title': 'Final standings',
  'end.sharedWin': 'Shared victory for {names}!',
  'end.wins': '{name} wins the game!',
  'end.nobody': 'Nobody',
  'end.and': ' and ',
  'end.playAgain': 'Play again',
  'end.changeSettings': 'Change settings',

  // Toasts and announcements
  'announce.round': 'Round {num} — {name}',
  'toast.trumpChosen': '{name} picks {suit} as trump',
  'toast.dealerPicks': '{name} (dealer) picks the game',
  'toast.trickWon': '{name} takes trick {num}',
  'toast.handClaimed': '{name} throws in their hand and takes {points} penalty point(s)',
  'toast.trumpForce': 'Third pick without trumps: the next two picks must be trumps.',
  'toast.illegalMove': 'That move is not allowed here.',
  'toast.hotseat': 'Multiple human players on one screen is coming later; the computer plays those seats.',

  // Online (Fase 1)
  'online.title': 'Play online',
  'online.disconnected': 'Not connected',
  'online.connecting': 'Connecting…',
  'online.connected': 'Connected',
  'online.connect': 'Connect',
  'online.start': 'Start the game',
  'online.namePlaceholder': 'Your name',
  'online.defaultName': 'Player',
  'online.joined': "You're in seat {num}. Wait for players or start.",
  'online.backLocal': '← Play local',
  'online.gameOver': 'Game over — winner: {winner}',
  'online.connectFailed': 'Could not connect to the server.',
  'online.reconnecting': 'Connection lost — reconnecting…',
  'online.reconnected': 'Reconnected.',
  // Lobby (Fase 2)
  'lobby.openTables': 'Open tables',
  'lobby.noTables': 'No open tables yet — create one.',
  'lobby.join': 'Join',
  'lobby.newTable': 'New table',
  'lobby.tableName': 'Table name',
  'lobby.players': 'Players',
  'lobby.visibility': 'Visibility',
  'lobby.open': 'Open',
  'lobby.private': 'Private',
  'lobby.create': 'Create table',
  'lobby.joinByCode': 'Join with code',
  'lobby.codePlaceholder': 'Code (e.g. KAB3C)',
  'lobby.waitingRoom': 'Waiting room',
  'lobby.shareCode': 'Share this code: {code}',
  'lobby.leave': 'Leave table',
  'lobby.tableFull': 'full',
  'lobby.inProgress': 'in progress',
  'lobby.defaultTableName': "{name}'s table",
  'lobby.youTag': '(you)',
  'lobby.hostTag': '★ host',
  'lobby.waitingForHost': 'Waiting for the host to start…',
  'lobby.playAgain': 'Play again',

  // Chat
  'chat.title': 'Chat',
  'chat.placeholder': 'Type a message…',
  'chat.send': 'Send',
  'chat.sysJoined': '{name} joined',
  'chat.sysLeft': '{name} left the table',
  'chat.sysAiTakeover': '{name} is away — the computer is playing',
  'chat.sysAway': '{name} is away — the computer takes over',
  'chat.sysBack': '{name} is back',
};

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { nl, en };

// ---------------------------------------------------------------------------
// Taalkeuze + persistentie + subscribe
// ---------------------------------------------------------------------------

function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'nl' || stored === 'en') return stored;
  } catch {
    // localStorage kan geblokkeerd zijn (privacy-modus); val terug op default.
  }
  return DEFAULT_LANG;
}

let currentLang: Lang = readStoredLang();
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return currentLang;
}

/** Korte rang-labels voor de kaarttextures in de actieve taal (NL B/V/H, EN J/Q/K). */
export function rankLabels(): Readonly<Record<Rank, string>> {
  return currentLang === 'en' ? RANK_LABELS_EN : RANK_LABELS_NL;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Persistentie is best-effort.
  }
  for (const listener of [...listeners]) listener(lang);
}

/** Abonneer op taalwissels; retourneert een unsubscribe-functie. */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// t() met {placeholder}-interpolatie
// ---------------------------------------------------------------------------

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[currentLang][key] ?? DICTIONARIES[DEFAULT_LANG][key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// ---------------------------------------------------------------------------
// Afgeleide helpers (taalneutrale id's -> zichtbare namen)
// ---------------------------------------------------------------------------

const KNOWN_ROUND_KINDS: readonly string[] = [
  'geenSlagen', 'geenHarten', 'geenHerenBoeren', 'geenDames', 'hartenheer', 'zevenLaatste', 'troef',
];

function isRoundKind(kind: string): kind is KingenRoundKind {
  return KNOWN_ROUND_KINDS.includes(kind);
}

/** Zichtbare naam van een rondesoort; onbekende soorten vallen terug op de id. */
export function roundKindName(kind: string): string {
  return isRoundKind(kind) ? t(`round.${kind}`) : kind;
}

/** Uitleg bij een rondesoort (HUD-tooltip, dialogen, setup). */
export function roundKindExplanation(kind: string): string {
  return isRoundKind(kind) ? t(`roundInfo.${kind}`) : t('roundInfo.fallback');
}

export function suitName(suit: Suit): string {
  return t(`suit.${suit}`);
}

export function environmentName(id: EnvironmentId): string {
  return t(`env.${id}`);
}

export function environmentDescription(id: EnvironmentId): string {
  return t(`env.${id}.desc`);
}

export function aiLevelName(level: 'makkelijk' | 'gemiddeld' | 'moeilijk'): string {
  return t(`ai.${level}`);
}

export function trumpModeName(mode: TrumpSelectionMode): string {
  return t(`trumpMode.${mode}`);
}
