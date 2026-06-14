/**
 * @kingen/client — net/statsBeacon.ts
 * Meldt LOKALE partijen (lokaal-tegen-de-computer) aan de server-statistiek. Die
 * partijen draaien in de browser (in-browser host) en raken de server normaal niet,
 * dus zouden ze niet meetellen. Een lichte beacon naar /api/stats/lokaal lost dat op.
 *
 * Best-effort en niet-blokkerend: statistiek mag het spel nooit ophouden of breken.
 * sendBeacon overleeft ook het sluiten/wegnavigeren van de pagina.
 */

export function reportLocalGame(gameId: string, event: 'start' | 'finish'): void {
  try {
    const body = JSON.stringify({ gameId, event });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/stats/lokaal', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/stats/lokaal', {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch {
    // bewust stil: een mislukte statistiek-beacon mag de partij niet raken
  }
}
