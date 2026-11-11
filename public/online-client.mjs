import { ATTACK, DASH, HEAVY, JUMP, QUICK, ROOM_CODE, STEP, TICK_RATE, lerpAngle, stepFighter } from './online-sim.mjs';
import { OpponentClock, unpackFighter } from './online-net.mjs';

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
      <p data-ui="status" role="status">A private 1v1. Three stocks each.</p>
      <div data-ui="entry">
        <button data-ui="create" type="button">Create duel</button>
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
  if (ROOM_CODE.test(invitation)) {
    codeField.value = invitation;
    ui.status.textContent = 'Invite ready. Select Join to enter.';
  }

  let socket, pingTimer, connectTimer, reconnectTimer;
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
    reconnectTimer = setTimeout(() => connect(seat.code, seat.token), retryDelay);
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

  function connect(code, resumeToken) {
    if (socket) return;
    setStatus(resumeToken ? 'Reconnecting to your duel…' : 'Connecting to the arena…');
    ui.entry.hidden = true;
    matchBar.hidden = false;
    ui.copy.textContent = 'Copy';
    if (!latest) ui.ping.textContent = '';
    rtt = NaN;
    pingSamples = [];
    const url = new URL('/duel', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = socket = new WebSocket(url);
    connectTimer = setTimeout(() => {
      if (resumeToken) retrySeat();
      else reset('Connection timed out. Try again in a moment.');
    }, resumeToken ? 8000 : 70_000);
    connection.addEventListener('open', () => {
      if (socket !== connection) return;
      const request = resumeToken ? { type: 'resume', code, resumeToken } : code ? { type: 'join', code } : { type: 'create' };
      send({ ...request, compactSnapshots: true });
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
        case 'joined': {
          clearTimeout(connectTimer);
          slot = message.slot;
          reconnectUntil = 0;
          if (message.resumeToken) rememberSeat({ code: message.code, token: message.resumeToken, inMatch: message.inMatch });
          if (message.inMatch) break;
          const link = new URL(location.href);
          link.pathname = '/online';
          link.search = '';
          link.hash = '';
          link.searchParams.set('room', message.code);
          linkField.value = link.href;
          ui.invite.hidden = slot !== 0;
          setStatus('Waiting for your opponent…');
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
          if (!latest) ui.ping.textContent = Math.round(rtt) + ' ms';
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

  ui.create.onclick = () => connect(null);
  ui.resume.onclick = () => {
    if (!seat) return;
    reconnectUntil = Date.now() + 15_000;
    retryDelay = 500;
    connect(seat.code, seat.token);
  };
  ui['join-form'].onsubmit = event => {
    event.preventDefault();
    let code = codeField.value.trim();
    try { code = new URL(code).searchParams.get('room') || ''; } catch {}
    if (!ROOM_CODE.test(code)) { setStatus('Enter a valid room code or invite link.'); return; }
    connect(code);
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
    if (slot >= 0 || reconnectUntil) rememberSeat(null);
    reconnectUntil = 0;
    send({ type: 'leave' });
    reset('You left the duel.');
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
      : stale ? 'Connection stalled' : Number.isFinite(rtt) ? Math.round(rtt) + ' ms' : '';
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
