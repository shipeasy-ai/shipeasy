---
description: Onboard the current project to Shipeasy end-to-end (install SDK, login, keys, MCP, skills, first translation keys)
---

You are setting up Shipeasy in this repository. Follow the `shipeasy-setup`
skill exactly. Do not skip verification gates. Do not invent commands — only
use the ones in the skill.

If the user has provided arguments after the slash command, treat them as
extra context (e.g. preferred secret store, target framework override).
Otherwise detect everything from the project state.

Begin with step 0 (preconditions) and report progress to the user as you go.
