import type { ActionLog, TestCase, TestStep, BugReport, NetworkError } from '../types.js';
import { BrowserDriver } from '../browser/driver.js';
import { askGeminiJSON, analyzeScreenshot } from '../llm/gemini.js';

// ── Token Budget Hint ────────────────────────────────────────────────────────
// Only call Gemini (vision) when a failure signal is detected:
//   • browser action throws
//   • console errors present
//   • network errors with status >= 400
// This cuts executor Gemini calls from ~50 to ~5 per session.

interface ExecutorResult {
  updatedTestCases: TestCase[];
  potentialBugs: PotentialBug[];
}

interface PotentialBug {
  testCaseId: string;
  failedStep: TestStep;
  consoleErrors: string[];
  networkErrors: NetworkError[];
  screenshotBase64: string;
  description: string;
}

/**
 * Agent 3: The Driver (Executor)
 * Runs test cases in the browser and detects anomalies.
 */
export async function runExecutor(
  testCases: TestCase[],
  driver: BrowserDriver,
  onLog: (log: Omit<ActionLog, 'timestamp'>) => void,
  onTestUpdate: (tc: TestCase) => void
): Promise<ExecutorResult> {
  const log = (type: ActionLog['type'], message: string) =>
    onLog({ agent: 'executor', type, message });

  log('thought', `Starting test execution: ${testCases.length} test cases`);

  const updatedTestCases: TestCase[] = [];
  const potentialBugs: PotentialBug[] = [];

  for (const testCase of testCases) {
    const tc: TestCase = { ...testCase, steps: [...testCase.steps], status: 'running' };
    onTestUpdate(tc);
    log('action', `Running: "${tc.title}" [${tc.category}]`);

    driver.clearErrors();
    const startTime = Date.now();

    let testPassed = true;
    let lastScreenshotB64 = '';

    for (let i = 0; i < tc.steps.length; i++) {
      const step = { ...tc.steps[i] };
      const stepStart = Date.now();

      try {
        await driver.executeAction(step.action);
        await driver.wait(500);

        // ── Heuristic failure signals (no Gemini call needed for passing steps) ──
        const hasConsoleErrors = driver.consoleErrors.length > 0;
        const hasNetworkErrors = driver.networkErrors.some((e) => e.status >= 400);

        if (hasConsoleErrors || hasNetworkErrors) {
          // Only screenshot + call Gemini when there is an actual failure signal
          lastScreenshotB64 = await driver.screenshot();
          step.screenshotPath = `data:image/png;base64,${lastScreenshotB64}`;

          const observation = await analyzeScreenshot(
            lastScreenshotB64,
            `QA Step Failure Assessment:
Step: "${step.description}"
Expected: "${step.expectedOutcome}"
Console errors: ${driver.consoleErrors.slice(0, 3).join(' | ') || 'None'}
Network errors: ${driver.networkErrors.filter(e => e.status >= 400).map(e => `${e.method} ${e.url} → ${e.status}`).slice(0, 3).join(' | ') || 'None'}

Answer in JSON: { "passed": bool, "actualOutcome": "one sentence", "anomalies": [] }`
          );

          let analysis: { passed: boolean; actualOutcome: string; anomalies: string[] };
          try {
            const cleaned = observation.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
            analysis = JSON.parse(cleaned);
          } catch {
            analysis = { passed: false, actualOutcome: 'Step failed (parse error)', anomalies: [] };
          }

          step.actualOutcome = analysis.actualOutcome;
          step.passed = analysis.passed;
          step.durationMs = Date.now() - stepStart;

          log('error', `  Step ${step.index}: [FAILED] ${analysis.actualOutcome}`);

          testPassed = false;
          potentialBugs.push({
            testCaseId: tc.id,
            failedStep: step,
            consoleErrors: [...driver.consoleErrors],
            networkErrors: [...driver.networkErrors],
            screenshotBase64: lastScreenshotB64,
            description: `${analysis.actualOutcome}. Anomalies: ${analysis.anomalies.join('; ')}`,
          });
          break;
        } else {
          // ── Happy path: no Gemini call, mark step as passed ──
          step.passed = true;
          step.actualOutcome = 'Step completed without errors';
          step.durationMs = Date.now() - stepStart;
          log('success', `  Step ${step.index}: [PASSED] ${step.description}`);
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        step.passed = false;
        step.actualOutcome = `Action failed: ${errorMsg}`;
        step.durationMs = Date.now() - stepStart;
        testPassed = false;

        log('error', `  Step ${step.index}: [ERROR] ${errorMsg}`);

        // Take screenshot only on catch (action threw)
        try { lastScreenshotB64 = await driver.screenshot(); } catch { /* ignore */ }

        if (lastScreenshotB64) {
          potentialBugs.push({
            testCaseId: tc.id,
            failedStep: step,
            consoleErrors: [...driver.consoleErrors],
            networkErrors: [...driver.networkErrors],
            screenshotBase64: lastScreenshotB64,
            description: `Action execution failed: ${errorMsg}`,
          });
        }
        break;
      }

      tc.steps[i] = step;
    }

    tc.status = testPassed ? 'passed' : 'failed';
    tc.durationMs = Date.now() - startTime;

    log(
      testPassed ? 'success' : 'error',
      `${testPassed ? '[PASSED]' : '[FAILED]'}: "${tc.title}" (${tc.durationMs}ms)`
    );

    updatedTestCases.push(tc);
    onTestUpdate(tc);
  }

  const passed = updatedTestCases.filter((t) => t.status === 'passed').length;
  const failed = updatedTestCases.filter((t) => t.status === 'failed').length;
  log('success', `Execution complete: ${passed} passed, ${failed} failed. ${potentialBugs.length} potential bugs detected.`);

  return { updatedTestCases, potentialBugs };
}

export type { PotentialBug };
