import { ATTACK, DASH, HEAVY, JUMP, QUICK, ROOM_CODE, STEP, TICK_RATE, lerpAngle, stepFighter } from './online-sim.mjs';
import { OpponentClock, unpackFighter } from './online-net.mjs';
import { loadRegions, measureRegion, parseRoom, websocketUrl } from './online-lobby.mjs';

const positionKeys = ['x', 'y', 'z'];
const invitation = new URL(location.href).searchParams.get('room') || '';
const open = WebSocket.OPEN;
const hostStorageKey = 'dungeon-duel-host';

function readSeat() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(hostStorageKey));
    if (saved && ROOM_CODE.test(saved.code) && /^[A-Za-z0-9_-]{24}$/.test(saved.token)) return saved;
  } catch {}
  return null;
}

export function mountOnline(arena) {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/online.css';
  document.head.append(css);
  document.body.classList.add('online-duel');

  const panel = document.createElement('section');
  panel.className = 'duel-panel';
  panel.innerHTML = `
    <div class="duel-lobby">
      <p class="duel-label">VIBER BRAWL / ONLINE ALPHA</p>
      <h1>Dungeon Duel</h1>
      <p data-ui="status" role="status">Online 1v1. Three stocks each.</p>
      <div data-ui="entry">
        <details data-ui="servers" hidden>
          <summary>Servers <span data-ui="region-summary"></span></summary>
          <label for="duel-region">Server preference</label>
          <select id="duel-region"><option value="">Auto</option></select>
          <p class="duel-help">Auto chooses for both players in Quick Match. For a room code, select the host’s server. Invite links pick it for you.</p>
        </details>
        <div class="duel-row duel-actions">
          <button data-ui="quick" type="button" hidden>Quick Match</button>
          <button data-ui="create" type="button">Create private room</button>
        </div>
        <button data-ui="resume" type="button" hidden>Resume hosting</button>
        <form data-ui="join-form">
          <label for="duel-code">Room code or invite link</label>
          <div class="duel-row"><input id="duel-code" maxlength="220" autocomplete="off" autocapitalize="none" spellcheck="false" required><button type="submit">Join</button></div>
        </form>
      </div>
      <div data-ui="invite" hidden>
        <label for="duel-link">Send this invite to a friend</label>
        <div class="duel-row"><input id="duel-link" readonly><button data-ui="copy" type="button">Copy</button></div>
        <p class="duel-help">Keep this host tab open. Open the invite on another device or in a second tab.</p>
      </div>
      <button data-ui="rematch" type="button" hidden>Rematch</button>
      <p class="duel-help">Move with WASD or arrows. Space to jump, Shift to dash, J for quick hit and K for heavy hit. On a phone, play in landscape.</p>
    </div>`;
  const matchBar = document.createElement('div');
  matchBar.className = 'duel-bar';
  matchBar.hidden = true;
  matchBar.innerHTML = '<span data-ui="ping"></span><button type="button" data-ui="leave">Leave</button>';
  document.body.append(panel, matchBar);
  const ui = Object.fromEntries([...panel.querySelectorAll('[data-ui]'), ...matchBar.querySelectorAll('[data-ui]')]
    .map(element => [element.dataset.ui, element]));
  const codeField = panel.querySelector('#duel-code');
  const linkField = panel.querySelector('#duel-link');
  const regionField = panel.querySelector('#duel-region');
  if (ROOM_CODE.test(invitation)) {
    codeField.value = invitation;
    ui.status.textContent = 'Invite ready. Select Join to enter.';
  }

  let socket, queue, queueTimer, pingTimer, connectTimer, reconnectTimer;
  let probeController, probeTimer, config;
  const regions = new Map();
  const regionPings = new Map();
  const regionPingTimes = new Map();
  const regionOptions = new Map();
  let seat = readSeat();
  let reconnectUntil = 0, retryDelay = 500, lastServerAt = 0;
  let paused = false;
  ui.resume.hidden = !seat;
  ui.resume.textContent = seat?.inMatch ? 'Resume duel' : 'Resume hosting';
  let slot = -1;
  let round = 0, epoch = 0;
  let latest, predicted, receivedAt;
  let seq = 0, accumulator = 0, renderTick = 0;
  let opponentClock = new OpponentClock();
  let pending = [], unsent = [], snapshots = [];
  let offset = [0, 0, 0];
  let banner = '', lastRemote = null, guessedRemote = false;
  let remoteOffset = [0, 0, 0];
  let rtt = NaN;
  let pingSamples = [];

  const send = message => {
    if (socket?.readyState === open) socket.send(JSON.stringify(message));
  };
  const setStatus = message => { ui.status.textContent = message; };
  const knownOrigin = origin => origin === location.origin || [...regions.values()].some(region => region.origin === origin);
  const regionOrigin = id => regions.get(id)?.origin || location.origin;
  const regionName = origin => [...regions.values()].find(region => region.origin === origin)?.name || '';
  function preferredOrigin() {
    return regionField.value ? regionOrigin(regionField.value) : regionOrigin(config?.local);
  }
  function bestOrigin() {
    if (regionField.value) return preferredOrigin();
    const best = [...regionPings].filter(([id]) => performance.now() - regionPingTimes.get(id) < 30_000)
      .sort((a, b) => a[1] - b[1])[0];
    return best ? regionOrigin(best[0]) : preferredOrigin();
  }
  function updateRegionSummary() {
    const best = [...regionPings].sort((a, b) => a[1] - b[1])[0]?.[0];
    const id = regionField.value || best;
    const ping = regionPings.get(id);
    ui['region-summary'].textContent = id ? '· ' + regions.get(id).name + (Number.isFinite(ping) ? ' · ' + ping + ' ms' : '') : '· Auto';
  }
  function keepRegionPing(id, ping) {
    if (ping === null) regionPings.delete(id);
    else {
      regionPings.set(id, ping);
      regionPingTimes.set(id, performance.now());
    }
    regionOptions.get(id).textContent = regions.get(id).name + ' · ' + (ping === null ? 'unavailable' : ping + ' ms');
    updateRegionSummary();
  }
  function stopProbes() {
    clearTimeout(probeTimer);
    probeController?.abort();
    probeController = null;
  }
  function refreshRegions(force = false) {
    if (!config || probeController || (!force && (ui.entry.hidden || document.hidden))) return;
    const controller = probeController = new AbortController();
    for (const [id, region] of regions) {
      if (!regionPings.has(id)) regionOptions.get(id).textContent = region.name + ' · checking…';
    }
    Promise.all([...regions].map(async ([id, region]) => {
      const ping = await measureRegion(region, controller.signal);
      if (controller.signal.aborted) return;
      keepRegionPing(id, ping);
    })).finally(() => {
      if (probeController !== controller) return;
      probeController = null;
      if (ui.servers.open) probeTimer = setTimeout(refreshRegions, 12_000);
    });
  }
  ui.servers.ontoggle = () => {
    if (ui.servers.open) refreshRegions();
    else stopProbes();
  };
  regionField.onchange = updateRegionSummary;
  loadRegions().then(value => {
    if (!value) return;
    config = value;
    for (const [id, region] of value.regions) {
      regions.set(id, region);
      const option = new Option(region.name, id);
      regionOptions.set(id, option);
      regionField.add(option);
    }
    ui.servers.hidden = regions.size < 2;
    ui.quick.hidden = false;
    updateRegionSummary();
  });
  function rememberSeat(value) {
    seat = value;
    ui.resume.hidden = !value;
    ui.resume.textContent = value?.inMatch ? 'Resume duel' : 'Resume hosting';
    try {
      if (value) sessionStorage.setItem(hostStorageKey, JSON.stringify(value));
      else sessionStorage.removeItem(hostStorageKey);
    } catch {}
  }
  function closeConnection() {
    stopProbes();
    clearInterval(queueTimer);
    const previousQueue = queue;
    queue = null;
    previousQueue?.close();
    clearInterval(pingTimer);
    clearTimeout(connectTimer);
    clearTimeout(reconnectTimer);
    const previous = socket;
    socket = null;
    previous?.close();
  }
  function reset(message) {
    closeConnection();
    reconnectUntil = 0;
    paused = false;
    latest = null;
    slot = -1;
    round = 0;
    panel.hidden = false;
    matchBar.hidden = true;
    ui.entry.hidden = false;
    ui.invite.hidden = true;
    ui.rematch.hidden = true;
    setStatus(message);
    arena.lobby();
    if (ui.servers.open) refreshRegions();
  }

  function retrySeat() {
    if (!seat || Date.now() >= reconnectUntil) {
      if (seat?.inMatch) rememberSeat(null);
      reset('Could not reconnect to the duel. Try again with a new invite.');
      return;
    }
    closeConnection();
    if (latest) {
      paused = true;
      arena.release();
      ui.ping.textContent = 'Reconnecting…';
    } else {
      setStatus('Reconnecting to your duel…');
    }
    reconnectTimer = setTimeout(() => connect(seat.code, seat.token, seat.origin), retryDelay);
    retryDelay = Math.min(4000, retryDelay * 2);
  }

  function connectionLost(resumeToken) {
    if (seat && ((slot >= 0 && !latest?.ended) || resumeToken)) {
      if (!reconnectUntil) {
        reconnectUntil = Date.now() + (seat.inMatch ? 20_000 : 120_000);
        retryDelay = 500;
      }
      retrySeat();
    } else {
      reset('Connection closed. Create or join a duel to try again.');
    }
  }

  function connect(code, resumeToken, origin = location.origin, ticket) {
    if (socket) return;
    stopProbes();
    setStatus(resumeToken ? 'Reconnecting to your duel…' : 'Connecting to the arena…');
    ui.entry.hidden = true;
    matchBar.hidden = false;
    ui.copy.textContent = 'Copy';
    if (!latest) ui.ping.textContent = '';
    rtt = NaN;
    pingSamples = [];
    ui.ping.dataset.region = regionName(origin);
    const connection = socket = new WebSocket(websocketUrl(origin, '/duel'));
    connectTimer = setTimeout(() => {
      if (resumeToken) retrySeat();
      else reset('Connection timed out. Try again in a moment.');
    }, resumeToken || ticket ? 8000 : 70_000);
    connection.addEventListener('open', () => {
      if (socket !== connection) return;
      const request = ticket ? { type: 'match_join', ticket } : resumeToken ? { type: 'resume', code, resumeToken } :
        code ? { type: 'join', code } : { type: 'create' };
      send({ ...request, compactSnapshots: true, latencyProbes: true });
      const ping = () => send({ type: 'ping', sent: performance.now() });
      ping();
      pingTimer = setInterval(ping, 2000);
    });
    connection.addEventListener('close', () => {
      if (socket !== connection) return;
      connectionLost(resumeToken);
    });
    connection.addEventListener('message', event => {
      if (socket !== connection) return;
      const message = JSON.parse(event.data);
      if (message.compact) message.fighters = message.fighters.map(unpackFighter);
      lastServerAt = performance.now();
      switch (message.type) {
        case 'latency_probe':
          send({ type: 'latency_ack', nonce: message.nonce });
          break;
        case 'joined': {
          clearTimeout(connectTimer);
          slot = message.slot;
          reconnectUntil = 0;
          if (message.resumeToken) rememberSeat({ code: message.code, token: message.resumeToken, inMatch: message.inMatch, origin });
          if (message.inMatch) break;
          if (message.matchmaking) { setStatus('Waiting for your match to start…'); break; }
          const link = new URL('/online', origin);
          link.searchParams.set('room', message.code);
          linkField.value = link.href;
          ui.invite.hidden = slot !== 0;
          const name = regionName(origin);
          setStatus(name ? 'Waiting for your opponent on ' + name + '…' : 'Waiting for your opponent…');
          break;
        }
        case 'start':
          start(message);
          break;
        case 'paused':
        case 'resumed':
          start(message, message.type === 'paused');
          break;
        case 'state':
          receive(message);
          break;
        case 'pong': {
          pingSamples.push(Math.round(lastServerAt - message.sent));
          if (pingSamples.length > 5) pingSamples.shift();
          const sorted = [...pingSamples].sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          rtt = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
          if (!latest) ui.ping.textContent = pingLabel();
          break;
        }
        case 'ready':
          setStatus('Waiting for your opponent to rematch.');
          break;
        case 'error':
          if (resumeToken && message.code === 'resume_unavailable') rememberSeat(null);
          if (message.code === 'host_away' && seat?.code === code) {
            reset('Select Resume hosting in this tab. Then open the invite on another device or in a second tab.');
            break;
          }
          reset(message.reason);
          break;
        case 'left':
          rememberSeat(null);
          reset(message.reason);
          break;
      }
    });
  }

  function pingLabel() {
    const name = ui.ping.dataset.region;
    return Number.isFinite(rtt) ? (name ? name + ' · ' : '') + Math.round(rtt) + ' ms' : name || '';
  }

  ui.create.onclick = () => connect(null, null, bestOrigin());
  ui.quick.onclick = async () => {
    if (!config || socket || queue) return;
    closeConnection();
    ui.entry.hidden = true;
    matchBar.hidden = false;
    ui.ping.textContent = '';
    setStatus('Checking servers…');
    const controller = probeController = new AbortController();
    const preferred = regionField.value;
    const candidates = preferred ? [regions.get(preferred)] : [...regions.values()];
    const pings = Object.fromEntries((await Promise.all(candidates.map(async region => {
      const ping = await measureRegion(region, controller.signal);
      if (!controller.signal.aborted) keepRegionPing(region.id, ping);
      return [region.id, ping];
    }))).filter(([, ping]) => Number.isFinite(ping)));
    if (controller.signal.aborted) return;
    probeController = null;
    if (!Object.keys(pings).length || preferred && !(preferred in pings)) {
      reset('No reachable server for this search. Try Auto or check again.');
      return;
    }
    setStatus('Connecting to Quick Match…');
    const connection = queue = new WebSocket(websocketUrl(regionOrigin(config.coordinator), '/duel-queue'));
    connectTimer = setTimeout(() => reset('The matchmaking service is taking too long to respond. Try again.'), 70_000);
    connection.onopen = () => {
      if (queue !== connection) return;
      connection.send(JSON.stringify({ type: 'search', pings, preferred }));
      queueTimer = setInterval(() => {
        if (connection.readyState === open) connection.send(JSON.stringify({ type: 'keepalive' }));
      }, 10_000);
    };
    connection.onmessage = event => {
      if (queue !== connection) return;
      const message = JSON.parse(event.data);
      if (message.type === 'searching') {
        clearTimeout(connectTimer);
        setStatus('Finding an opponent…');
      } else if (message.type === 'match' && regions.has(message.region)) {
        closeConnection();
        connect(null, null, regionOrigin(message.region), message.ticket);
      } else if (message.type === 'error') reset(message.reason);
    };
    connection.onclose = () => {
      if (queue === connection) reset('Matchmaking disconnected. Select Quick Match to retry.');
    };
  };
  ui.resume.onclick = () => {
    if (!seat) return;
    reconnectUntil = Date.now() + 15_000;
    retryDelay = 500;
    if (seat.origin && !knownOrigin(seat.origin)) { setStatus('Checking the server list. Try Resume again in a moment.'); return; }
    connect(seat.code, seat.token, seat.origin);
  };
  ui['join-form'].onsubmit = event => {
    event.preventDefault();
    const room = parseRoom(codeField.value.trim(), regions, location.origin);
    if (!room || !ROOM_CODE.test(room.code)) { setStatus('Enter a valid room code or invite link.'); return; }
    connect(room.code, null, room.origin || (ROOM_CODE.test(invitation) ? location.origin : preferredOrigin()));
  };
  ui.copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(linkField.value);
      ui.copy.textContent = 'Copied';
    } catch {
      linkField.select();
    }
  };
  ui.leave.onclick = () => {
    const searching = !!queue || !!probeController && ui.entry.hidden && !socket;
    if (slot >= 0 || reconnectUntil) rememberSeat(null);
    reconnectUntil = 0;
    send({ type: 'leave' });
    reset(searching ? 'Search cancelled.' : 'You left the duel.');
  };
  window.addEventListener('pagehide', () => {
    if (seat && !latest?.ended) send({ type: 'suspend' });
  });
  ui.rematch.onclick = () => {
    ui.rematch.disabled = true;
    send({ type: 'rematch' });
  };

  function start(message, isPaused = false) {
    const newRound = !latest || round !== message.round;
    if (seat && !seat.inMatch) rememberSeat({ ...seat, inMatch: true });
    paused = isPaused;
    round = message.round;
    epoch = message.epoch ?? 0;
    seq = 0;
    accumulator = 0;
    opponentClock = new OpponentClock();
    renderTick = message.tick;
    pending = [];
    unsent = [];
    snapshots = [];
    offset = [0, 0, 0];
    remoteOffset = [0, 0, 0];
    lastRemote = null;
    guessedRemote = false;
    banner = '';
    latest = null;
    predicted = null;
    panel.hidden = true;
    matchBar.hidden = false;
    if (newRound) arena.start(slot);
    arena.release();
    receive(message);
  }

  function receive(message) {
    if (message.round !== round || latest && message.tick <= latest.tick) return;
    const now = performance.now();
    opponentClock.sample(message.tick, now);
    const prior = predicted;
    const confirmed = message.fighters[slot];
    receivedAt = now;
    latest = message;
    pending = pending.filter(input => input.seq > message.ack);
    predicted = { ...confirmed };
    if (!paused && !message.countdown && !message.ended) {
      for (const input of pending) stepFighter(predicted, input, message.fighters[1 - slot]);
    }
    if (!prior || prior.life !== predicted.life || predicted.out || Math.hypot(
      prior.x - predicted.x, prior.y - predicted.y, prior.z - predicted.z) > 3) {
      offset = [0, 0, 0];
    } else {
      offset = positionKeys.map((key, index) => Math.max(-2, Math.min(2, offset[index] + prior[key] - predicted[key])));
    }
    snapshots.push(message);
    if (snapshots.length > 20) snapshots.shift();
    for (const event of message.events) arena.impact(event);
    if (message.ended) {
      panel.hidden = false;
      ui.entry.hidden = true;
      ui.invite.hidden = true;
      ui.rematch.hidden = false;
      ui.rematch.disabled = false;
      setStatus(message.winner === null ? 'Draw.' : message.winner === slot ? 'You won!' : 'Your opponent won.');
      arena.release();
    }
  }

  function opponentAt(now) {
    renderTick = opponentClock.advance(now);
    while (snapshots.length > 2 && snapshots[1].tick <= renderTick) snapshots.shift();
    const old = snapshots[0], next = snapshots[1];
    const previous = old.fighters[1 - slot];
    if (!next || renderTick <= old.tick) return previous;
    const following = next.fighters[1 - slot];
    if (renderTick > next.tick && !following.out && !next.countdown) {
      const dt = (renderTick - next.tick) * STEP;
      return { ...following, x: following.x + following.vx * dt, z: following.z + following.vz * dt,
        y: following.grounded ? following.y : following.y + following.vy * dt };
    }
    const alpha = Math.min(1, (renderTick - old.tick) / (next.tick - old.tick));
    if (previous.life !== following.life || Boolean(previous.out) !== Boolean(following.out)) {
      return alpha < 1 ? previous : following;
    }
    const mixed = { ...(alpha < 1 ? previous : following) };
    for (const key of [...positionKeys, 'vx', 'vy', 'vz']) mixed[key] = previous[key] + (following[key] - previous[key]) * alpha;
    if (previous.attack && previous.attack === following.attack && following.attackAge >= previous.attackAge) {
      mixed.attackAge = previous.attackAge + (following.attackAge - previous.attackAge) * alpha;
    }
    mixed.facing = lerpAngle(previous.facing, following.facing, alpha);
    return mixed;
  }

  arena.lobby();
  return function frame(elapsed, now) {
    const dt = Math.min(.05, elapsed);
    if (!latest) { arena.draw(dt); return; }
    const stale = now - receivedAt > 450;
    if (!latest.ended && socket?.readyState === open && now - lastServerAt > 5000) {
      connectionLost();
      if (!latest) { arena.draw(dt); return; }
    }
    const canPlay = !paused && !latest.countdown && !latest.ended && !stale && !document.hidden;
    if (canPlay) {
      accumulator += Math.min(.1, elapsed);
      while (accumulator >= STEP && pending.length < 36) {
        accumulator -= STEP;
        const input = { seq: ++seq, ...arena.input() };
        pending.push(input);
        const frame = [input.seq, input.x, input.z, input.buttons];
        if (input.buttons & (QUICK | HEAVY)) frame.push(Math.floor(Math.min(renderTick, latest.tick)));
        unsent.push(frame);
        arena.action(stepFighter(predicted, input, latest.fighters[1 - slot]));
        if (unsent.length === 2) {
          send({ type: 'input', round, epoch, frames: unsent });
          unsent = [];
        }
      }
      if (pending.length >= 36) accumulator = 0;
    } else {
      accumulator = 0;
      arena.release();
    }
    if (!latest.ended) ui.ping.textContent = paused ? (reconnectUntil ? 'Reconnecting…' : 'Waiting for opponent…')
      : stale ? 'Connection stalled' : pingLabel();
    const nextBanner = paused ? 'Connection paused' : latest.countdown ? String(Math.ceil(latest.countdown / TICK_RATE)) : 'FIGHT!';
    if (nextBanner !== banner) { banner = nextBanner; arena.announce(banner); }
    const local = { ...predicted };
    offset = offset.map((value, index) => {
      local[positionKeys[index]] += value;
      return value * Math.exp(-17 * dt);
    });
    const confirmedRemote = latest.fighters[1 - slot];
    const remote = { ...(latest.ended || paused ? confirmedRemote : opponentAt(now)),
      health: confirmedRemote.health, lives: confirmedRemote.lives };
    const guessing = !paused && !latest.ended && !latest.countdown && renderTick > latest.tick;
    if (!lastRemote || remote.life !== lastRemote.life || remote.out || paused) remoteOffset = [0, 0, 0];
    else if (guessedRemote && !guessing) {
      remoteOffset = positionKeys.map(key => Math.max(-1.5, Math.min(1.5, lastRemote[key] - remote[key])));
    }
    remoteOffset = remoteOffset.map((value, index) => {
      remote[positionKeys[index]] += value;
      return value * Math.exp(-18 * dt);
    });
    lastRemote = remote;
    guessedRemote = guessing;
    const poses = slot === 0 ? [local, remote] : [remote, local];
    arena.draw(dt, poses, latest.remaining / TICK_RATE);
  };
}

export function attackTime(pose, offlineMove) {
  if (!pose.attack) return 0;
  const online = ATTACK[pose.attack];
  const elapsed = pose.attackAge;
  // Map the server's integer tick phases to the original swing animation.
  const startup = Math.min(1, elapsed / online.startup) * offlineMove.startup;
  const active = Math.max(0, Math.min(1, (elapsed - online.startup) / online.active)) * offlineMove.active;
  const recovery = Math.max(0, Math.min(1, (elapsed - online.startup - online.active) / online.recovery)) * offlineMove.recovery;
  return Math.max(0, offlineMove.startup + offlineMove.active + offlineMove.recovery - startup - active - recovery);
}
