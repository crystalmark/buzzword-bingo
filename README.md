# Buzzword Bingo

Bingo for meetings, lectures, the surgery and movie night, at **https://crystalmark.co.uk/bingo/**. Start a game,
send the four-letter code or the link (`crystalmark.co.uk/bingo/KPTZ`), and everyone gets a different card. There are
six kinds: business jargon (the default), physics, chemistry, medical (what patients say at the surgery, or lecture
jargon) and film clichés. The server timestamps each player's first line, so the room sees who really called it first
— and the words on their line, for heckling. The host can deal everyone a fresh card for another round. There's a solo
mode too, with no server involved.

**From your own slides:** giving a talk, you can pick a PowerPoint, Word, PDF, OpenOffice or text file and the buzzwords
are picked out of it — slide titles, text and speaker notes — for you to trim and add to before starting the game.
The file is read in the browser and never uploaded; only the words kept are sent. The squares can stay locked until a
set number of people have joined, with a Start now button for the host if fewer turn up. Games hold up to 100 players.

No accounts: joining a game gives you a token, kept in localStorage so a reload puts you back in. Games vanish after a
day (DynamoDB TTL).

## Running it locally

```bash
npm start      # http://localhost:8768/bingo/ — page and API together, games kept in memory
npm test       # node --test: the rules and the API
```

No dependencies: the AWS SDK comes with the Lambda runtime and is only loaded there.

## How it's put together

| Piece | Where | What |
|---|---|---|
| `public/` | S3 `crystalmark.co.uk/bingo/` | The page: plain HTML, CSS and ES modules, no build |
| `lambda/game.mjs` | both | The rules: dealing, lines. Copied to `/bingo/js/` on deploy |
| `lambda/themes.mjs` | both | The kinds of bingo and their words. Copied to `/bingo/js/` on deploy |
| `lambda/index.mjs` | Lambda `buzzword-bingo-api` | The API (routes listed at the top of the file) |
| `lambda/moderation.mjs` | both | Refuses rude player names (disguises included, real surnames allowed), swearing and slurs in custom words, and rude-looking codes. Copied to `/bingo/js/` on deploy |
| `public/js/extract.mjs` | page | Reads a document's text in the browser: .pptx/.docx/.odp/.odt via `zip.mjs`, PDF via pdf.js (`public/js/vendor/pdfjs`, Apache 2.0, loaded only for PDFs) |
| `public/js/keywords.mjs` | page | Picks the buzzwords out of that text |
| `lambda/store.mjs` | | DynamoDB table `buzzword-bingo` (pk = game code, sk = `GAME` or `P#<player>`), or in memory |
| `template.yaml` | stack `buzzword-bingo`, eu-west-2 | Table, function, HTTP API (throttled) |
| `deploy/bingo-index.js` | CloudFront Function | `/bingo/`, `/bingo/<CODE>`, `/bingo/solo` → `index.html` |

CloudFront (the crystalmark.co.uk distribution, shared with RT Trainer, Flight Log and Pollyglot) sends `/bingo/api/*`
to the HTTP API uncached, adding an `X-Origin-Secret` header the Lambda checks, and everything else under `/bingo*` to
S3. The secret lives in SSM at `/buzzword-bingo/origin-secret` (eu-west-2).

## Deploying

```bash
deploy/api.sh          # the API stack (tests first; makes the origin secret the first time)
deploy/cloudfront.sh   # once: function, security headers, origin and behaviours on the distribution
deploy/deploy.sh       # the page (tests first)
```

`deploy/cloudfront.sh --remove` takes the behaviours and origin off the distribution again.

To change the words or add a kind of bingo, edit `lambda/themes.mjs` (`npm test` checks the lists) and run both
`deploy/api.sh` and `deploy/deploy.sh`. Don't rename a kind's id: games store it.

## Usage

The Lambda counts each day's games (and of which kind), players, bingos called and new rounds, as numbers only —
nothing about who played or which game — in the same table, under `pk = STATS`. Those counts never expire.

```bash
scripts/stats.sh          # the last 30 days, with totals and averages
scripts/stats.sh 7        # the last week
scripts/stats.sh all      # everything
scripts/stats.sh --json   # the raw counts
```

## Licence

MIT (see `LICENSE`).
