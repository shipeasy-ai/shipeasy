---
description: Enable the feedback module and verify the devtools overlay loads
---

Run the per-plugin setup for `bugs@shipeasy`. Prereq: `base@shipeasy` is
already installed and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install base@shipeasy` + `/shipeasy-setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable feedback
   shipeasy modules list      # expect: feedback ✓
   ```

3. Verify the devtools overlay (the same overlay end users use to submit
   reports). The base install's `getBootstrapHtml()` already lazily
   injects `se-devtools.js` whenever the URL contains `?se` /
   `?se_devtools` — confirm by loading any page with `?se=1` appended.

   If the panel never appears in the browser, base setup is incomplete —
   send the user back to `/shipeasy-setup` to render
   `getBootstrapHtml()` into `<head>`.

4. Smoke-test the CLI mirror:

   ```bash
   shipeasy feedback bugs list           # should return [] or rows, never 403
   shipeasy feedback features list       # same
   ```

5. Print the per-plugin hand-off:
   ```
   ✅ bugs@shipeasy setup complete
   Module:  feedback ✓
   Wired:   devtools overlay (?se=1 on any page rendering getBootstrapHtml)
   Next:    Use the `shipeasy-bugs` skill, `/shipeasy-bug bug "<title>"`, or
            ask end users to submit via the in-page Report panel.
   ```
