/**
 * @kingen/server — stats.ts
 * Eenvoudige in-memory statistiek: telt gestarte/voltooide partijen en houdt
 * de starttijden 24u bij voor "afgelopen uur/dag". Reset bij serverherstart
 * (persistentie naar schijf kan later).
 */

export interface StatsSnapshot {
  gestartLaatsteUur: number;
  gestartLaatste24u: number;
  gestartTotaal: number;
  voltooid: number;
  uptimeSec: number;
}

export class Stats {
  private readonly startTijden: number[] = [];
  private totaalGestart = 0;
  private voltooid = 0;
  private readonly bootAt = Date.now();

  recordStart(): void {
    this.totaalGestart++;
    this.startTijden.push(Date.now());
    this.prune();
  }

  recordFinish(): void {
    this.voltooid++;
  }

  private prune(): void {
    const grens = Date.now() - 24 * 3600_000;
    while (this.startTijden.length > 0 && (this.startTijden[0] ?? 0) < grens) this.startTijden.shift();
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
