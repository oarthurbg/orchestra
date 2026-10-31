---
description: Show or change orchestra's settings (keep-warm cache, liveview on Tailscale) from any Claude Code window
argument-hint: "[<setting> <value> | tailscale on|off]"
---

Show or change orchestra's settings. This works in the desktop app and over Remote Control, where `/plugin configure` does not open.

1. Run `claude plugin configure orchestra@orchestra --json`. `schema` lists each setting with its title, type and default; `inputs` holds each saved value as text, `""` when unset, and then the default applies. If `claude` is not found, give the owner the command to run in a terminal themselves: `claude plugin configure orchestra@orchestra`, and stop.
2. With no `$ARGUMENTS`, show one table: setting, value (the saved one, else `<default> (default)`), and its title. Show booleans as on or off. Then say how to change one, `/orchestra:settings <setting> <value>`, for example `/orchestra:settings tailscale on`. Stop.
3. With arguments, read a setting name and a value from `$ARGUMENTS`.
   - `tailscale` means `liveviewTailnet`; other names match `schema` case-insensitively.
   - A boolean takes `on`, `true` or `yes` (saved as `true`) and `off`, `false` or `no` (saved as `false`). A number takes a positive number.
   - If the name is not in `schema` or the value does not fit, show the table from step 2, say what was wrong, and change nothing.
4. Save it: `echo '{"<setting>":"<value>"}' | claude plugin configure orchestra@orchestra --values-stdin`, with the setting's exact name from `schema` and the value from step 3 (a number, `true` or `false`, nothing else). Run step 1 again and confirm the new value.
5. Say when it takes effect: in sessions started after this, or after `/reload-plugins`. For `liveviewTailnet`, a liveview that is already running keeps its mode; to switch it now, run `/orchestra:liveview stop`, then `/orchestra:liveview`.
