#!/usr/bin/env bash
# Starts the Playwright MCP server (browser control for Claude). Pinned so a new release
# can't silently change behaviour. In the cloud sandbox there is a pre-installed Chromium
# that the MCP's bundled Playwright would not find on its own, so point at it explicitly;
# elsewhere Playwright uses its own browser (run `npx playwright install chromium` once).
args=(--headless --isolated --viewport-size 1280x800 --output-dir .checks/mcp)
if [ -x /opt/pw-browsers/chromium ]; then
  # The container runs as root, where Chromium refuses its own sandbox.
  args+=(--executable-path /opt/pw-browsers/chromium --no-sandbox)
fi
exec npx -y @playwright/mcp@0.0.82 "${args[@]}" "$@"
