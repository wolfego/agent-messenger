# Agent-Messenger Universal Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend agent-messenger from a Cursor/Claude Code messenger into a Beads-backed local workflow runner with managed and interactive adapters, DAG-based YAML templates, capability routing, and an npm distribution target.

**Architecture:** Three layers added to agent-messenger: (1) Agent Adapters with managed/interactive control planes, (2) Capability Registry for connected agents, (3) Workflow Engine executing YAML DAG templates with gates and revision loops. All state persisted via Beads records (run_id + stage records), not branch-per-workflow.

**Tech Stack:** TypeScript (strict ESM), Vitest, Beads/Dolt (via `bd` CLI), MCP SDK (`@modelcontextprotocol/sdk`), Zod v4 (schema validation), YAML (`yaml` npm package for template parsing).

**Reference spec:** `trialight-hub/docs/superpowers/specs/2026-04-13-agent-messenger-orchestrator-design.md`

**Target repo:** `wolfego/agent-messenger` (not the Trialight workspace). Clone it locally before starting. All file paths below are relative to the agent-messenger repo root.

**Note on shell execution:** agent-messenger uses `execSync` to call the `bd` CLI. This is the established pattern in the repo (`src/beads.ts`, `src/tasks.ts`). New code follows this pattern. The Trialight workspace's `execFileNoThrow` utility is not available in the agent-messenger repo.

---

## File Structure

### New files (Phase 1: Local Run Controller)

| File | Responsibility |
|------|---------------|
| `src/workflow-engine/types.ts` | Core types: RunId, RunStatus, StageStatus, RunRecord, StageRecord, RunHandle, RunSnapshot |
| `src/workflow-engine/persistence.ts` | Beads read/write for workflow-run and workflow-stage records |
| `src/workflow-engine/run-controller.ts` | Create run, advance stages, fan-out/fan-in, cancel, resume, timeout |
| `src/workflow-engine/timeout-manager.ts` | Timer-based timeout enforcement with configurable on_timeout actions |
| `src/workflow-engine/hardcoded-brainstorm.ts` | One hardcoded parallel brainstorm workflow (no YAML yet) |
| `src/workflow-engine/index.ts` | Public API barrel export |
| `src/tools/start-workflow.ts` | MCP tool: start a workflow run |
| `src/tools/run-status.ts` | MCP tool: check workflow run status |
| `src/tools/cancel-run.ts` | MCP tool: cancel a running workflow |
| `src/tools/list-runs.ts` | MCP tool: list workflow runs |
| `tests/workflow-engine/persistence.test.ts` | Beads persistence tests |
| `tests/workflow-engine/run-controller.test.ts` | Run controller logic tests |
| `tests/workflow-engine/timeout-manager.test.ts` | Timeout enforcement tests |
| `tests/workflow-engine/hardcoded-brainstorm.test.ts` | End-to-end hardcoded workflow test |

### New files (Phase 2: Adapter SDK)

| File | Responsibility |
|------|---------------|
| `src/adapters/types.ts` | AgentAdapter interface, RunEvent, RunRequest, Capability, Artifact types |
| `src/adapters/base-managed.ts` | Abstract base class for managed adapters |
| `src/adapters/base-interactive.ts` | Abstract base class for interactive adapters |
| `src/adapters/claude-code.ts` | Claude Code managed adapter |
| `src/adapters/codex.ts` | Codex CLI managed adapter |
| `src/adapters/cursor.ts` | Cursor interactive adapter |
| `src/adapters/registry.ts` | Adapter registry (connect, disconnect, lookup) |
| `tests/adapters/contract.test.ts` | Shared contract tests run against all adapters |
| `tests/adapters/claude-code.test.ts` | Claude Code adapter unit tests |
| `tests/adapters/codex.test.ts` | Codex adapter unit tests |
| `tests/adapters/cursor.test.ts` | Cursor adapter unit tests |

### New files (Phase 3: YAML Templates + Gates)

| File | Responsibility |
|------|---------------|
| `src/workflow-engine/template-parser.ts` | YAML template loading, validation, DAG cycle detection |
| `src/workflow-engine/template-schema.ts` | Zod schema for workflow template YAML |
| `src/workflow-engine/prompt-template.ts` | Prompt template loading + variable interpolation |
| `src/workflow-engine/gate-evaluator.ts` | Gate quorum logic (all/any/majority), revision loops |
| `src/workflow-engine/artifact-collector.ts` | Collect and store stage artifacts |
| `src/workflow-engine/dag-executor.ts` | DAG-aware stage scheduler (replaces hardcoded logic) |
| `templates/parallel-brainstorm.yaml` | Example: parallel brainstorm + synthesize |
| `templates/review-only.yaml` | Example: parallel code review |
| `prompt-templates/brainstorm-creative.yaml` | Generic brainstorm prompt |
| `prompt-templates/adversarial-review.yaml` | Generic adversarial review prompt |
| `tests/workflow-engine/template-parser.test.ts` | Template validation + DAG tests |
| `tests/workflow-engine/gate-evaluator.test.ts` | Gate quorum + revision loop tests |
| `tests/workflow-engine/dag-executor.test.ts` | DAG scheduling tests |

### New files (Phase 4: Capability Registry + Routing)

| File | Responsibility |
|------|---------------|
| `src/capabilities/registry.ts` | Capability snapshots per connected adapter |
| `src/capabilities/router.ts` | Capability-based agent selection for stages |
| `src/capabilities/defaults.ts` | Default capability profiles per agent kind |
| `tests/capabilities/router.test.ts` | Routing logic tests |

### New files (Phase 5: Packaging + Trialight Integration)

| File | Responsibility |
|------|---------------|
| (agent-messenger repo) Updated `package.json` | npm publish config, exports field |
| (Trialight workspace) `.claude/skills/orchestrate/SKILL.md` | Superpowers integration skill |
| (Trialight workspace) `.workflows/*.yaml` | Trialight-specific workflow templates |
| (Trialight workspace) `.prompt-templates/*.yaml` | Trialight-specific prompt templates |

### Modified files (across all phases)

| File | Changes |
|------|---------|
| `src/index.ts` | Register new MCP tools (start-workflow, run-status, cancel-run, list-runs) |
| `package.json` | Add `yaml` dependency, update version, add exports |
| `src/beads.ts` | Export `bdExec` helper if not already exported |

---

## Phase 1: Local Run Controller

### Task 1: Set up workflow-engine module with core types

**Files:**
- Create: `src/workflow-engine/types.ts`
- Create: `src/workflow-engine/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/workflow-engine/types.ts

export type RunId = string;
export type StageId = string;

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type StageStatus =
  | 'pending'
  | 'waiting_for_deps'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'revision_pending';

export type OnTimeoutAction = 'fail' | 'cancel' | 'continue';

export interface RunRecord {
  runId: RunId;
  templateName: string;
  description: string;
  status: RunStatus;
  createdBy: string;
  startedAt: string;
  finishedAt: string | null;
  currentStageIds: StageId[];
  error: string | null;
}

export interface StageRecord {
  runId: RunId;
  stageId: StageId;
  attempt: number;
  assignedAdapter: string | null;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  timeout: string;
  onTimeout: OnTimeoutAction;
  resultSummary: string | null;
  artifactPaths: string[];
  error: string | null;
}

export interface RunHandle {
  runId: RunId;
}

export interface RunSnapshot {
  run: RunRecord;
  stages: StageRecord[];
}

export interface StageDefinition {
  id: StageId;
  needs: StageId[];
  prompt: string;
  timeout: string;
  onTimeout: OnTimeoutAction;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  stages: StageDefinition[];
}
```

- [ ] **Step 2: Write the barrel export**

```typescript
// src/workflow-engine/index.ts

export * from './types.js';
export { WorkflowPersistence } from './persistence.js';
export { RunController } from './run-controller.js';
export { TimeoutManager } from './timeout-manager.js';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/workflow-engine/types.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/workflow-engine/types.ts src/workflow-engine/index.ts
git commit -m "feat(workflow): add core types for run controller"
```

---

### Task 2: Implement Beads persistence for workflow runs and stages

**Files:**
- Create: `src/workflow-engine/persistence.ts`
- Create: `tests/workflow-engine/persistence.test.ts`
- Modify: `src/beads.ts` (export `bdExec` if not already exported)

- [ ] **Step 1: Check if `bdExec` is exported from `src/beads.ts`**

Read `src/beads.ts` and check the export. If `bdExec` is not exported, add `export` to its declaration. The workflow persistence layer needs to call `bdExec` for Beads operations. If the function signature differs from what we need, create a local wrapper that matches.

- [ ] **Step 2: Write the failing test for `createRun`**

```typescript
// tests/workflow-engine/persistence.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { WorkflowPersistence } from '../../src/workflow-engine/persistence.js';

function hasBd(): boolean {
  try {
    execSync('bd --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasBd();

describe.skipIf(!canRun)('WorkflowPersistence', () => {
  let tempDir: string;
  let persistence: WorkflowPersistence;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'am-wf-test-'));
    execSync('bd init --server', { cwd: tempDir });
    persistence = new WorkflowPersistence(tempDir);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a workflow run record', async () => {
    const run = await persistence.createRun({
      templateName: 'test-workflow',
      description: 'Test run',
      createdBy: 'test-agent',
    });

    expect(run.runId).toBeTruthy();
    expect(run.status).toBe('pending');
    expect(run.templateName).toBe('test-workflow');
    expect(run.createdBy).toBe('test-agent');
    expect(run.startedAt).toBeTruthy();
    expect(run.finishedAt).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/workflow-engine/persistence.test.ts`
Expected: FAIL -- `WorkflowPersistence` not found.

- [ ] **Step 4: Implement `WorkflowPersistence`**

The full implementation includes: `createRun`, `getRun`, `updateRun`, `createStage`, `getStage`, `updateStage`, `getStagesForRun`, `listRuns`.

Key implementation details:
- Each run is a Beads chore record with `kind:workflow-run` label
- Run data stored as JSON in the `description` field
- `run_id` is `run-` + 8 random hex chars
- Stage records are separate chores with `kind:workflow-stage` label
- All records labelled with `run:<runId>` for efficient querying
- Uses `bd create`, `bd list`, `bd update` via the existing `bdExec` pattern

```typescript
// src/workflow-engine/persistence.ts

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { RunRecord, StageRecord, RunId, StageId } from './types.js';

function bdExec(args: string, beadsDir: string): string {
  const result = execSync(`bd ${args}`, {
    cwd: beadsDir,
    env: { ...process.env, BEADS_DIR: beadsDir },
    timeout: 30_000,
    encoding: 'utf-8',
  });
  return result.trim();
}

function bdExecJson(args: string, beadsDir: string): unknown {
  const raw = bdExec(`${args} --json`, beadsDir);
  return JSON.parse(raw);
}

// Escape single quotes for shell arguments
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export class WorkflowPersistence {
  constructor(private readonly beadsDir: string) {}

  async createRun(params: {
    templateName: string;
    description: string;
    createdBy: string;
  }): Promise<RunRecord> {
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const record: RunRecord = {
      runId,
      templateName: params.templateName,
      description: params.description,
      status: 'pending',
      createdBy: params.createdBy,
      startedAt: now,
      finishedAt: null,
      currentStageIds: [],
      error: null,
    };

    const title = `Workflow: ${params.templateName} — ${params.description.slice(0, 60)}`;
    const labels = [
      'kind:workflow-run',
      `workflow:${params.templateName}`,
      `run:${runId}`,
      'status:pending',
    ].join(',');

    const desc = JSON.stringify(record);
    bdExec(
      `create '${shellEscape(title)}' --type chore --description '${shellEscape(desc)}' --labels "${labels}"`,
      this.beadsDir,
    );

    return record;
  }

  async getRun(runId: RunId): Promise<RunRecord | null> {
    try {
      const result = bdExecJson(
        `list --type chore --label "kind:workflow-run" --label "run:${runId}" --flat`,
        this.beadsDir,
      ) as Array<{ description?: string }>;

      if (!result || result.length === 0) return null;
      if (!result[0].description) return null;
      return JSON.parse(result[0].description) as RunRecord;
    } catch {
      return null;
    }
  }

  async updateRun(
    runId: RunId,
    updates: Partial<Pick<RunRecord, 'status' | 'currentStageIds' | 'finishedAt' | 'error'>>,
  ): Promise<void> {
    const existing = await this.getRun(runId);
    if (!existing) throw new Error(`Run ${runId} not found`);

    const updated = { ...existing, ...updates };
    const desc = JSON.stringify(updated);

    const result = bdExecJson(
      `list --type chore --label "kind:workflow-run" --label "run:${runId}" --flat`,
      this.beadsDir,
    ) as Array<{ id: string }>;

    if (!result || result.length === 0) throw new Error(`Run ${runId} bead not found`);

    bdExec(
      `update ${result[0].id} --description '${shellEscape(desc)}'`,
      this.beadsDir,
    );
  }

  async createStage(params: {
    runId: RunId;
    stageId: StageId;
    timeout: string;
    onTimeout: 'fail' | 'cancel' | 'continue';
  }): Promise<StageRecord> {
    const stage: StageRecord = {
      runId: params.runId,
      stageId: params.stageId,
      attempt: 1,
      assignedAdapter: null,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      timeout: params.timeout,
      onTimeout: params.onTimeout,
      resultSummary: null,
      artifactPaths: [],
      error: null,
    };

    const title = `Stage: ${params.stageId} (${params.runId})`;
    const labels = [
      'kind:workflow-stage',
      `run:${params.runId}`,
      `stage:${params.stageId}`,
      'status:pending',
    ].join(',');

    const desc = JSON.stringify(stage);
    bdExec(
      `create '${shellEscape(title)}' --type chore --description '${shellEscape(desc)}' --labels "${labels}"`,
      this.beadsDir,
    );

    return stage;
  }

  async getStage(runId: RunId, stageId: StageId): Promise<StageRecord | null> {
    try {
      const result = bdExecJson(
        `list --type chore --label "kind:workflow-stage" --label "run:${runId}" --label "stage:${stageId}" --flat`,
        this.beadsDir,
      ) as Array<{ description?: string }>;

      if (!result || result.length === 0) return null;
      if (!result[0].description) return null;
      return JSON.parse(result[0].description) as StageRecord;
    } catch {
      return null;
    }
  }

  async updateStage(runId: RunId, stageId: StageId, updates: Partial<StageRecord>): Promise<void> {
    const existing = await this.getStage(runId, stageId);
    if (!existing) throw new Error(`Stage ${stageId} in run ${runId} not found`);

    const updated = { ...existing, ...updates };
    const desc = JSON.stringify(updated);

    const result = bdExecJson(
      `list --type chore --label "kind:workflow-stage" --label "run:${runId}" --label "stage:${stageId}" --flat`,
      this.beadsDir,
    ) as Array<{ id: string }>;

    if (!result || result.length === 0) throw new Error(`Stage bead not found`);

    bdExec(
      `update ${result[0].id} --description '${shellEscape(desc)}'`,
      this.beadsDir,
    );
  }

  async getStagesForRun(runId: RunId): Promise<StageRecord[]> {
    try {
      const result = bdExecJson(
        `list --type chore --label "kind:workflow-stage" --label "run:${runId}" --flat`,
        this.beadsDir,
      ) as Array<{ description?: string }>;

      return (result || [])
        .filter((r) => r.description)
        .map((r) => JSON.parse(r.description!) as StageRecord);
    } catch {
      return [];
    }
  }

  async listRuns(params?: {
    templateName?: string;
    status?: string;
  }): Promise<RunRecord[]> {
    try {
      const labelFilters = ['kind:workflow-run'];
      if (params?.templateName) labelFilters.push(`workflow:${params.templateName}`);
      if (params?.status) labelFilters.push(`status:${params.status}`);

      const labelArgs = labelFilters.map((l) => `--label "${l}"`).join(' ');
      const result = bdExecJson(
        `list --type chore ${labelArgs} --flat`,
        this.beadsDir,
      ) as Array<{ description?: string }>;

      return (result || [])
        .filter((r) => r.description)
        .map((r) => JSON.parse(r.description!) as RunRecord);
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/workflow-engine/persistence.test.ts`
Expected: PASS.

- [ ] **Step 6: Add remaining persistence tests**

Add tests for: `getRun`, `updateRun`, `createStage`, `getStage`, `updateStage`, `getStagesForRun`, `listRuns`. Each test should be independent (creates its own run).

```typescript
// Append to tests/workflow-engine/persistence.test.ts

  it('retrieves a run by runId', async () => {
    const created = await persistence.createRun({
      templateName: 'test-get',
      description: 'Get test',
      createdBy: 'test-agent',
    });

    const retrieved = await persistence.getRun(created.runId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.runId).toBe(created.runId);
    expect(retrieved!.templateName).toBe('test-get');
  });

  it('returns null for non-existent run', async () => {
    const result = await persistence.getRun('run-nonexistent');
    expect(result).toBeNull();
  });

  it('updates run status', async () => {
    const created = await persistence.createRun({
      templateName: 'test-update',
      description: 'Update test',
      createdBy: 'test-agent',
    });

    await persistence.updateRun(created.runId, {
      status: 'running',
      currentStageIds: ['stage-1'],
    });

    const updated = await persistence.getRun(created.runId);
    expect(updated!.status).toBe('running');
    expect(updated!.currentStageIds).toEqual(['stage-1']);
  });

  it('creates and retrieves a stage record', async () => {
    const run = await persistence.createRun({
      templateName: 'test-stages',
      description: 'Stage test',
      createdBy: 'test-agent',
    });

    const stage = await persistence.createStage({
      runId: run.runId,
      stageId: 'brainstorm-1',
      timeout: '15m',
      onTimeout: 'fail',
    });

    expect(stage.stageId).toBe('brainstorm-1');
    expect(stage.status).toBe('pending');

    const retrieved = await persistence.getStage(run.runId, 'brainstorm-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.stageId).toBe('brainstorm-1');
  });

  it('updates stage status and result', async () => {
    const run = await persistence.createRun({
      templateName: 'test-stage-update',
      description: 'Stage update test',
      createdBy: 'test-agent',
    });

    await persistence.createStage({
      runId: run.runId,
      stageId: 'impl-1',
      timeout: '10m',
      onTimeout: 'cancel',
    });

    await persistence.updateStage(run.runId, 'impl-1', {
      status: 'running',
      startedAt: new Date().toISOString(),
      assignedAdapter: 'claude-code-1',
    });

    const updated = await persistence.getStage(run.runId, 'impl-1');
    expect(updated!.status).toBe('running');
    expect(updated!.assignedAdapter).toBe('claude-code-1');
  });

  it('lists stages for a run', async () => {
    const run = await persistence.createRun({
      templateName: 'test-list-stages',
      description: 'List stages test',
      createdBy: 'test-agent',
    });

    await persistence.createStage({ runId: run.runId, stageId: 'stage-a', timeout: '5m', onTimeout: 'fail' });
    await persistence.createStage({ runId: run.runId, stageId: 'stage-b', timeout: '10m', onTimeout: 'cancel' });

    const stages = await persistence.getStagesForRun(run.runId);
    expect(stages.length).toBe(2);
    const ids = stages.map((s) => s.stageId).sort();
    expect(ids).toEqual(['stage-a', 'stage-b']);
  });

  it('lists runs filtered by template name', async () => {
    await persistence.createRun({ templateName: 'alpha', description: 'Alpha', createdBy: 'test-agent' });
    await persistence.createRun({ templateName: 'beta', description: 'Beta', createdBy: 'test-agent' });

    const alphaRuns = await persistence.listRuns({ templateName: 'alpha' });
    expect(alphaRuns.length).toBeGreaterThanOrEqual(1);
    expect(alphaRuns.every((r) => r.templateName === 'alpha')).toBe(true);
  });
```

- [ ] **Step 7: Run full persistence test suite**

Run: `npx vitest run tests/workflow-engine/persistence.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/workflow-engine/persistence.ts tests/workflow-engine/persistence.test.ts
git commit -m "feat(workflow): add Beads persistence for workflow runs and stages"
```

---

### Task 3: Implement timeout manager

**Files:**
- Create: `src/workflow-engine/timeout-manager.ts`
- Create: `tests/workflow-engine/timeout-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workflow-engine/timeout-manager.test.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimeoutManager } from '../../src/workflow-engine/timeout-manager.js';

describe('TimeoutManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses duration strings correctly', () => {
    expect(TimeoutManager.parseDuration('15m')).toBe(15 * 60 * 1000);
    expect(TimeoutManager.parseDuration('1h')).toBe(60 * 60 * 1000);
    expect(TimeoutManager.parseDuration('30s')).toBe(30 * 1000);
    expect(TimeoutManager.parseDuration('2h30m')).toBe(150 * 60 * 1000);
  });

  it('calls onTimeout callback when timer expires', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();
    const callback = vi.fn();

    manager.startTimer('run-1', 'stage-1', '1s', callback);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledWith('run-1', 'stage-1');

    vi.useRealTimers();
  });

  it('cancels timer before expiry', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();
    const callback = vi.fn();

    manager.startTimer('run-1', 'stage-1', '5s', callback);
    manager.cancelTimer('run-1', 'stage-1');
    vi.advanceTimersByTime(6000);
    expect(callback).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('tracks active timers', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();

    manager.startTimer('run-1', 'stage-1', '10m', vi.fn());
    manager.startTimer('run-1', 'stage-2', '5m', vi.fn());
    expect(manager.activeTimerCount()).toBe(2);

    manager.cancelTimer('run-1', 'stage-1');
    expect(manager.activeTimerCount()).toBe(1);

    vi.useRealTimers();
  });

  it('cancelAllForRun removes all timers for a run', () => {
    vi.useFakeTimers();
    const manager = new TimeoutManager();

    manager.startTimer('run-1', 'stage-1', '10m', vi.fn());
    manager.startTimer('run-1', 'stage-2', '5m', vi.fn());
    manager.startTimer('run-2', 'stage-1', '5m', vi.fn());

    manager.cancelAllForRun('run-1');
    expect(manager.activeTimerCount()).toBe(1);

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow-engine/timeout-manager.test.ts`
Expected: FAIL -- `TimeoutManager` not found.

- [ ] **Step 3: Implement TimeoutManager**

```typescript
// src/workflow-engine/timeout-manager.ts

import type { RunId, StageId } from './types.js';

type TimeoutCallback = (runId: RunId, stageId: StageId) => void;

export class TimeoutManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private static key(runId: RunId, stageId: StageId): string {
    return `${runId}::${stageId}`;
  }

  static parseDuration(duration: string): number {
    let totalMs = 0;
    const hourMatch = duration.match(/(\d+)h/);
    const minMatch = duration.match(/(\d+)m/);
    const secMatch = duration.match(/(\d+)s/);

    if (hourMatch) totalMs += parseInt(hourMatch[1], 10) * 3_600_000;
    if (minMatch) totalMs += parseInt(minMatch[1], 10) * 60_000;
    if (secMatch) totalMs += parseInt(secMatch[1], 10) * 1_000;

    if (totalMs === 0) {
      throw new Error(`Invalid duration: ${duration}. Use format like '15m', '1h', '30s', '2h30m'.`);
    }
    return totalMs;
  }

  startTimer(runId: RunId, stageId: StageId, duration: string, onTimeout: TimeoutCallback): void {
    const key = TimeoutManager.key(runId, stageId);
    this.cancelTimer(runId, stageId);

    const ms = TimeoutManager.parseDuration(duration);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      onTimeout(runId, stageId);
    }, ms);

    this.timers.set(key, timer);
  }

  cancelTimer(runId: RunId, stageId: StageId): void {
    const key = TimeoutManager.key(runId, stageId);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  cancelAllForRun(runId: RunId): void {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${runId}::`)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
  }

  activeTimerCount(): number {
    return this.timers.size;
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-engine/timeout-manager.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow-engine/timeout-manager.ts tests/workflow-engine/timeout-manager.test.ts
git commit -m "feat(workflow): add timeout manager with duration parsing"
```

---

### Task 4: Implement the run controller

**Files:**
- Create: `src/workflow-engine/run-controller.ts`
- Create: `tests/workflow-engine/run-controller.test.ts`

- [ ] **Step 1: Write the failing test for creating a run with stages**

```typescript
// tests/workflow-engine/run-controller.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { RunController } from '../../src/workflow-engine/run-controller.js';
import type { WorkflowDefinition } from '../../src/workflow-engine/types.js';

function hasBd(): boolean {
  try {
    execSync('bd --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasBd();

const testWorkflow: WorkflowDefinition = {
  name: 'test-workflow',
  description: 'Two parallel stages and a merge',
  stages: [
    { id: 'brainstorm-1', needs: [], prompt: 'Brainstorm testing', timeout: '15m', onTimeout: 'fail' },
    { id: 'brainstorm-2', needs: [], prompt: 'Brainstorm quality', timeout: '15m', onTimeout: 'fail' },
    { id: 'synthesize', needs: ['brainstorm-1', 'brainstorm-2'], prompt: 'Merge outputs', timeout: '10m', onTimeout: 'cancel' },
  ],
};

describe.skipIf(!canRun)('RunController', () => {
  let tempDir: string;
  let controller: RunController;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'am-rc-test-'));
    execSync('bd init --server', { cwd: tempDir });
    controller = new RunController(tempDir);
  });

  afterAll(() => {
    controller.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a run with all stages in pending state', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');
    expect(snapshot.run.status).toBe('pending');
    expect(snapshot.stages.length).toBe(3);
    expect(snapshot.stages.every((s) => s.status === 'pending')).toBe(true);
  });

  it('getReadyStages returns only stages with no unmet dependencies', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');
    const ready = controller.getReadyStages(snapshot);
    expect(ready.map((s) => s.stageId).sort()).toEqual(['brainstorm-1', 'brainstorm-2']);
  });

  it('getReadyStages excludes stages with pending dependencies', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');
    const ready = controller.getReadyStages(snapshot);
    expect(ready.find((s) => s.stageId === 'synthesize')).toBeUndefined();
  });

  it('completeStage marks stage as completed and unblocks dependents', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');

    await controller.startStage(snapshot.run.runId, 'brainstorm-1', 'adapter-1');
    await controller.completeStage(snapshot.run.runId, 'brainstorm-1', 'Ideas about testing');

    await controller.startStage(snapshot.run.runId, 'brainstorm-2', 'adapter-2');
    await controller.completeStage(snapshot.run.runId, 'brainstorm-2', 'Ideas about quality');

    const updated = await controller.getSnapshot(snapshot.run.runId);
    const ready = controller.getReadyStages(updated);
    expect(ready.map((s) => s.stageId)).toEqual(['synthesize']);
  });

  it('cancelRun marks all pending/running stages as cancelled', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');
    await controller.startStage(snapshot.run.runId, 'brainstorm-1', 'adapter-1');

    await controller.cancelRun(snapshot.run.runId, 'User requested');

    const updated = await controller.getSnapshot(snapshot.run.runId);
    expect(updated.run.status).toBe('cancelled');
    expect(updated.stages.find((s) => s.stageId === 'brainstorm-1')!.status).toBe('cancelled');
  });

  it('resumes a run after simulated restart', async () => {
    const snapshot = await controller.createRun(testWorkflow, 'test-agent');
    await controller.startStage(snapshot.run.runId, 'brainstorm-1', 'adapter-1');

    const controller2 = new RunController(tempDir);
    (controller2 as any).definitions.set(snapshot.run.runId, testWorkflow);

    const resumed = await controller2.resumeRun(snapshot.run.runId);
    expect(resumed.run.status).toBe('running');

    controller2.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow-engine/run-controller.test.ts`
Expected: FAIL -- `RunController` not found.

- [ ] **Step 3: Implement RunController**

The RunController orchestrates the workflow lifecycle. Key methods:

- `createRun(workflow, createdBy)` -- creates run + stage records in Beads, stores workflow definition in memory
- `getSnapshot(runId)` -- reads current state from Beads
- `getReadyStages(snapshot)` -- computes which stages have all dependencies satisfied
- `startStage(runId, stageId, adapterId)` -- marks stage running, starts timeout timer, updates run
- `completeStage(runId, stageId, resultSummary)` -- marks stage completed, cancels timer, checks run completion
- `failStage(runId, stageId, error)` -- marks stage failed, fails the run, cancels all timers
- `cancelRun(runId, reason)` -- cancels all non-terminal stages and the run
- `resumeRun(runId)` -- re-registers timeout timers for running stages with remaining time

```typescript
// src/workflow-engine/run-controller.ts

import { WorkflowPersistence } from './persistence.js';
import { TimeoutManager } from './timeout-manager.js';
import type {
  RunId, StageId, RunSnapshot, StageRecord, WorkflowDefinition,
} from './types.js';

export class RunController {
  private readonly persistence: WorkflowPersistence;
  private readonly timeouts: TimeoutManager;
  private readonly definitions = new Map<RunId, WorkflowDefinition>();

  constructor(beadsDir: string) {
    this.persistence = new WorkflowPersistence(beadsDir);
    this.timeouts = new TimeoutManager();
  }

  async createRun(workflow: WorkflowDefinition, createdBy: string): Promise<RunSnapshot> {
    const run = await this.persistence.createRun({
      templateName: workflow.name,
      description: workflow.description,
      createdBy,
    });

    this.definitions.set(run.runId, workflow);

    const stages: StageRecord[] = [];
    for (const stageDef of workflow.stages) {
      const stage = await this.persistence.createStage({
        runId: run.runId,
        stageId: stageDef.id,
        timeout: stageDef.timeout,
        onTimeout: stageDef.onTimeout,
      });
      stages.push(stage);
    }

    return { run, stages };
  }

  async getSnapshot(runId: RunId): Promise<RunSnapshot> {
    const run = await this.persistence.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const stages = await this.persistence.getStagesForRun(runId);
    return { run, stages };
  }

  getReadyStages(snapshot: RunSnapshot): StageRecord[] {
    const completedIds = new Set(
      snapshot.stages.filter((s) => s.status === 'completed').map((s) => s.stageId),
    );

    const workflow = this.definitions.get(snapshot.run.runId);
    if (!workflow) return [];

    return snapshot.stages.filter((stage) => {
      if (stage.status !== 'pending') return false;
      const def = workflow.stages.find((d) => d.id === stage.stageId);
      if (!def) return false;
      return def.needs.every((dep) => completedIds.has(dep));
    });
  }

  async startStage(runId: RunId, stageId: StageId, adapterId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.persistence.updateStage(runId, stageId, {
      status: 'running',
      startedAt: now,
      assignedAdapter: adapterId,
    });

    const run = await this.persistence.getRun(runId);
    if (run && run.status === 'pending') {
      await this.persistence.updateRun(runId, { status: 'running', currentStageIds: [stageId] });
    } else if (run) {
      const ids = run.currentStageIds.includes(stageId)
        ? run.currentStageIds
        : [...run.currentStageIds, stageId];
      await this.persistence.updateRun(runId, { currentStageIds: ids });
    }

    const stage = await this.persistence.getStage(runId, stageId);
    if (stage) {
      this.timeouts.startTimer(runId, stageId, stage.timeout, (r, s) => {
        this.handleTimeout(r, s).catch(console.error);
      });
    }
  }

  async completeStage(runId: RunId, stageId: StageId, resultSummary: string): Promise<void> {
    this.timeouts.cancelTimer(runId, stageId);

    await this.persistence.updateStage(runId, stageId, {
      status: 'completed',
      finishedAt: new Date().toISOString(),
      resultSummary,
    });

    const run = await this.persistence.getRun(runId);
    if (run) {
      await this.persistence.updateRun(runId, {
        currentStageIds: run.currentStageIds.filter((id) => id !== stageId),
      });
    }

    await this.checkRunCompletion(runId);
  }

  async failStage(runId: RunId, stageId: StageId, error: string): Promise<void> {
    const now = new Date().toISOString();
    this.timeouts.cancelTimer(runId, stageId);

    await this.persistence.updateStage(runId, stageId, {
      status: 'failed',
      finishedAt: now,
      error,
    });

    await this.persistence.updateRun(runId, {
      status: 'failed',
      finishedAt: now,
      error: `Stage ${stageId} failed: ${error}`,
    });

    this.timeouts.cancelAllForRun(runId);
  }

  async cancelRun(runId: RunId, reason: string): Promise<void> {
    const now = new Date().toISOString();
    const snapshot = await this.getSnapshot(runId);

    this.timeouts.cancelAllForRun(runId);

    for (const stage of snapshot.stages) {
      if (['pending', 'running', 'waiting_for_deps'].includes(stage.status)) {
        await this.persistence.updateStage(runId, stage.stageId, {
          status: 'cancelled',
          finishedAt: now,
          error: reason,
        });
      }
    }

    await this.persistence.updateRun(runId, {
      status: 'cancelled',
      finishedAt: now,
      currentStageIds: [],
      error: reason,
    });
  }

  async resumeRun(runId: RunId): Promise<RunSnapshot> {
    const snapshot = await this.getSnapshot(runId);

    if (snapshot.run.status !== 'running' && snapshot.run.status !== 'pending') {
      throw new Error(`Cannot resume run in ${snapshot.run.status} state`);
    }

    for (const stage of snapshot.stages) {
      if (stage.status === 'running' && stage.startedAt) {
        const elapsed = Date.now() - new Date(stage.startedAt).getTime();
        const total = TimeoutManager.parseDuration(stage.timeout);
        const remaining = total - elapsed;

        if (remaining <= 0) {
          await this.handleTimeout(runId, stage.stageId);
        } else {
          const remainingSec = Math.ceil(remaining / 1000);
          this.timeouts.startTimer(runId, stage.stageId, `${remainingSec}s`, (r, s) => {
            this.handleTimeout(r, s).catch(console.error);
          });
        }
      }
    }

    return snapshot;
  }

  private async handleTimeout(runId: RunId, stageId: StageId): Promise<void> {
    const stage = await this.persistence.getStage(runId, stageId);
    if (!stage || stage.status !== 'running') return;

    const now = new Date().toISOString();

    switch (stage.onTimeout) {
      case 'fail':
        await this.persistence.updateStage(runId, stageId, {
          status: 'timed_out',
          finishedAt: now,
          error: `Stage timed out after ${stage.timeout}`,
        });
        await this.persistence.updateRun(runId, {
          status: 'timed_out',
          finishedAt: now,
          error: `Stage ${stageId} timed out`,
        });
        this.timeouts.cancelAllForRun(runId);
        break;

      case 'cancel':
        await this.persistence.updateStage(runId, stageId, {
          status: 'cancelled',
          finishedAt: now,
          error: `Cancelled due to timeout after ${stage.timeout}`,
        });
        break;

      case 'continue':
        await this.persistence.updateStage(runId, stageId, {
          status: 'completed',
          finishedAt: now,
          resultSummary: `[TIMEOUT] Stage continued after ${stage.timeout} timeout`,
        });
        await this.checkRunCompletion(runId);
        break;
    }
  }

  private async checkRunCompletion(runId: RunId): Promise<void> {
    const stages = await this.persistence.getStagesForRun(runId);
    const terminal = ['completed', 'failed', 'cancelled', 'timed_out'];
    const allTerminal = stages.every((s) => terminal.includes(s.status));

    if (allTerminal) {
      const allCompleted = stages.every((s) => s.status === 'completed');
      await this.persistence.updateRun(runId, {
        status: allCompleted ? 'completed' : 'failed',
        finishedAt: new Date().toISOString(),
        currentStageIds: [],
      });
    }
  }

  dispose(): void {
    this.timeouts.dispose();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-engine/run-controller.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow-engine/run-controller.ts tests/workflow-engine/run-controller.test.ts
git commit -m "feat(workflow): add run controller with DAG scheduling, timeouts, cancel, resume"
```

---

### Task 5: Implement the hardcoded parallel brainstorm workflow

**Files:**
- Create: `src/workflow-engine/hardcoded-brainstorm.ts`
- Create: `tests/workflow-engine/hardcoded-brainstorm.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workflow-engine/hardcoded-brainstorm.test.ts

import { describe, it, expect } from 'vitest';
import { getParallelBrainstormWorkflow } from '../../src/workflow-engine/hardcoded-brainstorm.js';

describe('hardcoded parallel brainstorm workflow', () => {
  it('returns a valid WorkflowDefinition', () => {
    const workflow = getParallelBrainstormWorkflow('Build a trial comparison feature');
    expect(workflow.name).toBe('parallel-brainstorm');
    expect(workflow.stages.length).toBe(3);
  });

  it('has two parallel brainstorm stages with no dependencies', () => {
    const workflow = getParallelBrainstormWorkflow('Test feature');
    const brainstorms = workflow.stages.filter((s) => s.id.startsWith('brainstorm-'));
    expect(brainstorms.length).toBe(2);
    expect(brainstorms[0].needs).toEqual([]);
    expect(brainstorms[1].needs).toEqual([]);
  });

  it('has a synthesize stage depending on both brainstorms', () => {
    const workflow = getParallelBrainstormWorkflow('Test feature');
    const synth = workflow.stages.find((s) => s.id === 'synthesize');
    expect(synth).toBeDefined();
    expect(synth!.needs.sort()).toEqual(['brainstorm-analytical', 'brainstorm-creative']);
  });

  it('includes the task description in all prompts', () => {
    const desc = 'Build a trial comparison feature';
    const workflow = getParallelBrainstormWorkflow(desc);
    for (const stage of workflow.stages) {
      expect(stage.prompt).toContain(desc);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflow-engine/hardcoded-brainstorm.test.ts`
Expected: FAIL -- module not found.

- [ ] **Step 3: Implement the hardcoded workflow**

```typescript
// src/workflow-engine/hardcoded-brainstorm.ts

import type { WorkflowDefinition } from './types.js';

export function getParallelBrainstormWorkflow(taskDescription: string): WorkflowDefinition {
  return {
    name: 'parallel-brainstorm',
    description: `Parallel brainstorm for: ${taskDescription}`,
    stages: [
      {
        id: 'brainstorm-creative',
        needs: [],
        prompt: [
          'You are brainstorming a new feature or solution.',
          `Task: ${taskDescription}`,
          '',
          'Focus on creative, user-facing ideas. Think about:',
          '- What would delight the user?',
          '- What is the simplest version that still delivers value?',
          '- What adjacent problems does this solve?',
          '',
          'Output your top 5 ideas with one-paragraph trade-off analysis each.',
          'When done, send your output via #cm.',
        ].join('\n'),
        timeout: '15m',
        onTimeout: 'fail',
      },
      {
        id: 'brainstorm-analytical',
        needs: [],
        prompt: [
          'You are analyzing a feature or solution from a technical perspective.',
          `Task: ${taskDescription}`,
          '',
          'Focus on architecture and feasibility. Think about:',
          '- What existing code/patterns can this build on?',
          '- What are the technical constraints and risks?',
          '- What is the dependency chain for implementation?',
          '',
          'Output your top 5 architectural approaches with complexity estimates.',
          'When done, send your output via #cm.',
        ].join('\n'),
        timeout: '15m',
        onTimeout: 'fail',
      },
      {
        id: 'synthesize',
        needs: ['brainstorm-creative', 'brainstorm-analytical'],
        prompt: [
          'You are synthesizing two brainstorm outputs into a single coherent proposal.',
          `Task: ${taskDescription}`,
          '',
          'You will receive output from two parallel brainstorms:',
          '1. Creative brainstorm (user-facing ideas)',
          '2. Analytical brainstorm (technical approaches)',
          '',
          'Deduplicate overlapping ideas. Rank by: feasibility x user impact.',
          'Produce a single ranked list of 3-5 recommendations with:',
          '- One-line summary',
          '- Why it scored high on both creative and technical axes',
          '- Key risk',
          '- Rough effort estimate (S/M/L)',
          '',
          'When done, send your output via #cm.',
        ].join('\n'),
        timeout: '10m',
        onTimeout: 'cancel',
      },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/workflow-engine/hardcoded-brainstorm.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow-engine/hardcoded-brainstorm.ts tests/workflow-engine/hardcoded-brainstorm.test.ts
git commit -m "feat(workflow): add hardcoded parallel brainstorm workflow definition"
```

---

### Task 6: Add MCP tools for workflow operations

**Files:**
- Create: `src/tools/start-workflow.ts`
- Create: `src/tools/run-status.ts`
- Create: `src/tools/cancel-run.ts`
- Create: `src/tools/list-runs.ts`
- Modify: `src/index.ts` (register new tools)

- [ ] **Step 1: Read `src/index.ts` to understand tool registration pattern**

Read `src/index.ts` and one existing tool file (e.g. `src/tools/create-task.ts`) for the exact pattern: schema definition with Zod, handler function signature, registration call. Note the exact imports, the `config` and `beadsDir` variables, and how the MCP `server.tool()` call is structured.

- [ ] **Step 2: Write `start-workflow` tool**

```typescript
// src/tools/start-workflow.ts

import { z } from 'zod';
import type { RunController } from '../workflow-engine/run-controller.js';
import { getParallelBrainstormWorkflow } from '../workflow-engine/hardcoded-brainstorm.js';
import type { Config } from '../config.js';

export const startWorkflowSchema = z.object({
  workflow: z.enum(['parallel-brainstorm']).describe(
    'Which workflow to run. Currently only "parallel-brainstorm" is available.',
  ),
  description: z.string().describe('Description of the task or feature to brainstorm.'),
});

export async function handleStartWorkflow(
  args: z.infer<typeof startWorkflowSchema>,
  config: Config,
  controller: RunController,
) {
  let workflowDef;
  switch (args.workflow) {
    case 'parallel-brainstorm':
      workflowDef = getParallelBrainstormWorkflow(args.description);
      break;
    default:
      return { content: [{ type: 'text' as const, text: `Unknown workflow: ${args.workflow}` }] };
  }

  const snapshot = await controller.createRun(workflowDef, config.agentId);
  const readyStages = controller.getReadyStages(snapshot);
  const readyList = readyStages.map((s) => `  - ${s.stageId}`).join('\n');

  return {
    content: [{
      type: 'text' as const,
      text: [
        `Workflow "${args.workflow}" started.`,
        `Run ID: ${snapshot.run.runId}`,
        `Stages: ${snapshot.stages.length}`,
        `Ready to execute:`,
        readyList,
        '',
        'Use run_status to check progress. Assign ready stages to agents.',
      ].join('\n'),
    }],
  };
}
```

- [ ] **Step 3: Write `run-status` tool**

```typescript
// src/tools/run-status.ts

import { z } from 'zod';
import type { RunController } from '../workflow-engine/run-controller.js';

export const runStatusSchema = z.object({
  run_id: z.string().describe('The run ID to check status for.'),
});

export async function handleRunStatus(
  args: z.infer<typeof runStatusSchema>,
  controller: RunController,
) {
  const snapshot = await controller.getSnapshot(args.run_id);
  const readyStages = controller.getReadyStages(snapshot);

  const stageLines = snapshot.stages.map((s) => {
    const adapter = s.assignedAdapter ? ` (${s.assignedAdapter})` : '';
    const result = s.resultSummary ? ` -- ${s.resultSummary.slice(0, 80)}` : '';
    const error = s.error ? ` [ERROR: ${s.error}]` : '';
    return `  ${s.status.padEnd(18)} ${s.stageId}${adapter}${result}${error}`;
  });

  const readyList = readyStages.length > 0
    ? `\nReady stages: ${readyStages.map((s) => s.stageId).join(', ')}`
    : '';

  return {
    content: [{
      type: 'text' as const,
      text: [
        `Run: ${snapshot.run.runId}`,
        `Template: ${snapshot.run.templateName}`,
        `Status: ${snapshot.run.status}`,
        `Started: ${snapshot.run.startedAt}`,
        snapshot.run.finishedAt ? `Finished: ${snapshot.run.finishedAt}` : null,
        snapshot.run.error ? `Error: ${snapshot.run.error}` : null,
        '',
        'Stages:',
        ...stageLines,
        readyList,
      ].filter((line): line is string => line !== null).join('\n'),
    }],
  };
}
```

- [ ] **Step 4: Write `cancel-run` tool**

```typescript
// src/tools/cancel-run.ts

import { z } from 'zod';
import type { RunController } from '../workflow-engine/run-controller.js';

export const cancelRunSchema = z.object({
  run_id: z.string().describe('The run ID to cancel.'),
  reason: z.string().optional().describe('Reason for cancellation.'),
});

export async function handleCancelRun(
  args: z.infer<typeof cancelRunSchema>,
  controller: RunController,
) {
  const reason = args.reason || 'Cancelled by user';
  await controller.cancelRun(args.run_id, reason);

  return {
    content: [{ type: 'text' as const, text: `Run ${args.run_id} cancelled. Reason: ${reason}` }],
  };
}
```

- [ ] **Step 5: Write `list-runs` tool**

```typescript
// src/tools/list-runs.ts

import { z } from 'zod';
import type { WorkflowPersistence } from '../workflow-engine/persistence.js';

export const listRunsSchema = z.object({
  template_name: z.string().optional().describe('Filter by workflow template name.'),
  status: z.string().optional().describe('Filter by run status.'),
});

export async function handleListRuns(
  args: z.infer<typeof listRunsSchema>,
  persistence: WorkflowPersistence,
) {
  const runs = await persistence.listRuns({
    templateName: args.template_name,
    status: args.status,
  });

  if (runs.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No workflow runs found.' }] };
  }

  const lines = runs.map((r) => {
    const finished = r.finishedAt ? ` finished ${r.finishedAt}` : '';
    return `  ${r.status.padEnd(12)} ${r.runId}  ${r.templateName}  started ${r.startedAt}${finished}`;
  });

  return {
    content: [{ type: 'text' as const, text: [`Workflow runs (${runs.length}):`, '', ...lines].join('\n') }],
  };
}
```

- [ ] **Step 6: Register tools in `src/index.ts`**

Read `src/index.ts` first to find the exact insertion point and variable names. Then add:

1. Imports for the four new tool handlers and schemas
2. `RunController` and `WorkflowPersistence` imports
3. After Beads initialization: `const controller = new RunController(beadsDir);` and `const wfPersistence = new WorkflowPersistence(beadsDir);`
4. Four `server.tool()` registration calls following the existing pattern

Adapt variable names to match what `src/index.ts` actually uses (e.g. the beads directory variable name, the config variable name).

- [ ] **Step 7: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/tools/start-workflow.ts src/tools/run-status.ts src/tools/cancel-run.ts src/tools/list-runs.ts src/index.ts
git commit -m "feat(workflow): add MCP tools for start, status, cancel, and list workflow runs"
```

---

### Task 7: End-to-end integration test

**Files:**
- Create: `tests/workflow-engine/integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/workflow-engine/integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { RunController } from '../../src/workflow-engine/run-controller.js';
import { WorkflowPersistence } from '../../src/workflow-engine/persistence.js';
import { getParallelBrainstormWorkflow } from '../../src/workflow-engine/hardcoded-brainstorm.js';

function hasBd(): boolean {
  try {
    execSync('bd --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRun = hasBd();

describe.skipIf(!canRun)('Workflow Engine E2E', () => {
  let tempDir: string;
  let controller: RunController;
  let persistence: WorkflowPersistence;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'am-e2e-test-'));
    execSync('bd init --server', { cwd: tempDir });
    controller = new RunController(tempDir);
    persistence = new WorkflowPersistence(tempDir);
  });

  afterAll(() => {
    controller.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs a full parallel brainstorm workflow end-to-end', async () => {
    const workflow = getParallelBrainstormWorkflow('Build a trial comparison feature');
    const snapshot = await controller.createRun(workflow, 'test-agent');

    // 1. Initial state
    expect(snapshot.run.status).toBe('pending');
    expect(snapshot.stages.length).toBe(3);

    const ready1 = controller.getReadyStages(snapshot);
    expect(ready1.map((s) => s.stageId).sort()).toEqual(['brainstorm-analytical', 'brainstorm-creative']);

    // 2. Start both parallel stages
    await controller.startStage(snapshot.run.runId, 'brainstorm-creative', 'cc-1');
    await controller.startStage(snapshot.run.runId, 'brainstorm-analytical', 'cc-2');

    const snap2 = await controller.getSnapshot(snapshot.run.runId);
    expect(snap2.run.status).toBe('running');

    // 3. Complete both
    await controller.completeStage(snapshot.run.runId, 'brainstorm-creative', 'Creative ideas');
    await controller.completeStage(snapshot.run.runId, 'brainstorm-analytical', 'Technical approaches');

    // 4. Synthesize ready
    const snap3 = await controller.getSnapshot(snapshot.run.runId);
    const ready3 = controller.getReadyStages(snap3);
    expect(ready3.map((s) => s.stageId)).toEqual(['synthesize']);

    // 5. Complete synthesize
    await controller.startStage(snapshot.run.runId, 'synthesize', 'cc-1');
    await controller.completeStage(snapshot.run.runId, 'synthesize', '3 ranked recommendations');

    // 6. Run completed
    const final = await controller.getSnapshot(snapshot.run.runId);
    expect(final.run.status).toBe('completed');
    expect(final.run.finishedAt).toBeTruthy();
    expect(final.stages.every((s) => s.status === 'completed')).toBe(true);

    // 7. Listed in runs
    const runs = await persistence.listRuns({ templateName: 'parallel-brainstorm' });
    expect(runs.some((r) => r.runId === snapshot.run.runId)).toBe(true);
  });

  it('handles stage failure -- fails the entire run', async () => {
    const workflow = getParallelBrainstormWorkflow('Failing test');
    const snapshot = await controller.createRun(workflow, 'test-agent');

    await controller.startStage(snapshot.run.runId, 'brainstorm-creative', 'cc-1');
    await controller.failStage(snapshot.run.runId, 'brainstorm-creative', 'Agent disconnected');

    const final = await controller.getSnapshot(snapshot.run.runId);
    expect(final.run.status).toBe('failed');
    expect(final.run.error).toContain('brainstorm-creative');
  });

  it('resumes run after simulated restart', async () => {
    const workflow = getParallelBrainstormWorkflow('Resume test');
    const snapshot = await controller.createRun(workflow, 'test-agent');

    await controller.startStage(snapshot.run.runId, 'brainstorm-creative', 'cc-1');
    await controller.completeStage(snapshot.run.runId, 'brainstorm-creative', 'Done');

    const controller2 = new RunController(tempDir);
    (controller2 as any).definitions.set(snapshot.run.runId, workflow);

    const resumed = await controller2.resumeRun(snapshot.run.runId);
    expect(resumed.run.status).toBe('running');

    const ready = controller2.getReadyStages(resumed);
    expect(ready.map((s) => s.stageId)).toContain('brainstorm-analytical');

    controller2.dispose();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/workflow-engine/integration.test.ts`
Expected: All PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing + new).

- [ ] **Step 4: Commit**

```bash
git add tests/workflow-engine/integration.test.ts
git commit -m "test(workflow): add end-to-end integration test for parallel brainstorm workflow"
```

---

### Task 8: Update exports and package metadata

**Files:**
- Modify: `src/workflow-engine/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Update barrel export**

```typescript
// src/workflow-engine/index.ts

export * from './types.js';
export { WorkflowPersistence } from './persistence.js';
export { RunController } from './run-controller.js';
export { TimeoutManager } from './timeout-manager.js';
export { getParallelBrainstormWorkflow } from './hardcoded-brainstorm.js';
```

- [ ] **Step 2: Bump version in `package.json`**

Change version from `0.2.0` to `0.3.0`.

- [ ] **Step 3: Run full build and tests**

Run: `npm run build && npx vitest run`
Expected: Build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/workflow-engine/index.ts package.json
git commit -m "chore: update exports and bump version to 0.3.0 for workflow engine"
```

---

## Phase 2: Adapter SDK + Reference Adapters (Task Outlines)

> **Note:** Phase 2 gets its own detailed plan when Phase 1 ships. These outlines show scope and dependencies.

### Task 9: Define AgentAdapter interface and types
Create `src/adapters/types.ts` with the full interface from the spec: `AgentAdapter`, `RunRequest`, `RunHandle`, `RunSnapshot`, `RunEvent`, `Artifact`, `Capability`. Define `ManagedAdapter` and `InteractiveAdapter` as narrowed subtypes with `controlPlane` discriminant.

### Task 10: Abstract base classes
Create `src/adapters/base-managed.ts` and `src/adapters/base-interactive.ts`. Managed base provides default `streamRun` (wraps `pollRun` in interval), lifecycle bookkeeping. Interactive base returns no-ops for `resumeRun`, `streamRun`, `cancelRun`.

### Task 11: Claude Code managed adapter
Create `src/adapters/claude-code.ts`. Wraps existing MCP connection. `startRun` sends prompt via messaging. `pollRun` checks for replies. `health` checks presence.

### Task 12: Codex CLI managed adapter
Create `src/adapters/codex.ts`. Wraps `codex` CLI binary. `startRun` spawns `codex --background`. `pollRun` runs `codex status`. `cancelRun` runs `codex cancel`.

### Task 13: Cursor interactive adapter
Create `src/adapters/cursor.ts`. Wraps existing Cursor MCP connection. `startRun` sends task prompt. `pollRun` checks inbox for reply. No cancel/resume/model-override.

### Task 14: Adapter registry
Create `src/adapters/registry.ts`. Register/unregister/lookup adapters by ID or kind. Health check all connected adapters.

### Task 15: Contract tests
Create `tests/adapters/contract.test.ts`. Shared test suite every adapter must pass. Run against all three implementations.

### Task 16: Refactor RunController to use adapters
Modify `run-controller.ts` to accept an `AdapterRegistry`. When a stage becomes ready, auto-dispatch to the assigned adapter via `startRun()`, begin polling, collect artifacts on completion.

---

## Phase 3: YAML DAG Templates + Gates (Task Outlines)

> **Note:** Phase 3 gets its own detailed plan when Phase 2 ships.

### Task 17: Add `yaml` dependency
Add `yaml` to `package.json`.

### Task 18: Zod schema for templates
Create `src/workflow-engine/template-schema.ts`. Full Zod validation of the YAML template format from the spec.

### Task 19: Template parser with DAG validation
Create `src/workflow-engine/template-parser.ts`. Load YAML, validate, topological sort for cycle detection. Error messages pinpoint the offending stage.

### Task 20: Prompt template interpolation
Create `src/workflow-engine/prompt-template.ts`. Load YAML prompt templates, interpolate variables (`{{task_description}}`, etc.).

### Task 21: Gate evaluator
Create `src/workflow-engine/gate-evaluator.ts`. Quorum logic (all/any/majority). On-fail actions (revise with bounded loops, abort, continue). Feedback aggregation.

### Task 22: DAG executor
Create `src/workflow-engine/dag-executor.ts`. Replaces manual stage advancement. Ready queue from DAG. Fan-out/fan-in. Gate evaluation before advancement.

### Task 23: Artifact collector
Create `src/workflow-engine/artifact-collector.ts`. Store outputs with path + checksum. Wire into `inputs` resolution.

### Task 24: Example templates
Create `templates/parallel-brainstorm.yaml`, `templates/review-only.yaml`, and associated prompt templates.

### Task 25: Extend start_workflow for YAML templates
Modify `src/tools/start-workflow.ts` to accept `template_path` argument.

---

## Phase 4: Capability Registry + Routing (Task Outlines)

> **Note:** Phase 4 gets its own detailed plan when Phase 3 ships.

### Task 26: Capability types and defaults
Create `src/capabilities/defaults.ts` with profiles from the spec. Create `src/capabilities/registry.ts`.

### Task 27: Capability-based router
Create `src/capabilities/router.ts`. Match `requires` to capabilities. Rank by confidence. Respect control plane and concurrency.

### Task 28: Integrate into DAG executor
Modify `dag-executor.ts`. Stages with `requires` use router instead of explicit adapter assignment.

### Task 29: Lease-based concurrency
Track concurrent runs per adapter. Respect `maxConcurrency` from `health()`.

---

## Phase 5: Packaging + Trialight Integration (Task Outlines)

> **Note:** Phase 5 gets its own detailed plan when Phase 4 ships.

### Task 30: npm package preparation
Update `package.json` with `exports`, `files`, `publishConfig`. Test with `npm pack`.

### Task 31: Trialight workflow templates
Create `.workflows/*.yaml` and `.prompt-templates/*.yaml` in Trialight workspace.

### Task 32: Superpowers orchestrate skill
Create `.claude/skills/orchestrate/SKILL.md` mapping `/orchestrate` to agent-messenger MCP tools.

### Task 33: Slack notification hooks
Add optional Slack MCP calls for workflow events in the Trialight integration layer.

---

## Phase 1 Verification Checklist

Before declaring Phase 1 complete:

- [ ] All tests pass: `npx vitest run`
- [ ] Build succeeds: `npm run build`
- [ ] TypeScript strict mode: no `any` casts, no `@ts-ignore`
- [ ] All new files have corresponding test files
- [ ] MCP tools work when tested via Claude Code or Cursor connecting to the server
- [ ] Workflow survives a simulated restart (kill server, reconnect, resume run)
- [ ] README updated with workflow engine section
