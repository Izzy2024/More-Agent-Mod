// More agents agent catalog. DATA ONLY: after `export default` there must be
// strict JSON (double quotes, no comments or trailing commas), which is what
// `node scripts/validate-catalog.mjs` checks.
// The mod runtime only imports .js files, which is why this isn't a .json.
// status: "verified" (command from the official docs, see source),
//         "unverified" (not offered for adding) or
//         "builtin" (Herdr already ships it in its + menu; informational only).
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
    "source": "https://omp.sh/docs/quickstart",
    "note": "Fork of Pi; reuses the Pi icon."
  },
  {
    "id": "command-code",
    "name": "Command Code",
    "run": [
      "command-code"
    ],
    "match": [
      "cmd",
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
    "source": "https://commandcode.ai/docs/reference/cli",
    "note": "Herdr already ships a name and icon, but no run."
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
    "source": "https://github.com/Kilo-Org/kilocode#readme",
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
    "source": "https://github.com/QwenLM/qwen-code/blob/main/docs/users/common-workflow.md"
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
    "source": "https://goose-docs.ai/docs/guides/goose-cli-commands",
    "note": "Continue unverified: --resume without a name is not documented as 'the latest'."
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
    "source": "https://aider.chat/docs/config/options.html",
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
    "source": "https://github.com/cline/cline#readme",
    "note": "Continue flag unverified."
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
    "source": "https://docs.factory.ai/reference/cli-reference",
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
    "source": "https://docs.augmentcode.com/cli/reference"
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
    "install": "curl -fsSL https://junie.jetbrains.com/install.sh | bash",
    "docs": "https://junie.jetbrains.com/docs/junie-cli.html",
    "icon": "icons/agent.svg",
    "status": "verified",
    "source": "https://github.com/JetBrains/junie#readme",
    "note": "Continue flag unverified."
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
    "source": "https://github.com/mistralai/mistral-vibe#readme"
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
    "install": "npm i -g @continuedev/cli",
    "docs": "https://github.com/continuedev/continue/tree/main/extensions/cli",
    "icon": "icons/agent.svg",
    "status": "verified",
    "source": "https://github.com/continuedev/continue/blob/main/extensions/cli/README.md",
    "note": "Continue flag unverified."
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
    "source": "https://github.com/bytedance/trae-agent#readme",
    "note": "Installed with git clone + uv sync in a venv: trae-cli has to be on your PATH."
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
    "source": "https://github.com/herdrdev/herdr-app/blob/main/defaults/programs.json"
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
