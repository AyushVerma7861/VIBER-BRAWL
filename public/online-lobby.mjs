export const websocketUrl = (origin, path) => {
  const url = new URL(path, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
};

export async function loadRegions() {
  try {
    const response = await fetch('/duel-regions', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const config = await response.json();
    return { ...config, regions: new Map(config.regions.map(region => [
      region.id, { ...region, origin: region.origin || location.origin },
    ])) };
  } catch { return null; }
}

export async function measureRegion(region, signal) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    if (signal.aborted) break;
    const started = performance.now();
    try {
      const response = await fetch(new URL('/duel-ping', region.origin), {
        cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(i ? 2500 : 65_000)]),
      });
      if (response.ok && (await response.json()).region === region.id && i) {
        samples.push(Math.round(performance.now() - started));
      }
    } catch {}
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

export function parseRoom(value, regions, localOrigin) {
  try {
    const url = new URL(value);
    if (url.origin !== localOrigin && ![...regions.values()].some(region => region.origin === url.origin)) return null;
    return { code: url.searchParams.get('room') || '', origin: url.origin };
  } catch {
    return { code: value, origin: null };
  }
}
