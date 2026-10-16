# Buzzword Bingo

Bingo for meetings, at **https://crystalmark.co.uk/bingo/**. Start a game, send colleagues the four-letter code or the
link (`crystalmark.co.uk/bingo/KPTZ`), and everyone gets a different card of cheesy corporate jargon. The server
timestamps each player's first line, so the room sees who really called it first — and the words on their line, for
heckling. The host can deal everyone a fresh card for another round. There's a solo mode too, with no server involved.

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
| `lambda/game.mjs` | both | The rules: word list, dealing, lines. Copied to `/bingo/js/game.mjs` on deploy |
| `lambda/index.mjs` | Lambda `buzzword-bingo-api` | The API (routes listed at the top of the file) |
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

To change the words, edit `WORDS` in `lambda/game.mjs` and run both `deploy/api.sh` and `deploy/deploy.sh`.

## Licence

MIT (see `LICENSE`).
