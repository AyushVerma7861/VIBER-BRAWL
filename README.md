# VIBER BRAWL

CHOG TRIALS — a playable 3D boss fight inside VIBER BRAWL, a browser arena brawler.
Built solo for Chogathon 2026.

Live: https://viber-brawl.viberbrawl.workers.dev/

## Deploy rule — read this before touching production

**`main` is the only way to deploy.** Every push to `main` runs
`.github/workflows/deploy.yml`, which deploys that exact commit to Cloudflare.

**Do not run `wrangler deploy` from a local machine.** Doing that puts code on the live
site that is not in this repository, and the site silently drifts away from `main`. That
has already happened once: three media files (`td.mp4`, `guide.mp4`, `guide-poster.jpg`)
existed only on the deployed Worker and not in the repo, so a deploy from `main` would
have served a broken demo card and a missing guide.

The correct loop:

```bash
git add -A
git commit -m "what changed"
git push            # CI deploys it, and the live site matches the repo again
```

If you ever need to deploy by hand, push first. `deploy.sh` refuses to run unless the
working tree is clean and `HEAD` is level with `origin/main`.

## Drift check

`.github/workflows/drift-check.yml` fetches the live `index.html` every six hours and
compares its SHA-256 with `public/index.html`. If they differ, the run fails — which means
someone deployed outside git and the repo needs syncing.

## Layout

```
public/            the deployed site (wrangler assets directory)
  index.html       VIBER BRAWL shell: menu, roster, holder gate, demo card
  chog-trials.html the boss fight
  client-gate.js   Privy auth + holder check client
  guide.mp4        2:18 narrated walkthrough (plays in the demo modal)
  td.mp4           6s silent teaser loop for the menu card
  guide-poster.jpg poster frame for the guide player
worker.mjs         Cloudflare Worker: static assets + /api/gate/* (Privy JWT verified server-side)
wrangler.toml      Worker config
```

## The gate

`CHOG TRIALS` and the Chog fighter are holders-only. Holding a qualifying Chog Genesis
(ERC-721) unlocks them. The rest of VIBER BRAWL is free and needs no wallet.

Sign-in runs on Privy. Connecting is read-only: the Worker verifies the Privy session and
asks the chain what you hold. No transaction, no gas, nothing to approve.
