---
description: "[removed] Deletions are UI-only — delete the feature gate in the dashboard"
---

This command was removed: deletions happen in the Shipeasy dashboard, not the CLI/plugin. If you expected it, update first: `npm i -g @shipeasy/cli@latest`, then `/plugin marketplace update shipeasy` → `/plugin install shipeasy@shipeasy` — but the delete verb is intentionally gone; remove the feature gate in the UI instead.
