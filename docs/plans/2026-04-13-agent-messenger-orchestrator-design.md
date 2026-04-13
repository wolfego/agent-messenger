# Agent-Messenger Universal Orchestrator

**Date:** 2026-04-13
**Status:** Draft
**Author:** Campbell Wolford
**Co-maintainer:** wolfego (Dad)

## Problem

Campbell's development workflow spans multiple AI coding tools -- Claude Code (brainstorming, planning, TDD, implementation), Cursor (file-index-powered architecture review, cross-file reasoning), and Codex (adversarial review, investigation). Today these tools operate in silos. The handoffs between brainstorm, spec, review, and implementation stages are manual. There is no persistent state across sessions, no way to run parallel brainstorms from different models, and no composable pipeline that routes tasks to the right tool for the job.

[agent-messenger](https://github.com/wolfego/agent-messenger) already provides MCP-based bidirectional communication between Cursor and Claude Code with Dolt-backed persistence. The opportunity is to extend it from a two-tool messenger into an agent-agnostic orchestration platform.

## Goals

1. **Agent-agnostic orchestration.** Any MCP-capable tool or CLI-based agent is a first-class worker.
2. **Composable workflow templates.** YAML files define pipelines of stages (parallel brainstorm, sequential implementation, gated reviews). New workflows are just new YAML files.
3. **Capability-based routing.** Agents declare what they can do. Templates specify what capabilities a stage needs, not which specific agent to use.
4. **Persistent workflow state.** Dolt version-controls every stage output, gate decision, and revision loop. Workflows survive session restarts.
5. **Clean layer separation.** agent-messenger is a generic platform. Trialight-specific integration lives in a superpowers plugin layer.
6. **Plugin distribution.** agent-messenger ships as a Claude Code plugin, Cursor extension, and npm package.
7. **Co-developable.** Architecture supports independent contribution by Campbell (adapters, templates) and wolfego (core engine, adapter interface).

## Non-Goals

- No automatic triggering from GitHub issues, schedules, or webhooks
- No custom UI beyond terminal-based interaction
- No Cursor Cloud support in v1
- No Cursor extension packaging or Claude Code marketplace packaging in v1
- No Slack notifications in the upstream core
- No Trialight-specific templates in the upstream repo
- No per-stage model override for interactive adapters in v1
- No billing, metering, or cross-agent cost tracking

## Architecture

### Three Layers

```
+-------------------------------------------------+
|          agent-messenger (MCP hub)               |
|                                                  |
|  +---------------+  +------------------------+  |
|  |  Capability   |  |  Workflow Engine        |  |
|  |  Registry     |  |  (templates, stages,   |  |
|  |               |  |   gates, routing)       |  |
|  +---------------+  +------------------------+  |
|                                                  |
|  +----------------------------------------------+|
|  |  Message Bus (Dolt-backed persistence)       ||
|  +----------------------------------------------+|
+--------+----------------+----------------+-------+
         |                |                |
    +----+-----+    +-----+------+    +----+-----+
    | Claude   |    |  Cursor    |    |  Codex   |
    | Code     |    |            |    |  (via    |
    | (MCP     |    |  (MCP      |    |  CLI)    |
    | client)  |    |  client)   |    |          |
    +----------+    +------------+    +----------+
```

### Layer 1: Agent Adapters

Each adapter translates between agent-messenger's internal task/message format and the agent's native interface.

### Control Plane Reality

V1 supports two adapter classes:

- **Managed adapters**: the orchestrator can start, poll, cancel, and resume runs (`claude-code`, `codex`).
- **Interactive adapters**: the orchestrator can assign work only to an already-connected agent identity and wait for a reply (`cursor` local).
- **Deferred adapters**: agents without a documented programmatic run API are out of scope for v1 (`cursor-cloud`).

`cursor-cloud` is deferred until a documented API exists for: create run, poll status, stream partial output, cancel run, and fetch artifacts.

| Adapter | Protocol | Control plane | Status | Notes |
|---------|----------|--------------|--------|-------|
| Claude Code | MCP client connection | Managed | Exists (extend) | Add: run lifecycle, skill invocation, worktree support |
| Codex | Codex CLI wrapper | Managed | New | Wraps `codex` commands. Async execution. Auth via existing Codex login. |
| Cursor | MCP client connection | Interactive | Exists (extend) | Assign work to connected identity, wait for reply. No model override in v1. |
| Cursor Cloud | TBD | Deferred | Out of scope v1 | Requires documented programmatic API. |

**Adapter interface contract (each adapter implements):**

```typescript
interface AgentAdapter {
  readonly adapterId: string;
  readonly agentKind: 'claude-code' | 'cursor' | 'codex';
  readonly controlPlane: 'managed' | 'interactive';

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): Promise<{
    available: boolean;
    detail?: string;
    maxConcurrency: number;
  }>;

  getCapabilities(): Promise<Capability[]>;

  startRun(request: RunRequest): Promise<RunHandle>;
  resumeRun(runId: string): Promise<RunHandle | null>;
  pollRun(handle: RunHandle): Promise<RunSnapshot>;
  streamRun(
    handle: RunHandle,
    onEvent: (event: RunEvent) => void,
  ): Promise<() => void>;
  cancelRun(handle: RunHandle, reason?: string): Promise<void>;
  collectArtifacts(handle: RunHandle): Promise<Artifact[]>;
}

type RunEvent =
  | { type: 'started'; at: string }
  | { type: 'heartbeat'; at: string }
  | { type: 'partial-output'; stream: 'stdout' | 'stderr'; chunk: string; at: string }
  | { type: 'warning'; message: string; at: string }
  | { type: 'retryable-error'; message: string; at: string }
  | { type: 'completed'; at: string }
  | { type: 'failed'; message: string; at: string };
```

For interactive adapters, `startRun` delivers the task prompt and returns a handle. `pollRun` checks whether the connected agent has posted a reply. `resumeRun`, `streamRun`, and `cancelRun` return no-ops or null as appropriate for the interactive control plane.

### Layer 2: Capability Registry

When an agent connects, its adapter registers capabilities. The workflow engine queries the registry to find agents that can handle a stage's requirements.

**Capability model:**

```typescript
interface Capability {
  name: string;          // e.g. 'creative-reasoning', 'file-index-analysis'
  category: CapabilityCategory;  // 'reasoning' | 'implementation' | 'review' | 'analysis'
  confidence: number;    // 0-1, how well this agent handles this capability
                         // Used by router: when multiple agents match a `requires:` field,
                         // highest confidence wins. Ties broken by availability.
}
```

**Default capability profiles:**

| Agent type | Control plane | Capabilities |
|-----------|--------------|-------------|
| Claude Code | Managed | creative-reasoning, test-driven-development, code-implementation, superpowers-skills, subagent-delegation |
| Codex | Managed | adversarial-review, investigation, gpt-family-reasoning |
| Cursor | Interactive | file-index-analysis, cross-file-reasoning, architecture-review, human-in-loop-review |

### Layer 3: Workflow Engine

Executes multi-stage workflows defined by YAML templates. Stages form a directed acyclic graph (DAG) via explicit `needs` dependencies, not a linear chain.

**Workflow template schema:**

```yaml
name: string
description: string
trigger: manual

stages:
  - id: string
    needs: [stage-id, ...]          # DAG dependencies
    adapter: string | null          # explicit adapter id
    requires: [capability, ...]     # routing alternative
    prompt_template: string
    inputs:
      input_name: stage-id.output_name
    outputs:
      - name: string
        format: markdown | json | text | artifact_ref
    execution:
      mode: single | fanout
      max_parallel: number
      timeout: 15m
      on_timeout: fail | cancel | continue
      retry:
        max_attempts: number
        backoff: linear | exponential
    gate:
      type: none | approval
      reviewers:
        - adapter: string | null
          requires: [capability, ...]
      quorum: all | any | majority
      on_fail:
        action: revise | abort | continue
        target: stage-id
        max_revisions: number
        aggregate_feedback: true
```

Templates must form a DAG after removing explicit bounded revise edges; every stage id must be unique; every input reference must resolve; revise loops must declare `max_revisions`; and every timeout must declare `on_timeout`.

**Key schema improvements over the original design:**

1. **DAG dependencies via `needs:`** -- stages declare which other stages must complete before they start. Fan-in from multiple parallel stages is modelled by listing multiple stage IDs in `needs`.
2. **Typed outputs** -- each stage declares named outputs with format, enabling downstream stages to reference specific outputs from specific predecessors via `inputs: { input_name: stage-id.output_name }`.
3. **Execution control** -- `mode: fanout` with `max_parallel` replaces the ambiguous `parallel: boolean`. `timeout` and `on_timeout` are mandatory companions.
4. **Retry policy** -- managed adapters can retry on `retryable-error` events with configurable backoff.
5. **Structured gates** -- reviewers are separate from stage executors. `aggregate_feedback: true` merges rejection feedback before sending to the revise target.

**Prompt templates:**

Separate YAML files containing agent-specific instructions. Support variable interpolation from workflow context.

```yaml
# .prompt-templates/brainstorm-creative.yaml
agent_type: claude-code
template: |
  You are brainstorming a new feature.
  Context: {{task_description}}
  Repository: {{repo_name}}

  Focus on creative, user-facing ideas.
  Output your top ideas with trade-offs.

  When done, send your output via #cm.
```

Variables available: `task_description`, `repo_name`, `stage_name`, `previous_output`, `feedback` (if in a revision loop).

## Beads Persistence Model (v1)

V1 persists workflow state in the project-local Beads database using run and stage records, not one Dolt branch per workflow execution.

- Each workflow execution gets a stable `run_id`.
- A `workflow-run` record stores template name, status, created_by, started_at, finished_at, and current stage.
- A `workflow-stage` record stores `run_id`, `stage_id`, `attempt`, assigned adapter, status, timestamps, timeout policy, and result summary.
- Stage outputs are stored as Beads-linked artifacts or files referenced by path and checksum.
- All records are labelled `workflow:<name>`, `run:<run_id>`, and `stage:<stage_id>` for replay and querying.
- When more than one workflow or managed adapter may write concurrently, Beads server mode is required.

Dolt history remains valuable for audit and replay, but branch-per-workflow is deferred until usage proves it needs an export layer on top of Beads records.

## Model Configuration

Each agent adapter supports model selection. This is important because model diversity across stages produces better outcomes than using the same model everywhere (different models catch different things).

**Model configuration in adapters:**

| Agent | Model configuration | Default |
|-------|-------------------|---------|
| Claude Code | Set via `--model` flag or `model` in settings. Adapters can override per-task. | Opus 4.6 (orchestration, brainstorming), Sonnet 4.6 (implementation workers) |
| Cursor | Model selector in Cursor settings or per-chat. Cursor Cloud uses the model specified in the agent config. | Depends on Cursor subscription. Supports Claude, GPT, Gemini families. |
| Codex | Set via `codex` config or `--model` flag. Plugin supports `--model` override. | GPT-5.4 (default), configurable per-task |

**Model selection in workflow templates:**

Templates can specify model preferences per stage:

```yaml
stages:
  - name: brainstorm
    parallel: true
    assign:
      - agent: claude-code
        model: opus-4-6        # Deep creative reasoning
        prompt_template: brainstorm-creative
      - agent: cursor
        model: gemini-2.5-pro  # Different model family for diversity
        prompt_template: brainstorm-architectural
  - name: review-spec
    parallel: true
    assign:
      - agent: codex
        model: gpt-5.4         # GPT family perspective
        prompt_template: adversarial-review
      - agent: claude-code
        model: sonnet-4-6      # Cheaper Claude for review (not orchestration)
        prompt_template: structure-review
```

**Why model diversity matters for this system:**

1. **Parallel brainstorming:** Two models from different families (e.g. Claude Opus + Gemini Pro) produce genuinely different ideas. Same-model parallelism mostly produces variations on a theme.
2. **Adversarial review:** A GPT-family model reviewing Claude-generated code catches different classes of issues than Claude reviewing its own output. Cross-family review is structurally more independent.
3. **Cost optimization:** Not every stage needs the most expensive model. Implementation workers can use Sonnet. Only orchestration and creative stages need Opus.
4. **Cursor as the model-agnostic seat:** Cursor supports Claude, GPT, and Gemini families in a single UI. This makes it the natural choice for stages where you want to pick the best model for the task regardless of provider.

**Model override hierarchy (highest wins, managed adapters only in v1):**

1. Explicit `model:` in the workflow template stage assignment
2. Agent adapter default (configured in capability registry)
3. Agent's own default (from its settings/config)

**v1 constraint:** Per-stage model override is only supported for managed adapters (Claude Code, Codex). Interactive adapters (Cursor local) use whatever model the connected session is configured with. The orchestrator cannot change Cursor's model programmatically.

## Superpowers Integration Layer

This is NOT part of agent-messenger. This is Campbell's layer that maps superpowers lifecycle stages to agent-messenger workflows.

**Implementation:** A superpowers plugin or skill (`superpowers-agent-messenger`) that:

1. Exposes slash commands: `/orchestrate <workflow> <description>`
2. Maps superpowers stages to agent-messenger workflow stages:

| Superpowers stage | Workflow stage | Default agents |
|---|---|---|
| `brainstorming` | `brainstorm` (parallel) | Claude Code + Cursor/Codex |
| `writing-plans` | `plan` + `review-plan` | Claude Code + Cursor/Codex review |
| `test-driven-development` | `implement` | Claude Code |
| `requesting-code-review` | `review-code` (parallel) | Cursor (file index) + Codex (adversarial) |
| `finishing-a-development-branch` | `finalize` | Claude Code |

3. Registers Trialight-specific prompt templates (lives outside upstream repo)
4. Optionally hooks agent-messenger events to Slack notifications (via existing Slack MCP)
5. Registers Trialight custom agents (pipeline-reviewer, security-auditor-tl, etc.) as capabilities when they're running

**Note:** This integration layer is Phase 5 scope. It depends on the core run controller (Phases 1-3) being stable.

## Plugin Distribution

**v1 target:** npm package (`@wolfego/agent-messenger`) with MCP server entry point. This is the minimum viable distribution -- install, connect, run workflows.

**Future distribution (post-v1):**

| Platform | Format | What ships |
|----------|--------|-----------|
| Claude Code | Plugin (marketplace) | MCP server + `/agent-messenger:*` slash commands + workflow skill |
| Cursor | Extension + MCP config | Settings UI + status bar + workflow picker |
| npm | `@wolfego/agent-messenger` | Core library for programmatic use |

Marketplace packaging and Cursor extension are deferred until the core run controller is proven (end of Phase 3).

## Contribution Model

| Component | Owner | Rationale |
|-----------|-------|-----------|
| Workflow engine (template parsing, execution, gates) | Collaborative | Core to agent-messenger. Benefits all users. |
| Agent adapter interface (TypeScript contract) | wolfego | His architecture. Should be clean, stable, opinionated. |
| Claude Code adapter (extend existing) | Campbell | Knows superpowers, skills, hooks. |
| Codex adapter (new) | Campbell | Has codex-plugin-cc experience. |
| Cursor Cloud adapter (new) | Either | Depends on Cursor Cloud API access. |
| Prompt templates (generic) | Collaborative | Shared upstream for all users. |
| Prompt templates (Trialight-specific) | Campbell | Domain-specific. Lives in Trialight repos. |
| Superpowers integration plugin | Campbell | Trialight-only layer. |

### Contract Governance

- The adapter SDK, workflow schema, and execution state model are one review unit.
- wolfego is the primary owner of the core runtime contract.
- Campbell is the required reviewer for any change that affects Claude Code, Codex, or superpowers integration.
- No adapter contract change merges without:
  1. Updating the reference managed adapter.
  2. Updating the interactive adapter shim if affected.
  3. Passing contract tests for run start, poll, cancel, resume, and artifact collection.

## Pitch to Co-Maintainer (wolfego)

> "Your orchestrator is already the only tool that gives Cursor and Claude Code a shared brain. The next step is making it a local workflow runner: agents connect, the engine routes work through a YAML-defined DAG of stages, and Beads persists every run so workflows survive restarts. I'll contribute the Claude Code and Codex adapters. You own the core engine and adapter contract.
>
> We prove it with one real workflow (parallel brainstorm + review), then build up to templates and capability routing. Distribution starts as an npm package; marketplace packaging comes after the runner is solid."

**Value proposition from wolfego's perspective:**
1. agent-messenger goes from "messenger" to "workflow runner" -- a meaningful step toward orchestration without over-promising
2. The adapter pattern means the core stays clean. New agents are new adapters, not core changes.
3. YAML workflow templates (Phase 3) become a distribution mechanism. Users share workflows like GitHub Actions.
4. Beads/Dolt persistence is a differentiator -- run replay, audit trails, and version-controlled workflow state
5. Real-world validation through Trialight (a production startup) using it daily

## Phases

### Phase 1: Local Run Controller (1-2 weeks)

- Add `run_id`, stage records, leases, cancellation, and timeout handling to Beads
- Implement one hard-coded fan-out/fan-in workflow on already-connected Claude Code agents
- Persist run and stage state so a workflow can resume after restart

**Deliverable:** A restart-safe local workflow runner with one hard-coded template.

### Phase 2: Adapter SDK + Reference Adapters (1-2 weeks)

- Introduce the `AgentAdapter` contract (managed + interactive variants)
- Refactor Claude Code into the first managed adapter
- Add Codex as a managed adapter
- Add Cursor local as an interactive adapter

**Deliverable:** Three adapters behind one contract, with contract tests.

### Phase 3: YAML DAG Templates + Gates (2-3 weeks)

- Parse and validate template DAGs
- Implement fan-in, fan-out, revision limits, and timeout policies
- Add prompt-template interpolation and artifact collection

**Deliverable:** Multiple YAML workflows run end-to-end on local adapters.

### Phase 4: Capability Registry + Connected-Agent Routing (1-2 weeks)

- Register capability snapshots for connected adapters
- Add lease-based routing across available local agents
- Route by capability, control plane, availability, and concurrency

**Deliverable:** Templates can target capabilities without naming a specific connected adapter.

### Phase 5: Packaging + Trialight Integration (1-2 weeks)

- Ship the npm package and init flow
- Add Trialight workflow templates outside the upstream core
- Add optional Slack hooks in the Trialight integration layer

**Deliverable:** One install path and one real Trialight workflow.

### Future Phase: Cursor Cloud

- Only start after a documented programmatic API exists for: create run, poll status, stream partial output, cancel run, and fetch artifacts.

## Risks

| Risk | Mitigation |
|------|-----------|
| Cursor Cloud has no documented programmatic API | Deferred to future phase. v1 uses Cursor local (interactive adapter) only. |
| Codex CLI may change rapidly (new project) | Adapter isolates Codex specifics. CLI wrapper is thin. Contract tests catch breaking changes. |
| Claude Code Agent Teams overlap | Agent Teams is for Claude-only parallelism. This system is cross-tool. Complementary, not competing. |
| Adapter contract churn during early phases | Contract governance rules (Amendment 6) require updating reference adapters and passing contract tests before merging. |
| Beads concurrent write conflicts | Beads server mode required when multiple managed adapters write concurrently. Phase 1 validates this. |
| Scope creep into event-driven triggers | v1 is manual trigger only. Event triggers are a future phase with its own spec. |
| Interactive adapter limitations | Cursor local cannot be started, cancelled, or model-overridden programmatically. Spec explicitly acknowledges this as a control plane constraint, not a bug. |

## Adjacent Solutions

1. **Scheduled orchestration via Prefect.** Once manual workflows are stable, wrap them as Prefect flows for scheduled execution (e.g. nightly security scan across all repos using all three agents).
2. **Workflow analytics dashboard.** Dolt data enables: which agents are most useful at which stages, average gate pass rates, time-per-stage trends. Could be a simple Streamlit app reading Dolt.
3. **Agent-messenger as a Claude Code Agent Teams backend.** Instead of competing with Agent Teams, agent-messenger could be the persistence layer that Agent Teams currently lacks (no session resumption).
