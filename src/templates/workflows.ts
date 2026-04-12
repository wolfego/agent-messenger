/**
 * Workflow document templates — scaffolded into projects on first use
 * via the scaffold_workflow MCP tool.
 *
 * These are starting points. Projects evolve them through use;
 * the closeout phase of each workflow prompts the user to update
 * the doc with lessons learned.
 */

export const WORKFLOW_TEMPLATES: Record<string, { filename: string; content: string }> = {
  orchestrate: {
    filename: "orchestrate.md",
    content: `# Orchestrator–Implementer Workflow

**Status:** Living document — refined after each orchestrated session

## Purpose

A two-agent workflow layered on top of the superpowers skill system. The orchestrator (Cursor) owns quality, design, and coordination. The implementer (Claude Code) owns execution. The user guides direction and approves transitions.

The goal is **right first time** — thorough upfront design and review so implementation succeeds on the first pass, not through trial-and-error debugging.

---

## Setting Up

At the start of a session:

1. Set identity: orchestrator → \`orch\`, implementer → \`cc-impl\` (or task-specific names)
2. Confirm the implementer is online (\`list_agents\`)
3. Both agents read this doc before proceeding

### Setup Prompt (template for orchestrator)

\`\`\`
You are the orchestrator. The CC agent is the implementer. Follow the process
in docs/guidance/workflows/orchestrate.md:

1. Brainstorm — explore design with the user
2. Spec — draft the spec (the "what and why")
3. Spec review — self-review, then CC second pass, then edge-case deep dive
4. Plan — CC writes the implementation plan (the "how")
5. Plan review — trace logic against real data, check platform compat
6. Implement — CC executes, reports at checkpoints
7. Verify — confirm behavior matches spec
8. Closeout — commit, push, PR, update this workflow doc

Key: separate "what" from "how". Be thorough on reviews. Right first time.
\`\`\`

---

## Roles

**Orchestrator (Cursor)**
- Drives the workflow end-to-end
- Brainstorms and explores design with the user
- Writes specs (the "what and why")
- Reviews specs (first pass — self-review for edge cases)
- Reviews implementation plans (thoroughness scales with stakes)
- Coordinates handoffs with the implementer via agent-messenger
- Produces deliverables beyond code (guidance docs, workflow docs)

**Implementer (Claude Code)**
- Reviews specs (second pass — fresh eyes, catches what orchestrator missed)
- Writes implementation plans (the "how" — they decide architecture and tooling)
- Executes implementation plans on a feature branch
- Reports status, blockers, and results at checkpoints
- Flags ambiguity or undocumented assumptions back to orchestrator

**User**
- Guides overall direction, approves key transitions
- Provides domain context and makes judgment calls on trade-offs
- Controls pacing (e.g., "stand by until I say to check")

---

## Workflow Stages

### 1. Brainstorm

- User describes the task
- Orchestrator separates "what" (requirements) from "how" (implementation)
- Orchestrator explores intent, edge cases, and key decisions with the user
- Decisions are captured as they happen, not deferred
- Uses \`superpowers:brainstorming\` skill

### 2. Spec

- Orchestrator drafts a design spec based on the brainstorm
- Spec covers: goals, non-goals, approach, rules, edge cases, deliverables, success criteria
- Spec is the **authoritative source of truth** — when plan and spec conflict, spec wins
- Saved to \`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md\`

### 3. Spec Review (three-pass)

**Pass 1 (orchestrator self-review):**
- Re-read end-to-end for gaps, contradictions, missing edge cases
- Check: are all input variations covered? Are skip/filter rules exhaustive?
- Check: could any rule cause a silent failure?

**Pass 2 (implementer review):**
- Send spec to implementer for independent review
- Implementer flags issues, missing cases, or assumptions that don't hold
- Orchestrator incorporates feedback

**Pass 3 (edge-case deep dive):**
- Orchestrator enumerates every unique variation in the input data
- Adds explicit "Edge Cases Reference" section to the spec
- Goal: implementer encounters zero surprises

### 4. Implementation Plan

- Implementer writes the plan — they decide the "how"
- Plan covers: ordered steps, file-level changes, code snippets, dependencies
- Must account for execution environment (platform, OS, available tools)
- Uses \`superpowers:writing-plans\` approach

### 5. Plan Review

**Standard review (always):**
- Steps are complete and in the right order
- No drift from the spec
- Instructions are unambiguous

**Thorough review (high-stakes tasks):**
- Trace every hardcoded value back to the source
- Walk through logic with real data samples
- Check platform compatibility (shell syntax, line endings, available commands)
- Verify references use the right granularity (actual IDs, not group names)
- Check boundary conditions and silent failure modes
- Consider: what happens if it fails mid-way? Can it re-run safely?
- Verify tool features actually exist before the plan depends on them

### 6. Implement

- Implementer executes the plan on a feature branch
- Reports at checkpoints (per-chunk or per-milestone)
- For data-mutating work: require dry-run before live run
- Uses \`superpowers:executing-plans\` or \`superpowers:subagent-driven-development\`

### 7. Verify

- Run quality gates (lint, typecheck, test, build)
- For data operations: verify counts, spot-check records
- Both agents confirm behavior matches spec
- Uses \`superpowers:verification-before-completion\`

### 8. Closeout

- Update task tracking (beads)
- Finalize all deliverable docs
- Commit, push, PR, merge (with user approval)
- **Update this workflow document** with anything learned (see rules below)

---

## Writing the Task Prompt

### Include (the "what")
- Objective — what should be true when done
- Scope boundaries — what's in, what's out
- Domain rules agents won't know
- Constraints — hard rules
- Deliverables — everything expected
- Known edge cases
- Success criteria

### Leave out (the "how")
- Exact CLI syntax — risks embedding wrong flags
- Brittle position-based rules (line numbers)
- Specific architecture decisions
- OS-specific verification commands

### Mention explicitly
- Platform (Windows/PowerShell, macOS, Linux)
- One-time vs. recurring
- Interaction model ("approve before live" vs "run and report")

---

## Communication Patterns

- All orchestrator/implementer coordination uses agent-messenger MCP
- Messages include: clear \`subject\`, \`action\` field, \`context_files\` when relevant
- Set identity early so messages are readable
- Respect user pacing — don't poll when told to stand by
- Use wait time productively (update docs, prepare review checklists)
- If implementer hits a blocker, orchestrator investigates rather than waiting

---

## Principles

### Right First Time
Invest heavily in spec review and plan review. Catching a bug in a plan document is far cheaper than debugging during execution.

### Separate "What" from "How"
The spec defines requirements; the plan defines implementation. Over-prescribing the "how" leads to brittle plans built around assumptions that may not hold.

### Trace, Don't Skim
Standard review reads for intent. Thorough review traces execution — pick a real data sample, walk through line by line, track variable values, check boundaries.

### Anticipate Failure Modes
For data-mutating operations: what happens if it fails mid-way? Can it re-run? Will re-running create duplicates? Is there a rollback path?

### Verify Tool Capabilities Before Depending on Them
If the plan relies on a specific CLI flag or API feature, verify it exists. Run \`--help\`, check docs, test in dry-run.

### Platform Awareness from the Start
Shell syntax, available commands, file paths, and line endings vary by platform. Catch these in plan review, not during implementation.

---

## Closeout: Updating This Document

At session end, update this doc with lessons learned. Follow these rules:

- **Generalize** — extract the meta-principle, not the task-specific detail
  - Bad: "bd dep add doesn't support task-to-epic blocking"
  - Good: "Verify tool capabilities before depending on them — API limitations surface during execution, not during planning"
- Add to **Principles** if it's a new general principle
- Refine **Workflow Stages** if the process itself changed
- Update **Communication Patterns** if new coordination patterns emerged
- Do NOT add task-specific edge cases — those belong in the task's spec

---

## Conventions

- All work on a **feature branch** (never main/master)
- Communication via **agent-messenger** MCP
- User approves transitions between major stages
- Spec and plan saved in \`docs/superpowers/specs/\` and \`docs/superpowers/plans/\`
- This document is updated at closeout of each orchestrated session
`,
  },

  debug: {
    filename: "debug.md",
    content: `# Debug Workflow

**Status:** Living document — refined after each debug session

## Purpose

A two-agent debug workflow for systematic investigation. The orchestrator (Cursor) owns triage, hypothesis formation, and diagnosis. The implementer (Claude Code) owns investigation, reproduction, and fixing. The user provides symptoms and approves fix direction.

The goal is **systematic, not shotgun** — form a hypothesis before investigating, reproduce before fixing, verify root cause before closing.

---

## Diagnostic Resources

List your project's diagnostic tools and guidance here. Agents entering a debug session read this section first to understand what's available.

- **Diagnostic guides:** _(e.g., docs/guidance/DIAG_VISUAL_REPORTING.md)_
- **Architecture docs:** _(e.g., docs/architecture/pipeline.md)_
- **Diagnostic scripts:** _(e.g., npm run diag, bd list --type event)_
- **Known failure patterns:** _(document recurring issues and resolutions below)_
- **Monitoring dashboards:** _(e.g., Sentry project URL, Upstash console)_
- **Log locations:** _(e.g., Fly.io logs, Cloudflare Workers logs, browser console)_

---

## Roles

**Orchestrator (Cursor)**
- Gathers and organizes symptoms
- Reads diagnostic resources before forming hypotheses
- Forms ranked hypotheses about root cause
- Directs investigation — one hypothesis at a time
- Analyzes findings and narrows diagnosis
- Reviews fixes for correctness and regression risk

**Implementer (Claude Code)**
- Runs diagnostic tools and checks logs per orchestrator's direction
- Creates minimal reproductions (ideally failing tests)
- Implements fixes using TDD
- Runs quality gates and verifies no regressions
- Reports raw findings — does not guess at root cause

**User**
- Provides symptoms, error messages, reproduction steps
- Provides domain context (recent changes, deployment history)
- Approves fix direction before implementation
- Escalates or de-escalates investigation scope

---

## Workflow Stages

### 1. Triage

- Gather symptoms: error messages, stack traces, logs, user reports
- Read the **Diagnostic Resources** section above
- Classify severity: blocking? degraded? cosmetic?
- Identify: when did it start? What changed? Can it be reproduced on demand?
- Record the raw symptom data before analysis

### 2. Hypothesize

- Form 2-3 ranked hypotheses about root cause
- For each: what evidence would confirm or eliminate it?
- Rank by: likelihood, ease of investigation, blast radius
- Present to user for input before investigating

### 3. Investigate

- Orchestrator sends top hypothesis to implementer with specific investigation steps
- Implementer runs diagnostic tools, checks logs, traces code paths
- Implementer reports **raw findings** — observed behavior, not conclusions
- If hypothesis is eliminated, move to the next one
- If no hypothesis fits, return to triage with new information

### 4. Diagnose

- Orchestrator analyzes findings against hypotheses
- Narrow to a confirmed root cause
- If uncertain, design a targeted experiment to confirm
- Document the causal chain: trigger → mechanism → symptom

### 5. Fix

- Implementer writes a failing test that reproduces the bug
- Implement the fix — the test should now pass
- Check for related occurrences of the same pattern
- Use \`superpowers:test-driven-development\` approach

### 6. Verify

- Run full quality gates (lint, typecheck, test, build)
- Confirm the original symptom no longer occurs
- Verify no regressions in related areas
- If data was corrupted: verify data integrity after fix
- Uses \`superpowers:verification-before-completion\`

### 7. Closeout

- Update task tracking (beads)
- Commit fix on feature branch, push, PR
- **Update this workflow document**: add to Known Failure Patterns if the bug class is recurring
- Add diagnostic steps that worked to the Diagnostic Resources section

---

## Principles

### Systematic, Not Shotgun
One hypothesis at a time. Don't scatter changes hoping one fixes it.

### Hypothesis-Driven
Form a theory before investigating. "I think X because Y" not "let me look around."

### Reproduce Before Fixing
A failing test IS the diagnosis. If you can't reproduce it, you don't understand it.

### Verify Root Cause, Not Symptoms
Fixing the symptom leaves the bug. Trace to the actual cause.

### Escalate Early
If three hypotheses fail, step back and re-triage. Don't spend hours on a dead end.

### Record Everything
Log what you tried, what you found, what you eliminated. Future debuggers (including you) will need this.

---

## Communication Patterns

- Orchestrator sends investigation requests with \`action: investigate\` or \`action: reproduce\`
- Implementer replies with raw findings (logs, values, traces), not interpretations
- Orchestrator requests fix with \`action: fix\` only after root cause is confirmed
- Include \`context_files\` pointing to relevant source files, logs, or diagnostic output
- If blocked (e.g., need production access, need user to reproduce), report immediately

---

## Known Failure Patterns

_(Add recurring bug patterns here as they're discovered. Include: pattern name, symptoms, root cause, resolution.)_

---

## Closeout: Updating This Document

After each debug session, update this doc:

- Add to **Known Failure Patterns** if the bug class could recur
- Add useful diagnostic steps to **Diagnostic Resources**
- Refine **Workflow Stages** if the process could be improved
- **Generalize** — extract the pattern, not the specific bug details
`,
  },
};
