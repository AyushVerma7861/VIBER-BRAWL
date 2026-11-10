# Dungeon Duel alpha

Private 1v1 in VIBER BRAWL’s Dungeon. Create a duel and send the invite link. The friend opens it and selects Join. Each match lasts up to three minutes with three stocks per fighter. At time, compare remaining stocks, then current health. Both players can select Rematch after a result.

## Run

Install Node 22 or newer, then run these commands from the repository root.

```sh
npm ci
npm test
npm start
```

Open http://127.0.0.1:8788/online in two browser windows. For two devices on the same trusted LAN, set `HOST=0.0.0.0` before starting and use the server computer’s LAN address in both browsers. On mobile, rotate to landscape.

## What changed in the duel

| Rule | Duel |
| --- | --- |
| Gravity, floor geometry, fall line | Original Dungeon geometry, −44 gravity, −38 fall line, same air drag and normal dash impulse of 24. |
| Fighter stats | Volt and Phantom are visual identities. Both use speed 13, jump 17.6, 100 HP, weight 1 and the same damage. Both can double jump. Walking off an edge leaves one air jump after the coyote window. |
| Combat clock | Fixed 60 Hz on the server. Original quick and heavy startup/active/recovery timings are rounded to ticks (5/6/10 and 13/8/22). The server tests both hits from the same positions, then applies damage and knockback. Same-tick trades are possible. A hit interrupts an unfinished swing. |
| Impact | Screen shake, sound and a flash on confirmation. The global slowdown from the bot brawl is removed for the duel. The struck fighter still has hitstun and knockback, which grows as health falls. |
| Inputs | Jump, dash and attacks buffer briefly, up to 100 ms, so a press just before a move unlocks can still fire. A swing turns toward a close opponent already in front, using a smaller assist range and cone than the bot brawl. |
| Arena rules | No passive body push, specials, hazards or powerups in this alpha. Direct attack knockback still applies. Respawns choose the more distant of two starts and grant up to 1.2 seconds of protection, ending early if the fighter swings. |
| Latency | Local movement, dash, jump and swing use prediction with replay after each server update. Remote fighters are interpolated from 20 Hz snapshots with a jitter buffer. A melee swing first checks current positions. On a near miss, it can check the opponent’s older position using server-measured latency and the client’s rendered tick. The lookback is capped at 150 ms. The opponent must still be inside the swing arc and no more than one unit beyond normal reach. |

A disconnect closes the invite room. This version keeps the room and scores in memory and caps the host at eight rooms. It has no ranking or public queue.

## Host for ₹0

Use the included Render Blueprint from `preview/dungeon-duel`. Alternatively, create one **Free** Node web service in **Singapore** from that branch with build command `npm ci && npm test`, start command `npm start`, and health path `/health`. Share its `/online` URL. The same process serves the game and the WebSocket, so there is no separate frontend, database or domain to buy. Use the existing GitHub/Cloudflare process for the main game.

Render includes 750 free instance hours per workspace each month. The service sleeps after 15 minutes without incoming HTTP or WebSocket traffic, and can take about a minute to wake. For a hard ₹0 budget, use the Free plan without adding a payment method. If the included outbound bandwidth is exhausted, Render suspends free services until the allowance resets. A restart drops current matches.

- [Render Free limits](https://render.com/docs/free)
- [Singapore region](https://render.com/docs/regions)
- [Render WebSockets](https://render.com/docs/websocket)

For the first remote playtest, compare quick and heavy swings against early and late dashes. A late dash can still take a hit near the edge of reach. An early dash that creates more than one extra unit of distance should escape. Check both players’ screens on separate connections before tuning the window.
