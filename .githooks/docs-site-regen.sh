#!/usr/bin/env bash
#
# Regenerate the CLI + MCP reference pages in the docs repo when this push
# changes what they describe.
#
# The docs site (shipeasy-ai/docs) does not own those pages — this repo does,
# because it owns the Commander tree and the MCP tool catalog. So they are
# PUSHED: the generators write straight into a local checkout of that repo, and
# you commit and push them there. See docs/GENERATION.md in the docs repo.
#
# Sourced by .githooks/pre-push. Never blocks a push: a missing docs checkout
# is normal, and the docs repo's nightly workflow is the backstop.
set -uo pipefail

docs_site_regen() {
  local root ref_lines changed
  root="$(git rev-parse --show-toplevel)"
  ref_lines="$1"

  # Which paths does this push actually move?
  changed=""
  while read -r _lref local_sha _rref remote_sha; do
    [ -n "${local_sha:-}" ] || continue
    [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue
    local range
    if [ "${remote_sha:-}" = "0000000000000000000000000000000000000000" ] || [ -z "${remote_sha:-}" ]; then
      # New branch: everything it adds that the remote doesn't have yet.
      range="$(git rev-list --max-count=1 "$local_sha" --not --remotes 2>/dev/null | tail -1)"
      range="$(git rev-parse "${range:-$local_sha}^" 2>/dev/null || echo "$local_sha")..$local_sha"
    else
      range="$remote_sha..$local_sha"
    fi
    changed="$changed$(git diff --name-only "$range" 2>/dev/null)"$'\n'
  done <<< "$ref_lines"

  local cli_touched mcp_touched
  cli_touched="$(printf '%s' "$changed" | grep -E '^(cli/src|cli/scripts|openapi/)' || true)"
  mcp_touched="$(printf '%s' "$changed" | grep -E '^(mcp/src|mcp/scripts|openapi/)' || true)"

  if [ -z "$cli_touched" ] && [ -z "$mcp_touched" ]; then
    return 0
  fi

  # Find the docs repo the same way the generators do, so the message we print
  # matches what they would have done.
  local docs=""
  for c in "${SHIPEASY_DOCS_REPO:-}" "$root/../docs" "$root/../shipeasy-docs" \
           "$HOME/projects/shipeasy-docs" "$HOME/projects/docs"; do
    [ -n "$c" ] || continue
    if [ -d "$c/generated" ] && [ -d "$c/content/docs" ]; then docs="$c"; break; fi
  done

  if [ -z "$docs" ]; then
    echo "pre-push: this push changes the CLI/MCP surface, but no shipeasy-ai/docs"
    echo "pre-push: checkout was found — the published reference will go stale until"
    echo "pre-push: the docs repo's nightly regen runs."
    echo "pre-push:   git clone git@github.com:shipeasy-ai/docs.git ~/projects/shipeasy-docs"
    echo "pre-push:   (or set SHIPEASY_DOCS_REPO)"
    return 0
  fi

  echo "pre-push: CLI/MCP surface changed — regenerating the reference in $docs"
  [ -n "$cli_touched" ] && pnpm --filter @shipeasy/cli docs >/dev/null 2>&1 \
    && echo "pre-push:   ✓ cli-reference.mdx + cli-commands.json" \
    || { [ -n "$cli_touched" ] && echo "pre-push:   ! CLI doc regen failed — run 'pnpm --filter @shipeasy/cli docs'"; }
  [ -n "$mcp_touched" ] && pnpm --filter @shipeasy/mcp docs >/dev/null 2>&1 \
    && echo "pre-push:   ✓ mcp-reference.mdx" \
    || { [ -n "$mcp_touched" ] && echo "pre-push:   ! MCP doc regen failed — run 'pnpm --filter @shipeasy/mcp docs'"; }

  if ! git -C "$docs" diff --quiet -- generated/ 2>/dev/null; then
    echo "pre-push:"
    echo "pre-push: the docs repo now has uncommitted reference changes. Commit them:"
    echo "pre-push:   cd $docs && git add generated/ && git commit -m 'docs: regen CLI/MCP reference' && git push"
  else
    echo "pre-push:   (no change to the published reference)"
  fi
  return 0
}
