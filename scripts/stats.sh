#!/usr/bin/env bash
# Buzzword Bingo usage, day by day (UTC): games started (and of which kind), players, bingos called, new rounds, and
# games that waited for a minimum number of players. Anonymous — the Lambda keeps numbers only (lambda/store.mjs, pk
# STATS). Needs the AWS CLI signed in to the crystalmark.co.uk account.
#   scripts/stats.sh            the last 30 days
#   scripts/stats.sh 7          the last 7 days
#   scripts/stats.sh all        every day since counting began
#   scripts/stats.sh --json 7   the raw counts, for other tools
set -euo pipefail
REGION=${BINGO_REGION:-eu-west-2}
JSON=0; [ "${1:-}" = --json ] && { JSON=1; shift; }
DAYS=${1:-30}
if [ "$DAYS" = all ]; then FROM=0000-00-00
else FROM=$(python3 -c 'import datetime, sys; print(datetime.date.today() - datetime.timedelta(days=int(sys.argv[1]) - 1))' "$DAYS"); fi

REPORT=$(cat <<'PY'
import json, sys
days = []
for item in json.load(sys.stdin)["Items"]:
    d = {k: (v["S"] if "S" in v else int(v["N"])) for k, v in item.items()}
    d["day"] = d.pop("sk")[len("DAY#"):]
    d.pop("pk")
    days.append(d)
if sys.argv[1] == "1":
    print(json.dumps(days, indent=2))
    sys.exit()
if not days:
    print("No games counted in that period.")
    sys.exit()

cols = [("games", "Games"), ("players", "Players"), ("bingos", "Bingos"), ("rounds", "Rounds"), ("locked", "Locked")]
kind = lambda k: k[len("theme_"):]
print("Day".ljust(12) + "".join(h.rjust(9) for _, h in cols) + "   Kinds")
total = {}
for d in days:
    kinds = ", ".join(f"{kind(k)} {n}" for k, n in sorted(d.items()) if k.startswith("theme_"))
    print(d["day"].ljust(12) + "".join(str(d.get(c, 0)).rjust(9) for c, _ in cols) + "   " + kinds)
    for k, n in d.items():
        if k != "day":
            total[k] = total.get(k, 0) + n
print("-" * (12 + 9 * len(cols)))
print("Total".ljust(12) + "".join(str(total.get(c, 0)).rjust(9) for c, _ in cols))
games = total.get("games", 0)
if games:
    n = lambda count, word: f"{count} {word}{'' if count == 1 else 's'}"
    print(f"\n{n(games, 'game')} on {n(len(days), 'day')} with play: {total.get('players', 0) / games:.1f} players "
          f"and {total.get('bingos', 0) / games:.1f} bingos a game.")
    kinds = sorted(((kind(k), n) for k, n in total.items() if k.startswith("theme_")), key=lambda x: -x[1])
    print("By kind: " + ", ".join(f"{k} {n} ({100 * n / games:.0f}%)" for k, n in kinds))
PY
)

aws dynamodb query --region "$REGION" --table-name buzzword-bingo --output json \
  --key-condition-expression 'pk = :p AND sk >= :from' \
  --expression-attribute-values "{\":p\":{\"S\":\"STATS\"},\":from\":{\"S\":\"DAY#$FROM\"}}" |
  python3 -c "$REPORT" "$JSON"
