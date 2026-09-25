#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${ENGINE_URL:?}" "${OIDC_TOKEN_URL:?}" "${RUNNER_CLIENT_ID:?}" "${RUNNER_CLIENT_SECRET:?}"
: "${TEMPLATE_REPOSITORY:?}" "${PLATFORM:?}" "${ARTIFACT_BUCKET:?}" "${ARTIFACT_PUBLIC_PREFIX:?}"
[[ "$ENGINE_URL" == https://* && "$TEMPLATE_REPOSITORY" == https://* && "$OIDC_TOKEN_URL" == https://* ]] || exit 64
[[ "$PLATFORM" == android || "$PLATFORM" == ios ]] || exit 64
if [[ "$PLATFORM" == ios && "$(uname -s)" != Darwin ]]; then
  echo 'iOS compilation requires a macOS runner with Xcode' >&2
  exit 64
fi
get_token() {
  curl --fail --silent --show-error --proto '=https' --max-time 30 "$OIDC_TOKEN_URL" \
    --data-urlencode grant_type=client_credentials --data-urlencode "client_id=$RUNNER_CLIENT_ID" \
    --data-urlencode "client_secret=$RUNNER_CLIENT_SECRET" --data-urlencode "audience=${OIDC_AUDIENCE:?}" | jq -er '.access_token'
}
api() {
  local route="$1" body="$2" token
  token="$(get_token)"
  curl --fail --silent --show-error --proto '=https' --max-time 60 "$ENGINE_URL/api/$route" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data-binary "$body"
}
build_one() (
  set -euo pipefail
  local job="$1" workspace build_id revision tenant artifact
  build_id="$(jq -er '.id' <<<"$job")"
  tenant="$(jq -er '.tenantId' <<<"$job")"
  revision="$(jq -er '.sourceRevision' <<<"$job")"
  [[ "$build_id" =~ ^[a-f0-9-]{36}$ && "$tenant" =~ ^[a-f0-9-]{36}$ && "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 65
  workspace="$(mktemp -d "${TMPDIR:-/tmp}/superapp-build.XXXXXXXX")"
  cleanup() { rm -rf -- "$workspace"; }
  failure() { api "builds/$build_id/status" '{"status":"FAILED"}' >/dev/null || true; }
  trap cleanup EXIT
  trap failure ERR
  git clone --no-checkout --filter=blob:none -- "$TEMPLATE_REPOSITORY" "$workspace/source"
  git -C "$workspace/source" checkout --detach "$revision"
  [[ "$(git -C "$workspace/source" rev-parse HEAD)" == "$revision" ]]
  export BUILD_ID="$build_id" BUILD_NUMBER="$(date +%s)"
  export APP_NAME="$(jq -er '.appName' <<<"$job")" BUNDLE_ID="$(jq -er '.bundleId' <<<"$job")"
  export APP_VERSION="$(jq -er '.version' <<<"$job")" APP_ID="$(jq -er '.appId' <<<"$job")"
  export OUTPUT_DIR="$workspace/output" DART_DEFINES_FILE="$workspace/defines.json"
  jq -n --arg API_URL "$ENGINE_URL" --arg APP_ID "$APP_ID" --arg APP_NAME "$APP_NAME" --arg BUNDLE_ID "$BUNDLE_ID" \
    --arg OIDC_ISSUER "${MOBILE_OIDC_ISSUER:?}" --arg OIDC_CLIENT_ID "${MOBILE_OIDC_CLIENT_ID:?}" \
    --arg OIDC_AUDIENCE "$OIDC_AUDIENCE" --arg OIDC_REDIRECT_URI "$BUNDLE_ID:/oauthredirect" \
    --arg PAYMENT_RETURN_URL "${PAYMENT_RETURN_URL:?}" --arg MQTT_HOST "${MQTT_HOST:-}" '$ARGS.named' >"$DART_DEFINES_FILE"
  printf '%s' "$job" >"$workspace/job.json"
  export JOB_FILE="$workspace/job.json"
  cd "$workspace/source/mobile"
  flutter create --platforms=android,ios --project-name superapp_mobile --org "${BUNDLE_ID%.*}" .
  python3 ../infra/configure_mobile.py
  flutter pub get
  flutter analyze --fatal-infos
  flutter test
  mkdir -p fastlane
  cp ../infra/fastlane/Fastfile fastlane/Fastfile
  cp ../infra/fastlane/Gemfile Gemfile
  bundle config set --local path "$workspace/gems"
  bundle install
  bundle exec fastlane "$PLATFORM" release
  artifact="app.aab"; [[ "$PLATFORM" == android ]] || artifact="app.ipa"
  aws s3 cp "$OUTPUT_DIR/$artifact" "s3://$ARTIFACT_BUCKET/$tenant/$build_id/$artifact" --only-show-errors --sse AES256
  api "builds/$build_id/status" "$(jq -n --arg url "${ARTIFACT_PUBLIC_PREFIX%/}/$tenant/$build_id/$artifact" '{status:"SUCCEEDED",artifactUrl:$url}')" >/dev/null
)
while true; do
  job="$(api builds/claim "$(jq -n --arg p "$PLATFORM" '{platform:$p}')")"
  if [[ -n "$job" && "$job" != null ]]; then
    set +e
    build_one "$job"
    result=$?
    set -e
    if (( result != 0 )); then echo 'Build failed; status reported to engine' >&2; fi
  elif [[ "${RUN_ONCE:-false}" == true ]]; then
    break
  else
    sleep 10
  fi
  [[ "${RUN_ONCE:-false}" != true ]] || break
done
