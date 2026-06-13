/**
 * @kingen/server — stats.ts
 * Statistiek over gestarte/voltooide partijen. Houdt starttijden 24u bij voor
 * "afgelopen uur/dag" en de cumulatieve totalen. Optioneel persistent naar een
 * JSON-bestand (STATS_FILE) op een Docker-volume, zodat de cijfers
 * serverherstarts/rebuilds overleven. De uptime blijft per proces (resets bij
 * herstart — dat hoort zo).
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export interface StatsSnapshot {
  gestartLaatsteUur: number;
  gestartLaatste24u: number;
  gestartTotaal: number;
  voltooid: number;
  uptimeSec: number;
}

export class Stats {
  private startTijden: number[] = [];
  private totaalGestart = 0;
  private voltooid = 0;
  private readonly bootAt = Date.now();
  private opslaanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const d = JSON.parse(readFileSync(file, 'utf8')) as {
          totaalGestart?: number;
          voltooid?: number;
          startTijden?: number[];
        };
        this.totaalGestart = d.totaalGestart ?? 0;
        this.voltooid = d.voltooid ?? 0;
        this.startTijden = Array.isArray(d.startTijden) ? d.startTijden : [];
        this.prune();
      } catch {
        // Corrupt/leeg bestand → vers beginnen.
      }
    }
  }

  recordStart(): void {
    this.totaalGestart++;
    this.startTijden.push(Date.now());
    this.prune();
    this.planOpslaan();
  }

  recordFinish(): void {
    this.voltooid++;
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
   * crash midden in de schrijf het oude bestand intact (geen half/corrupt JSON
   * dat de volgende boot niet kan parsen).
   */
  private schrijfNu(): void {
    if (!this.file) return;
    const data = JSON.stringify({
      totaalGestart: this.totaalGestart,
      voltooid: this.voltooid,
      startTijden: this.startTijden,
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
    return {
      gestartLaatsteUur: sinds(3600_000),
      gestartLaatste24u: sinds(24 * 3600_000),
      gestartTotaal: this.totaalGestart,
      voltooid: this.voltooid,
      uptimeSec: Math.floor((now - this.bootAt) / 1000),
    };
  }
}
