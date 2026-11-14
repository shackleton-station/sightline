#!/usr/bin/env bash
# Phase 8: the deploys roll the same image to the second region, after us-east4 (docs/ARCHITECTURE_PHASE_8.md).
#
#   bash web/scripts/second-region.sh follow   after "Send it everyone" in us-east4: the same image, to the copy
#   bash web/scripts/second-region.sh back     in the deploy's way back: the copy's version from before
#
# Read from the environment: PROJECT, SERVICE, SECOND_REGION, and for `follow` IMAGE and COMMIT. `follow`
# writes LIVE2 (the copy's version before) and NEW2 to $GITHUB_ENV, which `back` reads.
#
# Why one step, and not a tenth and a watch as in us-east4: by the time this runs the image has passed its
# tests through the load balancer, a tenth of the visitors and then all of them in us-east4. What differs in
# the second region is only the network path to Redis and Firestore. `gcloud run deploy` waits until the new
# version has started and passed Cloud Run's startup check, and a version that does not start never gets a
# request. If anything here fails, the deploy's way back puts both regions on their versions from before.
#
# When the second region is off (no copy of the service there), `follow` says so and does nothing.
set -euo pipefail

: "${PROJECT:?}" "${SERVICE:?}" "${SECOND_REGION:?}"
where=(--project "$PROJECT" --region "$SECOND_REGION")

case "${1:-}" in
  follow)
    : "${IMAGE:?}" "${COMMIT:?}"
    if ! gcloud run services describe "$SERVICE" "${where[@]}" --format json > second-region-before.json 2> second-region.err; then
      echo "No copy of $SERVICE in $SECOND_REGION: the second region is off (infra/second-region.tf). Nothing to roll."
      exit 0
    fi
    LIVE2="$(jq -r '[.status.traffic[] | select((.percent // 0) > 0)] | max_by(.percent) | .revisionName' second-region-before.json)"
    echo "LIVE2=$LIVE2" >> "${GITHUB_ENV:-/dev/null}"
    echo "The copy in $SECOND_REGION runs $LIVE2. Rolling $IMAGE to it."
    gcloud run deploy "$SERVICE" "${where[@]}" --image "$IMAGE" --update-labels "commit=$COMMIT" --quiet
    NEW2="$(gcloud run services describe "$SERVICE" "${where[@]}" --format 'value(status.latestCreatedRevisionName)')"
    NEW2_COMMIT="$(gcloud run revisions describe "$NEW2" "${where[@]}" --format 'value(metadata.labels.commit)')"
    if [ "$NEW2" = "$LIVE2" ] || [ "$NEW2_COMMIT" != "$COMMIT" ]; then
      echo "::error::The newest version of $SERVICE in $SECOND_REGION is $NEW2 (commit label: ${NEW2_COMMIT:-none}), not one made from $COMMIT by this run."
      exit 1
    fi
    # A version from a way back pins the split to one revision, and then a new one gets nothing. Everyone to it.
    gcloud run services update-traffic "$SERVICE" "${where[@]}" --to-latest --quiet
    echo "NEW2=$NEW2" >> "${GITHUB_ENV:-/dev/null}"
    echo "$SERVICE in $SECOND_REGION: everyone on $NEW2 (commit $COMMIT), as in us-east4."
    ;;
  back)
    if [ -z "${LIVE2:-}" ]; then
      echo "Nothing to put back in $SECOND_REGION (no copy there, or this run never reached it)."
      exit 0
    fi
    gcloud run services update-traffic "$SERVICE" "${where[@]}" --to-revisions "$LIVE2=100" --quiet
    echo "::error::$SERVICE in $SECOND_REGION is back on $LIVE2."
    ;;
  *)
    echo "Usage: bash web/scripts/second-region.sh follow|back" >&2
    exit 2
    ;;
esac
