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
