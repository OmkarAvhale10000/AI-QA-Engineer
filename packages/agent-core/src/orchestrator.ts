import type {
  AgentSession,
  ActionLog,
  TestCase,
  BugReport,
  GeneratedTest,
  WsMessage,
} from './types.js';
import { BrowserDriver } from './browser/driver.js';
import { runExplorer } from './agents/explorer.js';
import { runPlanner } from './agents/planner.js';
import { runExecutor } from './agents/executor.js';
import { runCritic } from './agents/critic.js';
import { runSynthesizer } from './agents/synthesizer.js';

export class QAOrchestrator {
  private session: AgentSession;
  private driver: BrowserDriver | null = null;
  private broadcast: (msg: WsMessage) => void;

  constructor(
    sessionId: string,
    targetUrl: string,
    appDescription: string,
    broadcast: (msg: WsMessage) => void
  ) {
    this.broadcast = broadcast;
    this.session = {
      id: sessionId,
      targetUrl,
      appDescription,
      status: 'idle',
      startedAt: Date.now(),
      currentAgent: 'cartographer',
      stateGraph: [],
      testCases: [],
      executionLog: [],
      bugs: [],
      generatedTests: [],
    };
  }

  private log(log: Omit<ActionLog, 'timestamp'>) {
    const fullLog: ActionLog = { ...log, timestamp: Date.now() };
    this.session.executionLog.push(fullLog);
    this.broadcast({ type: 'log', log: fullLog });
  }

  private updateSession(patch: Partial<AgentSession>) {
    Object.assign(this.session, patch);
    this.broadcast({ type: 'session_update', session: { ...this.session } });
  }

  getSession(): AgentSession {
    return this.session;
  }

  async run(): Promise<AgentSession> {
    try {
      // ── Phase 1: Launch Browser ──────────────────────────────────────────
      this.updateSession({ status: 'exploring', currentAgent: 'cartographer' });
      this.driver = new BrowserDriver((log) => this.log(log));
      await this.driver.launch(true); // headless

      // ── Phase 2: Explorer Agent ──────────────────────────────────────────
      const explorerResult = await runExplorer(
        this.session.targetUrl,
        this.session.appDescription,
        this.driver,
        (log) => this.log(log)
      );
      this.updateSession({ stateGraph: explorerResult.stateGraph });

      // ── Phase 3: Planner Agent ───────────────────────────────────────────
      this.updateSession({ status: 'planning', currentAgent: 'planner' });
      const testCases = await runPlanner(
        this.session.targetUrl,
        this.session.appDescription,
        this.session.stateGraph,
        (log) => this.log(log)
      );
      this.updateSession({ testCases });
      for (const tc of testCases) {
        this.broadcast({ type: 'test_update', testCase: tc });
      }

      // ── Phase 4: Executor Agent ──────────────────────────────────────────
      this.updateSession({ status: 'executing', currentAgent: 'executor' });
      const { updatedTestCases, potentialBugs } = await runExecutor(
        testCases,
        this.driver,
        (log) => this.log(log),
        (tc: TestCase) => {
          this.broadcast({ type: 'test_update', testCase: tc });
        }
      );
      this.updateSession({ testCases: updatedTestCases });

      // ── Phase 5: Bug Critic & Verifier ───────────────────────────────────
      this.updateSession({ status: 'verifying', currentAgent: 'critic' });
      const verifiedBugs = await runCritic(
        potentialBugs,
        this.session.targetUrl,
        this.session.appDescription,
        this.driver,
        (log) => this.log(log),
        (bug: BugReport) => {
          this.session.bugs.push(bug);
          this.broadcast({ type: 'bug_found', bug });
        }
      );
      this.updateSession({ bugs: verifiedBugs });

      // ── Phase 6: Test Synthesizer ─────────────────────────────────────────
      this.updateSession({ status: 'synthesizing', currentAgent: 'synthesizer' });
      const generatedTests = await runSynthesizer(
        updatedTestCases,
        this.session.targetUrl,
        (log) => this.log(log),
        (test: GeneratedTest) => {
          this.session.generatedTests.push(test);
          this.broadcast({ type: 'test_generated', test });
        }
      );
      this.updateSession({ generatedTests, status: 'done' });

      return this.session;
    } catch (err) {
      const message = (err as Error).message;
      this.log({ agent: this.session.currentAgent, type: 'error', message: `Fatal: ${message}` });
      this.updateSession({ status: 'error' });
      this.broadcast({ type: 'error', message });
      throw err;
    } finally {
      await this.driver?.close();
    }
  }

  async stop() {
    await this.driver?.close();
    this.updateSession({ status: 'idle' });
  }
}
