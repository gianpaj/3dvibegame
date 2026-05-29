#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AGENT_BROWSER_BIN="${AGENT_BROWSER_BIN:-$(command -v agent-browser || true)}"
CHROME_BIN="${CHROME_BIN:-}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"
CDP_PORT="${CDP_PORT:-9222}"
HTTP_PORT="${HTTP_PORT:-8008}"
WAIT_TIMEOUT_SECS="${WAIT_TIMEOUT_SECS:-300}"
PROMPT_TEXT="${PROMPT_TEXT:-An inquiry to my bank about how to enable wire transfers on my account.}"
PROMPT_CONTEXT="${PROMPT_CONTEXT:-I am a longstanding customer.}"

if [[ -z "${AGENT_BROWSER_BIN}" ]]; then
  echo "agent-browser was not found in PATH. Set AGENT_BROWSER_BIN to override." >&2
  exit 1
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "python3 was not found in PATH. Set PYTHON_BIN to override." >&2
  exit 1
fi

find_chrome() {
  local candidates=(
    "${CHROME_BIN}"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "$(command -v google-chrome 2>/dev/null || true)"
    "$(command -v chrome 2>/dev/null || true)"
    "$(command -v chromium 2>/dev/null || true)"
    "$(command -v chromium-browser 2>/dev/null || true)"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

CHROME_BIN="$(find_chrome || true)"
if [[ -z "${CHROME_BIN}" ]]; then
  echo "Chrome or Chromium was not found. Set CHROME_BIN to override." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/writer-api-test.XXXXXX")"
PROFILE_DIR="${TMP_DIR}/chrome-profile"
SITE_DIR="${TMP_DIR}/site"
LOG_DIR="${TMP_DIR}/logs"
mkdir -p "${PROFILE_DIR}" "${SITE_DIR}" "${LOG_DIR}"

HTTP_PID=""
CHROME_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "${HTTP_PID}" ]] && kill -0 "${HTTP_PID}" 2>/dev/null; then
    kill "${HTTP_PID}" 2>/dev/null || true
    wait "${HTTP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${CHROME_PID}" ]] && kill -0 "${CHROME_PID}" 2>/dev/null; then
    kill "${CHROME_PID}" 2>/dev/null || true
    wait "${CHROME_PID}" 2>/dev/null || true
  fi
  if [[ ${exit_code} -eq 0 ]]; then
    rm -rf "${TMP_DIR}"
  else
    echo "Preserved debug files in ${TMP_DIR}" >&2
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

cat > "${SITE_DIR}/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Writer API Test</title>
    <style>
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        margin: 2rem;
        line-height: 1.5;
      }
      button {
        padding: 0.75rem 1rem;
        font: inherit;
      }
      pre {
        white-space: pre-wrap;
        border: 1px solid #ccc;
        padding: 1rem;
        min-height: 6rem;
      }
      .label {
        font-weight: 700;
        margin-top: 1rem;
      }
    </style>
  </head>
  <body>
    <h1>Writer API Test</h1>
    <button id="run">Run Writer API Test</button>
    <div class="label">Status</div>
    <pre id="status">idle</pre>
    <div class="label">Result</div>
    <pre id="result"></pre>
    <script>
      window.__writerTest = {
        done: false,
        ok: false,
        availability: null,
        error: null,
        result: null,
      };

      const statusNode = document.getElementById("status");
      const resultNode = document.getElementById("result");
      const runButton = document.getElementById("run");

      const setStatus = (value) => {
        statusNode.textContent = value;
      };

      const setResult = (value) => {
        resultNode.textContent =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
      };

      runButton.addEventListener("click", async () => {
        window.__writerTest = {
          done: false,
          ok: false,
          availability: null,
          error: null,
          result: null,
        };

        try {
          setStatus("checking-support");

          if (!("Writer" in self)) {
            throw new Error("Writer API is not exposed on window/self.");
          }

          const availability = await Writer.availability();
          window.__writerTest.availability = availability;
          setStatus(`availability:${availability}`);

          const writer = await Writer.create({
            monitor(monitor) {
              monitor.addEventListener("downloadprogress", (event) => {
                const pct = Math.round(event.loaded * 100);
                setStatus(`downloading:${pct}%`);
              });
            },
          });

          setStatus("writing");
          const prompt = new URLSearchParams(location.search).get("prompt");
          const context = new URLSearchParams(location.search).get("context");
          const result = await writer.write(prompt, { context });

          window.__writerTest.done = true;
          window.__writerTest.ok = true;
          window.__writerTest.result = result;
          setStatus("success");
          setResult(result);
        } catch (error) {
          window.__writerTest.done = true;
          window.__writerTest.ok = false;
          window.__writerTest.error = {
            name: error?.name ?? "Error",
            message: error?.message ?? String(error),
            stack: error?.stack ?? null,
          };
          setStatus("error");
          setResult(window.__writerTest.error);
        }
      });
    </script>
  </body>
</html>
HTML

echo "Serving local Writer API test page from ${SITE_DIR}"
"${PYTHON_BIN}" -m http.server "${HTTP_PORT}" --bind 127.0.0.1 --directory "${SITE_DIR}" \
  > "${LOG_DIR}/http.log" 2>&1 &
HTTP_PID=$!

echo "Launching Chrome with a clean profile and Writer API feature flags"
"${CHROME_BIN}" \
  --user-data-dir="${PROFILE_DIR}" \
  --remote-debugging-port="${CDP_PORT}" \
  --no-first-run \
  --no-default-browser-check \
  --enable-features=OptimizationGuideOnDeviceModel \
  --enable-blink-features=AIWriterAPI,AIPromptAPIMultimodalInput \
  > "${LOG_DIR}/chrome.log" 2>&1 &
CHROME_PID=$!

wait_for_cdp() {
  local deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if curl -fsS "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

url_encode() {
  "${PYTHON_BIN}" -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

if ! wait_for_cdp; then
  echo "Chrome did not expose a CDP endpoint on port ${CDP_PORT}." >&2
  echo "Chrome log: ${LOG_DIR}/chrome.log" >&2
  exit 1
fi

TEST_URL="http://127.0.0.1:${HTTP_PORT}/index.html?prompt=$(url_encode "${PROMPT_TEXT}")&context=$(url_encode "${PROMPT_CONTEXT}")"

echo "Opening ${TEST_URL}"
"${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" open "${TEST_URL}" >/dev/null
"${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" wait --load networkidle >/dev/null

echo "Triggering Writer.create() from a real button click"
"${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" click "#run" >/dev/null

echo "Waiting up to ${WAIT_TIMEOUT_SECS}s for the Writer API run to finish"
deadline=$((SECONDS + WAIT_TIMEOUT_SECS))
while (( SECONDS < deadline )); do
  state="$("${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" eval "JSON.stringify(window.__writerTest)" 2>/dev/null || true)"
  if [[ "${state}" == *\"done\":true* ]]; then
    break
  fi
  sleep 2
done

if (( SECONDS >= deadline )); then
  echo "Timed out waiting for Writer API completion after ${WAIT_TIMEOUT_SECS}s." >&2
  exit 1
fi

STATUS="$("${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" get text "#status")"
RESULT="$("${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" get text "#result")"
JSON_STATE="$("${AGENT_BROWSER_BIN}" --cdp "${CDP_PORT}" eval "JSON.stringify(window.__writerTest)")"

echo
echo "Writer API test status:"
printf '%s\n' "${STATUS}"
echo
echo "Writer API test result:"
printf '%s\n' "${RESULT}"
echo
echo "Raw state:"
printf '%s\n' "${JSON_STATE}"

if [[ "${STATUS}" != *"success"* ]]; then
  echo
  echo "The Writer API test did not succeed." >&2
  echo "Inspect these logs if needed:" >&2
  echo "  ${LOG_DIR}/chrome.log" >&2
  echo "  ${LOG_DIR}/http.log" >&2
  exit 1
fi
