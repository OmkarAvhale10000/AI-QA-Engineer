// Shared type definitions for the entire AI QA Engineer platform

export interface AgentSession {
  id: string;
  targetUrl: string;
  appDescription: string;
  status: SessionStatus;
  startedAt: number;
  currentAgent: AgentName;
  stateGraph: StateNode[];
  testCases: TestCase[];
  executionLog: ActionLog[];
  bugs: BugReport[];
  generatedTests: GeneratedTest[];
}

export type SessionStatus =
  | 'idle'
  | 'exploring'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'synthesizing'
  | 'done'
  | 'error';

export type AgentName =
  | 'cartographer'
  | 'planner'
  | 'executor'
  | 'critic'
  | 'synthesizer';

// ─── State Graph ────────────────────────────────────────────────────────────

export interface StateNode {
  id: string;
  url: string;
  title: string;
  components: string[];
  edges: StateEdge[];
}

export interface StateEdge {
  action: string;
  targetStateId: string;
}

// ─── Test Planning ───────────────────────────────────────────────────────────

export interface TestCase {
  id: string;
  title: string;
  category: 'happy-path' | 'boundary' | 'edge' | 'error';
  priority: 'critical' | 'high' | 'medium' | 'low';
  steps: TestStep[];
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  bugId?: string;
}

export interface TestStep {
  index: number;
  description: string;
  action: BrowserAction;
  expectedOutcome: string;
  actualOutcome?: string;
  passed?: boolean;
  screenshotPath?: string;
  durationMs?: number;
}

// ─── Browser Actions ─────────────────────────────────────────────────────────

export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string; description: string }
  | { type: 'fill'; selector: string; value: string; description: string }
  | { type: 'select'; selector: string; value: string; description: string }
  | { type: 'press'; key: string; description: string }
  | { type: 'wait'; ms: number }
  | { type: 'assert'; selector: string; assertion: string; expected: string }
  | { type: 'screenshot'; label: string };

// ─── Execution Logging ───────────────────────────────────────────────────────

export interface ActionLog {
  timestamp: number;
  agent: AgentName;
  type: 'thought' | 'action' | 'observation' | 'error' | 'success';
  message: string;
  data?: Record<string, unknown>;
}

// ─── Bug Reports ─────────────────────────────────────────────────────────────

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface BugReport {
  id: string;
  title: string;
  severity: BugSeverity;
  category: string;
  testCaseId: string;
  reproducible: boolean;
  reproductionSteps: ReproductionStep[];
  expectedBehavior: string;
  actualBehavior: string;
  screenshotPath?: string;
  annotatedScreenshotPath?: string;
  consoleErrors: string[];
  networkErrors: NetworkError[];
  environment: BugEnvironment;
  discoveredAt: number;
  verifiedAt?: number;
}

export interface ReproductionStep {
  index: number;
  description: string;
  selector?: string;
  value?: string;
}

export interface NetworkError {
  url: string;
  method: string;
  status: number;
  statusText: string;
}

export interface BugEnvironment {
  browser: string;
  viewport: { width: number; height: number };
  targetUrl: string;
}

// ─── Generated Tests ─────────────────────────────────────────────────────────

export interface GeneratedTest {
  id: string;
  filename: string;
  testCaseId: string;
  title: string;
  code: string;
  status: 'generated' | 'running' | 'passed' | 'failed';
  lastRunAt?: number;
}

// ─── WebSocket Messages ───────────────────────────────────────────────────────

export type WsMessage =
  | { type: 'session_update'; session: Partial<AgentSession> }
  | { type: 'log'; log: ActionLog }
  | { type: 'test_update'; testCase: TestCase }
  | { type: 'bug_found'; bug: BugReport }
  | { type: 'test_generated'; test: GeneratedTest }
  | { type: 'screenshot'; label: string; dataUrl: string }
  | { type: 'error'; message: string };
