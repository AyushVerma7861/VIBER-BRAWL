import { ATTACK, DASH, HEAVY, JUMP, QUICK, ROOM_CODE, STEP, TICK_RATE, lerpAngle, stepFighter } from './online-sim.mjs';

const positionKeys = ['x', 'y', 'z'];
const invitation = new URL(location.href).searchParams.get('room') || '';
const open = WebSocket.OPEN;

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
        <form data-ui="join-form">
          <label for="duel-code">Room code or invite link</label>
          <div class="duel-row"><input id="duel-code" maxlength="220" autocomplete="off" autocapitalize="none" spellcheck="false" required><button type="submit">Join</button></div>
        </form>
      </div>
      <div data-ui="invite" hidden>
        <label for="duel-link">Send this invite to a friend</label>
        <div class="duel-row"><input id="duel-link" readonly><button data-ui="copy" type="button">Copy</button></div>
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

  let socket, pingTimer, connectTimer;
  let slot = -1;
  let round = 0;
  let latest, predicted, receivedAt;
  let seq = 0, accumulator = 0, renderTick = 0, spread = 0;
  let pending = [], unsent = [], snapshots = [];
  let offset = [0, 0, 0];
  let banner = '';
  let rtt = NaN;

  const send = message => {
    if (socket?.readyState === open) socket.send(JSON.stringify(message));
  };
  const setStatus = message => { ui.status.textContent = message; };
  function reset(message) {
    clearInterval(pingTimer);
    clearTimeout(connectTimer);
    const previous = socket;
    socket = null;
    previous?.close();
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

  function connect(code) {
    if (socket) return;
    setStatus('Connecting to the arena…');
    ui.entry.hidden = true;
    matchBar.hidden = false;
    ui.copy.textContent = 'Copy';
    ui.ping.textContent = '';
    rtt = NaN;
    const url = new URL('/duel', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = socket = new WebSocket(url);
    connectTimer = setTimeout(() => reset('Connection timed out. Try again in a moment.'), 70_000);
    connection.addEventListener('open', () => {
      if (socket !== connection) return;
      send(code ? { type: 'join', code } : { type: 'create' });
      const ping = () => send({ type: 'ping', sent: performance.now() });
      ping();
      pingTimer = setInterval(ping, 2000);
    });
    connection.addEventListener('close', () => {
      if (socket === connection) reset('Connection closed. Create or join a duel to try again.');
    });
    connection.addEventListener('message', event => {
      if (socket !== connection) return;
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'joined': {
          clearTimeout(connectTimer);
          slot = message.slot;
          const link = new URL(location.href);
          link.search = '';
          link.searchParams.set('room', message.code);
          linkField.value = link.href;
          ui.invite.hidden = slot !== 0;
          setStatus('Waiting for your opponent…');
          break;
        }
        case 'start':
          start(message);
          break;
        case 'state':
          receive(message);
          break;
        case 'pong':
          rtt = performance.now() - message.sent;
          ui.ping.textContent = Math.round(rtt) + ' ms';
          break;
        case 'ready':
          setStatus('Waiting for your opponent to rematch.');
          break;
        case 'error':
        case 'left':
          reset(message.reason);
          break;
      }
    });
  }

  ui.create.onclick = () => connect(null);
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
  ui.leave.onclick = () => reset('You left the duel.');
  ui.rematch.onclick = () => {
    ui.rematch.disabled = true;
    send({ type: 'rematch' });
  };

  function start(message) {
    round = message.round;
    seq = 0;
    accumulator = 0;
    spread = 0;
    renderTick = message.tick;
    pending = [];
    unsent = [];
    snapshots = [];
    offset = [0, 0, 0];
    banner = '';
    latest = null;
    predicted = null;
    panel.hidden = true;
    matchBar.hidden = false;
    arena.start(slot);
    receive(message);
  }

  function receive(message) {
    if (message.round !== round || latest && message.tick <= latest.tick) return;
    const now = performance.now();
    if (latest) {
      const error = Math.abs(now - receivedAt - (message.tick - latest.tick) * STEP * 1000);
      spread += (Math.min(100, error) - spread) * .12;
    }
    const prior = predicted;
    const confirmed = message.fighters[slot];
    receivedAt = now;
    latest = message;
    pending = pending.filter(input => input.seq > message.ack);
    predicted = { ...confirmed };
    if (!message.countdown && !message.ended) {
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
    const buffer = (100 + Math.min(80, spread * 2)) / (STEP * 1000);
    const target = Math.min(latest.tick, latest.tick + (now - receivedAt) / (STEP * 1000) - buffer);
    renderTick = Math.max(renderTick, target);
    while (snapshots.length > 2 && snapshots[1].tick <= renderTick) snapshots.shift();
    const old = snapshots[0], next = snapshots[1];
    const previous = old.fighters[1 - slot];
    if (!next || renderTick <= old.tick) return previous;
    const following = next.fighters[1 - slot];
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
    const canPlay = !latest.countdown && !latest.ended && !stale && !document.hidden;
    if (canPlay) {
      accumulator += Math.min(.1, elapsed);
      while (accumulator >= STEP && pending.length < 36) {
        accumulator -= STEP;
        const input = { seq: ++seq, ...arena.input() };
        pending.push(input);
        unsent.push([input.seq, input.x, input.z, input.buttons]);
        arena.action(stepFighter(predicted, input, latest.fighters[1 - slot]));
        if (unsent.length === 2) {
          send({ type: 'input', round, frames: unsent });
          unsent = [];
        }
      }
      if (pending.length >= 36) accumulator = 0;
    } else {
      accumulator = 0;
      arena.release();
    }
    if (!latest.ended && !latest.countdown) ui.ping.textContent = stale ? 'Connection stalled' : Number.isFinite(rtt) ? Math.round(rtt) + ' ms' : '';
    const nextBanner = latest.countdown ? String(Math.ceil(latest.countdown / TICK_RATE)) : 'FIGHT!';
    if (nextBanner !== banner) { banner = nextBanner; arena.announce(banner); }
    const local = { ...predicted };
    offset = offset.map((value, index) => {
      local[positionKeys[index]] += value;
      return value * Math.exp(-17 * dt);
    });
    const confirmedRemote = latest.fighters[1 - slot];
    const remote = latest.ended ? confirmedRemote : { ...opponentAt(now), health: confirmedRemote.health, lives: confirmedRemote.lives };
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
