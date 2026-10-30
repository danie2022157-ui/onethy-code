<div align="center">

# ⚡ OmniCode

### *The Autonomous Multi-Agent AI Coding Platform with Omni Fusion & Self-Healing*

[![GitHub Stars](https://img.shields.io/github/stars/danie2022157-ui/omnicode?style=for-the-badge&logo=github&color=FFD700)](https://github.com/danie2022157-ui/omnicode/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.4+-fbf0df?style=for-the-badge&logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen?style=for-the-badge)](https://github.com/danie2022157-ui/omnicode)

<br />

<p align="center">
  <img src="assets/omnicode-tui.png" alt="OmniCode Terminal UI" width="95%" style="border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);" />
</p>

<p align="center">
  <b>OmniCode</b> turns your terminal into a collaborative AI engineering studio. Powered by <b>Omni Fusion</b> (dynamic multi-model routing), <b>Autonomous Memory Bank</b>, <b>Self-Healing Test Loops</b>, and a built-in fleet of <b>430+ specialized agents</b>.
</p>

[Quickstart](#-quickstart) • [Superpowers](#-superpowers) • [Omni Fusion](#-omni-fusion-model-routing) • [Comparison](#-feature-matrix) • [Commands](#-interactive-slash-commands) • [Roadmap](#-roadmap-to-100k-stars)

---

</div>

## 🌟 Why OmniCode?

Most AI coding assistants lock you into a single model, lose context between prompts, or hallucinate silently when builds break. **OmniCode solves this by acting as an orchestrated engineering squad right in your terminal**:

* **Never get blocked by rate limits**: Omni Fusion dynamically routes requests across Gemini 3.8, Claude 3.7/Opus, and GPT models based on complexity and remaining quota.
* **Zero context loss**: The Autonomous Memory Bank persists architecture decisions and patterns across restarts without requiring manual `/remember` instructions.
* **Code that actually builds**: The Self-Healing Loop runs your test suite, diagnoses failures, and iterates autonomously until tests pass.
* **Fearless experimentation**: Time-Travel Checkpoints take snapshots before major AI modifications, letting you `/undo` instantly.

---

## ⚡ Superpowers

### 1. 🔀 Omni Fusion Router
Intelligent complexity-based routing. Send trivial tasks to ultra-fast efficiency models, balanced tasks to production workhorses, and hard architectural reasoning to deep-thinking frontiers:
* **🌱 Efficiency Tier**: `Gemini 3.8 Flash`, `Haiku 3.5`, `Llama 8B` (instant response, lowest credits)
* **⚖️ Balanced Tier**: `Claude 3.5 Sonnet`, `Gemini Pro`, `GPT-4o` (optimal coding precision)
* **🧠 Intelligence Tier**: `Claude 3.7 Sonnet Thinking`, `Claude Opus 4`, `o3-mini`, `DeepSeek R1` (deep math & architecture)
* **🎯 Model Filtering**: Whitelist specific models or let Omni Fusion leverage all connected accounts (`/fusion-models`).

### 2. 🧠 Autonomous Memory Bank
No more repeating context on every prompt. OmniCode auto-discovers and synchronizes `.omnicode/memory-bank/`:
* `project-brief.md`: Core requirements, mission, goals.
* `system-patterns.md`: Coding standards, architectural decisions, component contracts.
* `tech-context.md`: Stack, dependencies, runtime environments.
* `active-context.md`: Current sprint state, next immediate tasks, active focus.

### 3. 🔄 Self-Healing Test & Build Loop
Run `/heal` and watch OmniCode run your build/test runner, isolate compiler or runtime errors, modify source files, and re-verify until 100% green.

### 4. ⏪ Time-Travel Git Checkpoints
Every multi-file rewrite creates an atomic git snapshot. If an agent goes off-track, execute `/undo` to instantly restore your working directory to the exact state before the command.

### 5. 👥 Full Engineering Squad Pipeline
Run `/team` to orchestrate an end-to-end task across specialized autonomous roles:
1. `@planner`: Analyzes requirements and drafts an execution roadmap.
2. `@architect`: Validates boundaries, interfaces, and schemas.
3. `@coder`: Writes the implementation code and unit tests.
4. `@reviewer`: Audits against clean-code, performance, and security gates.

---

## 📊 Feature Matrix

| Feature | Vanilla OpenCode | Claude Code | Cursor | ⚡ OmniCode |
| :--- | :---: | :---: | :---: | :---: |
| **Multi-Model Auto Routing (Omni Fusion)** | ❌ | ❌ | ❌ | **✅ Yes (44+ Models)** |
| **Model Whitelisting & Filtering** | ❌ | ❌ | ❌ | **✅ Yes (`/fusion-models`)** |
| **Autonomous Memory Bank** | ❌ | ❌ | ❌ | **✅ Yes (Zero manual prompts)** |
| **Self-Healing Test & Fix Loop** | ❌ | ❌ | ❌ | **✅ Yes (`/heal`)** |
| **Time-Travel Checkpoints & Instant Undo** | ❌ | ❌ | ❌ | **✅ Yes (`/checkpoint`, `/undo`)** |
| **4-Phase Autonomous Squad Pipeline** | ❌ | ❌ | ❌ | **✅ Yes (`/team`)** |
| **Preloaded Agents & Skills** | 2 Agents | 1 Agent | N/A | **✅ 430+ Agents, 1,000+ Skills** |
| **Terminal UI with Live Model Diagnostics** | Basic | Basic | ❌ | **✅ Rich 3D ASCII + Live Sidebar** |
| **1-Click Windows / Linux Installer** | ❌ | ❌ | ❌ | **✅ Yes (`install.ps1`, `install.sh`)** |

---

## 🚀 Quickstart

### Installation

#### 🪟 Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/danie2022157-ui/omnicode/main/install.ps1 | iex
```
*Or clone and run locally:*
```powershell
git clone https://github.com/danie2022157-ui/omnicode.git
cd omnicode
.\install.ps1
```

#### 🐧 Linux & 🍎 macOS (Bash):
```bash
curl -fsSL https://raw.githubusercontent.com/danie2022157-ui/omnicode/main/install.sh | bash
```

Once installed, open any terminal in any project folder and launch:
```bash
omni
```

---

## ⌨️ Interactive Slash Commands

| Command | Alias | What it does |
| :--- | :--- | :--- |
| `/auto` | `/fusion` | Toggle Omni Fusion tiers (`Modo Auto`, `Eficiência`, `Balanceado`, `Inteligente`) |
| `/fusion-models` | `/modelos-fusion` | Interactive checklist to choose which models Omni Fusion is allowed to use |
| `/memory` | `/memory-bank` | Inspect the active 4-layer persistent project memory |
| `/checkpoint` | `/salvar-ponto` | Create an instant Git snapshot before experimental code changes |
| `/undo` | `/desfazer` | Revert working directory to previous AI checkpoint |
| `/heal` | `/autofix` | Launch autonomous self-healing test and compiler fix loop |
| `/team` | `/squad` | Launch the 4-phase Planner → Architect → Coder → Reviewer pipeline |
| `/commit` | `/autocommit` | Generate conventional commit messages from git diff |
| `/personalizacoes` | `/customizations` | Open catalog of 430+ Agents, 1,000+ Skills, Mods, Hooks, and MCPs |
| `/update` | `/atualizar` | Synchronize and fetch latest OmniCode releases from GitHub |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    User([Developer in Terminal]) -->|Prompt| OmniRouter[⚡ Omni Fusion Router]
    
    subgraph Context Engine
        MB[(🧠 Autonomous Memory Bank)]
        GitSnap[(💾 Git Checkpoints)]
        MCP[🔌 29+ MCP Servers]
    end
    
    OmniRouter -->|Load Context| MB
    OmniRouter -->|Inject Tools| MCP
    
    subgraph Dynamic Model Execution
        Complexity{Prompt Complexity}
        Complexity -->|Low| EffTier[🌱 Efficiency: Gemini Flash / Haiku]
        Complexity -->|Medium| BalTier[⚖️ Balanced: Claude Sonnet / GPT-4o]
        Complexity -->|High| IntTier[🧠 Intelligence: Claude Opus / Thinking]
    end
    
    OmniRouter --> Complexity
    
    subgraph Squad Pipeline
        P[Planner] --> A[Architect] --> C[Coder] --> R[Reviewer]
    end
    
    OmniRouter -.->|Run /team| Squad Pipeline
    EffTier & BalTier & IntTier --> CodeExec[Code Execution Engine]
    
    CodeExec --> HealCheck{Build / Test Pass?}
    HealCheck -->|No| HealLoop[🔄 Self-Healing Loop]
    HealLoop --> CodeExec
    HealCheck -->|Yes| Success([Verified Working Code])
```

---

## 🗺️ Roadmap to 100k Stars

- [x] **v2.2.0**: Native Omni Fusion complexity router & tier selector.
- [x] **v2.2.1**: Persistent Memory Bank automatic loader & time-travel undo.
- [x] **v2.2.2**: Model filtering checklist dialog (`/fusion-models`) & live sidebar diagnostics.
- [x] **v2.2.2**: 1-Click automated Google Antigravity OAuth with dual-stack loopback.
- [ ] **v2.3.0**: Local model integration with zero-setup Ollama / vLLM auto-discovery.
- [ ] **v2.4.0**: Distributed peer-to-peer agent pairing across local networks.
- [ ] **v2.5.0**: VS Code and JetBrains extension bridges.

---

## 🤝 Contributing

We welcome issues, feature suggestions, and PRs!
1. Fork the project (`https://github.com/danie2022157-ui/omnicode`)
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to your branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request!

---

<div align="center">

### ⭐ Star us on GitHub — It helps OmniCode reach more developers!

Made with ⚡ by [Daniel](https://github.com/danie2022157-ui) and the open source community.

</div>
