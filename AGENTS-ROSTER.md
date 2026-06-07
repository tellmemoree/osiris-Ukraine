# OSIRIS Agent Roster

A living reference of every agent and skill available in this project.
**Rule:** when a new agent or skill is created, append it to the relevant section here in the same commit.

---

## Feature Pipeline

### From raw idea
> New idea that hasn't been shaped yet.

```
[raw idea]
    │
    ▼
osint-idea-groomer   ← scope the idea; surface data sources, risks, subtasks
    │
    ▼
architect            ← file-by-file plan: touches, sequencing, env vars, risk flags
    │
    ▼  (see "From backlog item" below for the rest)
```

### From backlog item
> Feature already exists in HANDOFF-feature-backlog.md and is being picked up for implementation.

```
[backlog item]
    │
    ▼
osint-idea-groomer + architect   ← jointly refine the feature (resolve ambiguity,
    │                               clarify data sources, confirm scope)
    │
    ▼
osint-idea-groomer               ← writes user stories
    │
    ▼
architect                        ← writes full implementation spec
    │                               (file touches, sequencing, env vars, edge cases)
    │
    ├─── new layer / API route ──────────────────► /dev-glue
    │                                               (wire data source → route → component)
    │
    ├─── full feature (multi-file, UI + data) ───► /dev-feature
    │                                               (end-to-end: code + PR)
    │
    └─── after code lands ───────────────────────► /dev-review
                                                    (review diff, apply fixes)
    │
    ▼
/ship                ← PR → merge flow
    │
    ▼
/security-audit      ← optional; run before merging sensitive changes
```

### Consulting agents (invoke any time, independent of pipeline stage)

```
devops          ← infra / deployment / scraping infrastructure / ops questions
cybersecurity   ← security review, threat modeling, operator opsec
```

These are not gated on pipeline stage — spawn them whenever the question touches their domain.

---

## Custom Project Agents
> Defined in `~/osiris/.claude/agents/`. Invoked via the `Agent` tool with `subagent_type`.

| Agent | Identity | Use when |
|-------|----------|----------|
| `osint-idea-groomer` | Senior business analyst / product strategist for OSINT platforms | You have a vague idea, capability request, or dashboard enhancement and need it scoped into actionable dev tasks — before any code is written |
| `architect` | Senior software architect with deep OSIRIS codebase knowledge | You have a groomed feature spec and need a precise file-by-file implementation plan (file touches, sequencing, env vars, risk flags) before implementation agents start coding |
| `devops` | Senior DevOps / infrastructure engineer | Deployment topology, outbound scraping infra (proxy rotation, rate shaping), secrets management, CI/CD pipelines, observability, VPS / networking — anything outside the application code |
| `cybersecurity` | Offensive/defensive security specialist with OSINT opsec expertise | Security review before merging changes touching auth/secrets/external ingestion; threat modeling new exposure; operator opsec for scraping (attribution, detectability, compartmentalization) |

---

## Custom Skills
> Defined in `~/.claude/skills/`. Invoked via `/skill-name` in the prompt.

| Skill | Identity | Use when |
|-------|----------|----------|
| `/dev-feature` | End-to-end feature implementer | You have a backlog item or spec and want working code + a PR delivered in one shot — no hand-holding |
| `/dev-glue` | Data source / API integration specialist | Wiring a new upstream feed, API route, or component hook end-to-end (route → types → fetch → UI binding) |
| `/dev-review` | Diff reviewer + fixer | Reviewing the current diff or a named file/PR for bugs, style violations, and edge cases — produces actual edits, not just comments |
| `/feature` | Feature workflow orchestrator | Starting work on a new feature — sets up branch, context, and workflow |
| `/ship` | Ship workflow orchestrator | Finalizing and shipping a feature — PR, review, merge flow |
| `/security-audit` | Security auditor | Running a full security audit of pending changes |

---

## Built-in System Agents
> Provided by the Claude Code harness. Invoked via the `Agent` tool.

| Agent | Identity | Use when |
|-------|----------|----------|
| `claude` | Catch-all general agent | Any task that doesn't fit a more specific agent |
| `Explore` | Fast read-only codebase searcher | Finding files by pattern, grepping for symbols, answering "where is X defined" — do NOT use for code review or open-ended analysis |
| `general-purpose` | Multi-step researcher and executor | Complex research or tasks spanning multiple files/systems where you're not confident a single grep will find the right match |
| `Plan` | Software architect | Designing implementation strategies, identifying critical files, weighing architectural trade-offs — before writing code |
| `claude-code-guide` | Claude Code / API expert | Questions about Claude Code CLI features, hooks, MCP servers, the Anthropic SDK, or API usage |
| `statusline-setup` | Status line configurator | Configuring the Claude Code status line setting |
