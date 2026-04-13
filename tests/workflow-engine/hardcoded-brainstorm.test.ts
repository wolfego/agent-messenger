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
