/**
 * @kingen/server — stats.ts
 * Statistiek over gestarte/voltooide partijen. Houdt starttijden 24u bij voor
 * "afgelopen uur/dag" en de cumulatieve totalen. Optioneel persistent naar een
 * JSON-bestand (STATS_FILE) op een Docker-volume, zodat de cijfers
 * serverherstarts/rebuilds overleven. De uptime blijft per proces (resets bij
 * herstart — dat hoort zo).
 */

import { existsSync, readFileSync, writeFile } from 'node:fs';

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
      const data = JSON.stringify({
        totaalGestart: this.totaalGestart,
        voltooid: this.voltooid,
        startTijden: this.startTijden,
      });
      writeFile(this.file!, data, (err) => {
        if (err) console.error('[stats] opslaan mislukt:', err.message);
      });
    }, 1000);
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
