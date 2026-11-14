export function mountDiagnostics(bar) {
  const panel = document.createElement('pre');
  panel.className = 'duel-diagnostics';
  panel.setAttribute('aria-label', 'Network diagnostics');
  bar.after(panel);

  let latestUpdate, drawAt;
  let frameWorst, updateWorst, localWorst, remoteWorst, updateGaps, frameHitches;

  function reset() {
    latestUpdate = undefined;
    drawAt = -Infinity;
    frameWorst = updateWorst = localWorst = remoteWorst = updateGaps = frameHitches = 0;
    panel.textContent = 'Waiting for duel updates…';
  }
  reset();

  return {
    reset,
    snapshot(now) {
      if (latestUpdate !== undefined) {
        const gap = now - latestUpdate;
        updateWorst = Math.max(updateWorst, gap);
        if (gap > 150) updateGaps++;
      }
      latestUpdate = now;
    },
    localCorrection(distance) { localWorst = Math.max(localWorst, distance); },
    remoteCorrection(distance) { remoteWorst = Math.max(remoteWorst, distance); },
    frame(now, elapsed, ping) {
      const frameMs = elapsed * 1000;
      frameWorst = Math.max(frameWorst, frameMs);
      if (frameMs > 50) frameHitches++;
      if (now - drawAt < 500) return;
      drawAt = now;
      const timing = value => Number.isFinite(value) ? Math.round(value) + ' ms' : '—';
      const age = latestUpdate === undefined ? NaN : now - latestUpdate;
      panel.textContent = [
        'Ping ' + timing(ping),
        'Game update age ' + timing(age) + ' · largest gap ' + timing(Math.max(updateWorst, age || 0)),
        'Longest frame ' + timing(frameWorst),
        'Largest position correction (arena units)',
        '  You ' + localWorst.toFixed(2) + ' · Opponent ' + remoteWorst.toFixed(2),
        'Update gaps >150 ms: ' + updateGaps + ' · Frames >50 ms: ' + frameHitches,
      ].join('\n');
    },
    pause() {
      latestUpdate = undefined;
      drawAt = -Infinity;
    },
  };
}
