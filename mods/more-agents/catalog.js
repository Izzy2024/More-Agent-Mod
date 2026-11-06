// More agents agent catalog. DATA ONLY: after `export default` there must be
// strict JSON (double quotes, no comments or trailing commas), which is what
// `node scripts/validate-catalog.mjs` checks.
// The mod runtime only imports .js files, which is why this isn't a .json.
// status: "verified" (command from the official docs, see source),
//         "unverified" (not offered for adding) or
//         "builtin" (Herdr already ships it in its + menu; informational only).
// checked: "YYYY-MM-DD" of the last review of `source`; required for verified.
// tier: "official" (the vendor's own org or doc site) or "community" (a
//       third-party or personal repository). Required for verified, forbidden
//       otherwise.
// nativeOsc: true when the agent reports its program status over OSC 7501 by
//            itself, so it needs no bridge from this repo and the dialog must
//            not suggest one. Never together with "bridge".
export default [
  {
    "id": "omp",
    "name": "Oh My Pi (omp)",
    "run": [
      "omp"
    ],
    "match": [
      "omp"
    ],
    "continue": [
      "omp",
      "--continue"
    ],
    "install": "curl -fsSL https://omp.sh/install | sh",
    "docs": "https://omp.sh/docs/quickstart",
    "icon": "icons/pi.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://omp.sh/docs/quickstart",
    "checked": "2026-11-01",
    "nativeOsc": true,
    "note": "Fork of Pi; reuses the Pi icon."
  },
  {
    "id": "command-code",
    "name": "Command Code",
    "run": [
      "command-code"
    ],
    "match": [
      "cmdc",
      "command-code"
    ],
    "continue": [
      "command-code",
      "--continue"
    ],
    "install": "npm i -g command-code@latest",
    "docs": "https://commandcode.ai/docs/quickstart",
    "icon": "icons/command-code.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://commandcode.ai/docs/reference/cli",
    "checked": "2026-11-01",
    "bridge": "bridges/command-code",
    "note": "Herdr already ships a name and icon, but no run. On Windows the short alias is `cmdc`: `cmd` is the system shell."
  },
  {
    "id": "dsh-tui",
    "name": "dsh-TUI",
    "run": [
      "dsh-tui"
    ],
    "match": [
      "dsh-tui"
    ],
    "install": "npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui",
    "docs": "https://github.com/ccch1mneyyy/dsh-TUI#readme",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "community",
    "source": "https://github.com/ccch1mneyyy/dsh-TUI/blob/main/README.md",
    "checked": "2026-11-06",
    "nativeOsc": true,
    "note": "Terminal UI for DeepSeek Harness; `dst` is a short alias for the same program. It reports OSC 7501 itself (DSH_TUI_PROGRAM_STATUS=0 turns it off), so it needs no status bridge. `dsh-tui --resume` reopens the last session, but no continue variant is offered here yet."
  },
  {
    "id": "kilo",
    "name": "Kilo Code CLI",
    "run": [
      "kilo"
    ],
    "match": [
      "kilo"
    ],
    "continue": [
      "kilo",
      "--continue"
    ],
    "install": "npm install -g @kilocode/cli",
    "docs": "https://kilo.ai/docs/cli",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://kilo.ai/docs/code-with-ai/platforms/cli",
    "checked": "2026-11-01",
    "note": "Fork of OpenCode."
  },
  {
    "id": "qwen-code",
    "name": "Qwen Code",
    "run": [
      "qwen"
    ],
    "match": [
      "qwen"
    ],
    "continue": [
      "qwen",
      "--continue"
    ],
    "install": "npm install -g @qwen-code/qwen-code@latest",
    "docs": "https://github.com/QwenLM/qwen-code",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/QwenLM/qwen-code/blob/main/docs/users/common-workflow.md",
    "checked": "2026-11-01"
  },
  {
    "id": "goose",
    "name": "Goose",
    "run": [
      "goose",
      "session"
    ],
    "match": [
      "goose"
    ],
    "install": "curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash",
    "docs": "https://goose-docs.ai/docs/guides/goose-cli-commands",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://goose-docs.ai/docs/guides/goose-cli-commands",
    "checked": "2026-11-01",
    "note": "Continue unverified: --resume resumes a session, but the docs do not say it defaults to the latest one."
  },
  {
    "id": "aider",
    "name": "Aider",
    "run": [
      "aider"
    ],
    "match": [
      "aider"
    ],
    "continue": [
      "aider",
      "--restore-chat-history"
    ],
    "install": "python -m pip install aider-install && aider-install",
    "docs": "https://aider.chat/docs/install.html",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://aider.chat/docs/config/options.html",
    "checked": "2026-11-01",
    "note": "Runs under Python; Herdr recognizes it by the script name."
  },
  {
    "id": "cline",
    "name": "Cline CLI",
    "run": [
      "cline"
    ],
    "match": [
      "cline"
    ],
    "install": "npm i -g cline",
    "docs": "https://docs.cline.bot/cline-cli/overview",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://docs.cline.bot/cli/cli-reference",
    "checked": "2026-11-01",
    "note": "Continue needs a session id (`--id`); there is no documented flag for the latest session."
  },
  {
    "id": "droid",
    "name": "Droid (Factory)",
    "run": [
      "droid"
    ],
    "match": [
      "droid"
    ],
    "continue": [
      "droid",
      "--resume"
    ],
    "install": "curl -fsSL https://app.factory.ai/cli | sh",
    "docs": "https://docs.factory.ai/reference/cli-reference",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://docs.factory.ai/reference/cli-reference",
    "checked": "2026-11-01",
    "note": "--resume without an id opens the most recently modified session."
  },
  {
    "id": "auggie",
    "name": "Auggie (Augment CLI)",
    "run": [
      "auggie"
    ],
    "match": [
      "auggie"
    ],
    "continue": [
      "auggie",
      "--continue"
    ],
    "install": "npm install -g @augmentcode/auggie@latest",
    "docs": "https://docs.augmentcode.com/cli/reference",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://docs.augmentcode.com/cli/reference",
    "checked": "2026-11-01"
  },
  {
    "id": "junie",
    "name": "Junie (JetBrains)",
    "run": [
      "junie"
    ],
    "match": [
      "junie"
    ],
    "continue": [
      "junie",
      "--resume"
    ],
    "install": "curl -fsSL https://junie.jetbrains.com/install.sh | bash",
    "docs": "https://junie.jetbrains.com/docs/junie-cli.html",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://junie.jetbrains.com/docs/parameters.html",
    "checked": "2026-11-01",
    "note": "--resume resumes the last session; --session-id picks a specific one."
  },
  {
    "id": "mistral-vibe",
    "name": "Mistral Vibe",
    "run": [
      "vibe"
    ],
    "match": [
      "vibe"
    ],
    "continue": [
      "vibe",
      "--continue"
    ],
    "install": "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
    "docs": "https://github.com/mistralai/mistral-vibe",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/mistralai/mistral-vibe#readme",
    "checked": "2026-11-01"
  },
  {
    "id": "continue-cli",
    "name": "Continue CLI (cn)",
    "run": [
      "cn"
    ],
    "match": [
      "cn"
    ],
    "continue": [
      "cn",
      "--resume"
    ],
    "install": "npm i -g @continuedev/cli",
    "docs": "https://github.com/continuedev/continue/tree/main/extensions/cli",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/continuedev/continue/blob/main/extensions/cli/README.md",
    "checked": "2026-11-01",
    "note": "Resumes the last session for this terminal."
  },
  {
    "id": "trae-agent",
    "name": "Trae Agent",
    "run": [
      "trae-cli",
      "interactive"
    ],
    "match": [
      "trae-cli"
    ],
    "docs": "https://github.com/bytedance/trae-agent#-installation",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/bytedance/trae-agent#readme",
    "checked": "2026-11-01",
    "note": "Installed with git clone + uv sync in a venv: trae-cli has to be on your PATH."
  },
  {
    "id": "codebuff",
    "name": "Codebuff",
    "run": [
      "codebuff"
    ],
    "match": [
      "codebuff"
    ],
    "install": "npm install -g codebuff",
    "docs": "https://www.codebuff.com/docs/help/quick-start",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://www.codebuff.com/docs/help/quick-start",
    "checked": "2026-11-06",
    "note": "Continue unverified: the docs do not give a flag for the latest session."
  },
  {
    "id": "forge",
    "name": "Forge",
    "run": [
      "forge"
    ],
    "match": [
      "forge"
    ],
    "install": "curl -fsSL https://forgecode.dev/cli | sh",
    "docs": "https://github.com/tailcallhq/forgecode/blob/main/README.md",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/tailcallhq/forgecode/blob/main/README.md",
    "checked": "2026-11-06",
    "note": "Continue needs a conversation id (`forge conversation resume <id>`); there is no documented flag for the latest session."
  },
  {
    "id": "kiro-cli",
    "name": "Kiro CLI",
    "run": [
      "kiro-cli"
    ],
    "match": [
      "kiro-cli"
    ],
    "continue": [
      "kiro-cli",
      "chat",
      "--resume"
    ],
    "install": "curl -fsSL https://cli.kiro.dev/install | bash",
    "docs": "https://kiro.dev/docs/cli/",
    "icon": "icons/kiro.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://kiro.dev/docs/reference/cli-commands/",
    "checked": "2026-11-06",
    "note": "`kiro-cli chat --resume` resumes the previous conversation in this directory. The curl installer is documented for macOS; on Linux or Windows follow the docs."
  },
  {
    "id": "nanocoder",
    "name": "Nanocoder",
    "run": [
      "nanocoder"
    ],
    "match": [
      "nanocoder"
    ],
    "continue": [
      "nanocoder",
      "--continue"
    ],
    "install": "npm install -g @nanocollective/nanocoder",
    "docs": "https://github.com/Nano-Collective/nanocoder/blob/main/docs/getting-started/installation.md",
    "icon": "icons/agent.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://github.com/Nano-Collective/nanocoder/blob/main/docs/getting-started/index.md",
    "checked": "2026-11-06",
    "note": "`--continue` resumes the most recent saved session in the current directory."
  },
  {
    "id": "pi",
    "name": "Pi",
    "run": [
      "pi"
    ],
    "match": [
      "pi"
    ],
    "continue": [
      "pi",
      "--continue"
    ],
    "install": "curl -fsSL https://pi.dev/install.sh | sh",
    "docs": "https://pi.dev/docs/latest/quickstart",
    "icon": "icons/pi.svg",
    "status": "verified",
    "tier": "official",
    "source": "https://pi.dev/docs/latest/cli",
    "checked": "2026-11-06",
    "note": "`--continue` resumes the most recent session in the current directory."
  },
  {
    "id": "gemini",
    "name": "Gemini CLI",
    "run": [
      "gemini"
    ],
    "docs": "https://github.com/google-gemini/gemini-cli",
    "icon": "icons/gemini.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
  },
  {
    "id": "cursor",
    "name": "Cursor CLI (cursor-agent)",
    "run": [
      "cursor-agent"
    ],
    "docs": "https://cursor.com/cli",
    "icon": "icons/cursor.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json",
    "bridge": "bridges/cursor"
  },
  {
    "id": "amp",
    "name": "Amp",
    "run": [
      "amp"
    ],
    "docs": "https://ampcode.com",
    "icon": "icons/amp.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
  },
  {
    "id": "crush",
    "name": "Crush",
    "run": [
      "crush"
    ],
    "docs": "https://github.com/charmbracelet/crush",
    "icon": "icons/crush.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
  },
  {
    "id": "copilot",
    "name": "Copilot CLI",
    "run": [
      "copilot"
    ],
    "docs": "https://github.com/github/copilot-cli",
    "icon": "icons/copilot.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
  },
  {
    "id": "kimi",
    "name": "Kimi Code CLI",
    "run": [
      "kimi"
    ],
    "docs": "https://github.com/MoonshotAI/kimi-code",
    "icon": "icons/kimi.svg",
    "status": "builtin",
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
  }
];
