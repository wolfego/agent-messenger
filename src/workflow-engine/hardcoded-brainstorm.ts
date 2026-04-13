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
