---
description: Initialize ScottClip in this repo (config, personas, Linear labels)
---

Initialize ScottClip in this repository using the scottclip-init skill.

Follow the full initialization procedure from the skill:
1. Verify Linear MCP is available
2. Gather Linear context (team, user)
3. Ask which persona preset to scaffold
4. Create Linear labels (group + state + persona labels)
5. Scaffold `.scottclip/` with config and persona templates from `${CLAUDE_PLUGIN_ROOT}/templates/`
6. Offer schedule setup
7. Print summary of what was created

If `.scottclip/` already exists, ask whether to overwrite, merge, or cancel before proceeding.
