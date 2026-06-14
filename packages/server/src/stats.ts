/**
 * @kingen/server — stats.ts
 * Statistiek over gestarte/voltooide partijen, UITGESPLITST per spel én per modus
 * (online via de server vs. lokaal-tegen-de-computer, dat laatste via een beacon
 * vanuit de client). Houdt starttijden 24u bij voor "afgelopen uur/dag" en de
 * cumulatieve totalen. Optioneel persistent naar een JSON-bestand (STATS_FILE) op
 * een Docker-volume, zodat de cijfers serverherstarts/rebuilds overleven. De
 * uptime blijft per proces (reset bij herstart — dat hoort zo).
 *
 * Backward-compatibel: een oud bestand (alleen totaalGestart/voltooid/startTijden,
 * vóór de per-spel-splitsing) wordt geladen als "historie" en bij de grand totals
 * opgeteld, zodat er geen cijfers verloren gaan.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export type SpelModus = 'online' | 'lokaal';

export interface ModusTelling {
  gestart: number;
  voltooid: number;
}

export interface SpelStat {
  gameId: string;
  online: ModusTelling;
  lokaal: ModusTelling;
}

export interface StatsSnapshot {
  gestartLaatsteUur: number;
  gestartLaatste24u: number;
  gestartTotaal: number;
  voltooid: number;
  uptimeSec: number;
  /** Som over alle spellen, per modus. */
  online: ModusTelling;
  lokaal: ModusTelling;
  /** Per spel uitgesplitst, gesorteerd op meest-gestart. */
  perSpel: SpelStat[];
}

interface SpelIntern {
  online: ModusTelling;
  lokaal: ModusTelling;
}

const leegModus = (): ModusTelling => ({ gestart: 0, voltooid: 0 });

export class Stats {
  private startTijden: number[] = [];
  private perSpel = new Map<string, SpelIntern>();
  // Historie van vóór de per-spel-splitsing (oud bestandsformaat) — niet aan een
  // spel toe te wijzen, maar wel meegeteld in de grand totals.
  private legacyGestart = 0;
  private legacyVoltooid = 0;
  private readonly bootAt = Date.now();
  private opslaanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const d = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        this.startTijden = Array.isArray(d.startTijden) ? (d.startTijden as number[]) : [];
        const per = d.perSpel as Record<string, SpelIntern> | undefined;
        if (per && typeof per === 'object') {
          for (const [id, v] of Object.entries(per)) {
            this.perSpel.set(id, {
              online: { gestart: v.online?.gestart ?? 0, voltooid: v.online?.voltooid ?? 0 },
              lokaal: { gestart: v.lokaal?.gestart ?? 0, voltooid: v.lokaal?.voltooid ?? 0 },
            });
          }
        }
        // Oud formaat zonder perSpel → bewaar als historie.
        this.legacyGestart = typeof d.legacyGestart === 'number'
          ? d.legacyGestart
          : (per ? 0 : (typeof d.totaalGestart === 'number' ? d.totaalGestart : 0));
        this.legacyVoltooid = typeof d.legacyVoltooid === 'number'
          ? d.legacyVoltooid
          : (per ? 0 : (typeof d.voltooid === 'number' ? d.voltooid : 0));
        this.prune();
      } catch {
        // Corrupt/leeg bestand → vers beginnen.
      }
    }
  }

  private spel(gameId: string): SpelIntern {
    let s = this.perSpel.get(gameId);
    if (!s) {
      s = { online: leegModus(), lokaal: leegModus() };
      this.perSpel.set(gameId, s);
    }
    return s;
  }

  recordStart(gameId: string, modus: SpelModus): void {
    this.spel(gameId)[modus].gestart++;
    this.startTijden.push(Date.now());
    this.prune();
    this.planOpslaan();
  }

  recordFinish(gameId: string, modus: SpelModus): void {
    this.spel(gameId)[modus].voltooid++;
    this.planOpslaan();
  }

  private prune(): void {
    const grens = Date.now() - 24 * 3600_000;
    while (this.startTijden.length > 0 && (this.startTijden[0] ?? 0) < grens) this.startTijden.shift();
  }

  /** Schrijf (gedebounced) naar het bestand, zodat bursts niet te vaak schrijven. */
  private planOpslaan(): void {
    if (!this.file || this.opslaanTimer) return;
    this.opslaanTimer = setTimeout(() => {
      this.opslaanTimer = null;
      this.schrijfNu();
    }, 1000);
  }

  /**
   * Schrijf atomair: eerst naar een temp-bestand, dan rename. Zo blijft bij een
   * crash midden in de schrijf het oude bestand intact (geen half/corrupt JSON).
   */
  private schrijfNu(): void {
    if (!this.file) return;
    const perSpel: Record<string, SpelIntern> = {};
    for (const [id, v] of this.perSpel) perSpel[id] = v;
    const data = JSON.stringify({
      startTijden: this.startTijden,
      perSpel,
      legacyGestart: this.legacyGestart,
      legacyVoltooid: this.legacyVoltooid,
    });
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[stats] opslaan mislukt:', (err as Error).message);
    }
  }

  /** Schrijf eventueel uitgestelde data direct weg (bij nette shutdown). */
  flush(): void {
    if (!this.opslaanTimer) return;
    clearTimeout(this.opslaanTimer);
    this.opslaanTimer = null;
    this.schrijfNu();
  }

  snapshot(): StatsSnapshot {
    const now = Date.now();
    const sinds = (ms: number): number => this.startTijden.filter((t) => now - t <= ms).length;

    const online = leegModus();
    const lokaal = leegModus();
    const perSpel: SpelStat[] = [];
    for (const [gameId, v] of this.perSpel) {
      online.gestart += v.online.gestart;
      online.voltooid += v.online.voltooid;
      lokaal.gestart += v.lokaal.gestart;
      lokaal.voltooid += v.lokaal.voltooid;
      perSpel.push({ gameId, online: { ...v.online }, lokaal: { ...v.lokaal } });
    }
    perSpel.sort(
      (a, b) => b.online.gestart + b.lokaal.gestart - (a.online.gestart + a.lokaal.gestart),
    );

    return {
      gestartLaatsteUur: sinds(3600_000),
      gestartLaatste24u: sinds(24 * 3600_000),
      gestartTotaal: this.legacyGestart + online.gestart + lokaal.gestart,
      voltooid: this.legacyVoltooid + online.voltooid + lokaal.voltooid,
      uptimeSec: Math.floor((now - this.bootAt) / 1000),
      online,
      lokaal,
      perSpel,
    };
  }
}
