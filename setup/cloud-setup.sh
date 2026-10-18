#!/usr/bin/env bash
# Setup script for a claude.ai/code cloud environment: it runs before Claude Code starts and
# installs the skill plugins at user scope. Cloud sessions don't draw mods, so the UI mods stay out.
# It always exits 0, because a failing setup script fails the whole session.
set -u

if ! command -v claude >/dev/null 2>&1; then
  echo "cloud-setup: claude is not on PATH; no plugins installed"
  exit 0
fi

add_marketplace() {
  claude plugin marketplace add "$1" >/dev/null 2>&1 \
    || claude plugin marketplace update "$2" >/dev/null 2>&1 \
    || echo "cloud-setup: marketplace $2 unavailable"
}

add_marketplace l-a-motta/motta-claude-mods motta-claude-mods
add_marketplace anthropics/claude-plugins-official claude-plugins-official

for plugin in agent-lane@motta-claude-mods mattpocock-skills@claude-plugins-official; do
  if claude plugin install "$plugin" --scope user >/dev/null 2>&1; then
    echo "cloud-setup: $plugin installed"
  else
    echo "cloud-setup: $plugin failed"
  fi
done

exit 0
