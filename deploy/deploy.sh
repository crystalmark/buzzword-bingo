#!/usr/bin/env bash
# Deploy the Buzzword Bingo page to https://crystalmark.co.uk/bingo/. It's static: it goes to the site's S3 bucket under
# bingo/ and CloudFront serves it through the /bingo* behaviour (deploy/cloudfront.sh sets that up once). The API is
# deployed separately, by deploy/api.sh.
#   deploy/deploy.sh            run the tests, sync the page to s3://crystalmark.co.uk/bingo/, invalidate /bingo*
#   deploy/deploy.sh --dryrun   list what would change and stop
set -euo pipefail
cd "$(dirname "$0")/.."
# Overridden only by BINGO_ names: a BUCKET or DIST left in the shell by another project would have been deployed to
BUCKET=${BINGO_BUCKET:-crystalmark.co.uk}
PREFIX=bingo   # the sync below deletes, so it must never run at the bucket root: the main site lives there
DIST=${BINGO_DIST:-EZS3KVTVPEGYG}
SITE=https://crystalmark.co.uk/$PREFIX/
DRY=; [ "${1:-}" = --dryrun ] && DRY=--dryrun

npm test > /dev/null 2>&1 || { echo "Tests failed: run npm test"; exit 1; }
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
cp -R public/. "$STAGE/"
cp lambda/game.mjs "$STAGE/js/game.mjs"   # the rules are shared with the Lambda
find "$STAGE" -name .DS_Store -delete

# no-cache: browsers and CloudFront revalidate on every load (cheap 304s), so a deploy shows up straight away.
# .mjs goes up separately so it's served as JavaScript, which browsers insist on for modules.
aws s3 sync "$STAGE/" "s3://$BUCKET/${PREFIX:?}/" --delete --no-progress --cache-control no-cache --exclude '*.mjs' $DRY
aws s3 cp "$STAGE/js/" "s3://$BUCKET/$PREFIX/js/" --recursive --exclude '*' --include '*.mjs' --no-progress \
  --cache-control no-cache --content-type text/javascript $DRY
[ -z "$DRY" ] || exit 0
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/$PREFIX" "/$PREFIX/*" --query 'Invalidation.Id' --output text > /dev/null
if curl -fsS --max-time 10 -o /dev/null "$SITE"; then echo "Deployed → $SITE"
else echo "Uploaded, but $SITE does not answer: has deploy/cloudfront.sh run?"; exit 1; fi
