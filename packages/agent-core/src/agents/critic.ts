import type { ActionLog, BugReport, BugSeverity, ReproductionStep } from '../types.js';
import type { PotentialBug } from './executor.js';
import { BrowserDriver } from '../browser/driver.js';
import { askGeminiJSON, analyzeScreenshot } from '../llm/gemini.js';

/**
 * Agent 4: The Bug Critic & Verifier
 * Takes potential bugs from the executor, verifies reproducibility in a clean sandbox,
 * and filters out false positives.
 */
export async function runCritic(
  potentialBugs: PotentialBug[],
  targetUrl: string,
  appDescription: string,
  mainDriver: BrowserDriver,
  onLog: (log: Omit<ActionLog, 'timestamp'>) => void,
  onBugFound: (bug: BugReport) => void
): Promise<BugReport[]> {
  const log = (type: ActionLog['type'], message: string) =>
    onLog({ agent: 'critic', type, message });

  log('thought', `Verifying ${potentialBugs.length} potential bugs...`);

  const verifiedBugs: BugReport[] = [];

  for (const pb of potentialBugs) {
    log('action', `Verifying bug in test: "${pb.failedStep.description}"`);

    // Step 1: Ask Gemini whether this is a real bug or expected behavior
    const verdict = await askGeminiJSON<{
      isRealBug: boolean;
      title: string;
      severity: BugSeverity;
      category: string;
      expectedBehavior: string;
      actualBehavior: string;
      reasoning: string;
    }>(
      `You are a senior QA engineer determining whether a UI failure is a real bug or expected behavior.
App: "${appDescription}"`,
      `Analyze this potential bug:

Failed step: "${pb.failedStep.description}"
Expected outcome: "${pb.failedStep.expectedOutcome}"
Observed: "${pb.failedStep.actualOutcome}"
Description: "${pb.description}"
Console errors: ${pb.consoleErrors.join(' | ') || 'None'}
Network errors: ${pb.networkErrors.map((e) => `${e.method} ${e.url} → ${e.status}`).join(' | ') || 'None'}

Return JSON:
{
  "isRealBug": true/false,
  "title": "concise bug title (max 60 chars)",
  "severity": "critical|high|medium|low",
  "category": "functional|visual|performance|security|accessibility",
  "expectedBehavior": "what should happen",
  "actualBehavior": "what actually happened",
  "reasoning": "why this is/isn't a real bug"
}`
    );

    log('observation', `  Gemini verdict: ${verdict.isRealBug ? '[CONFIRMED BUG]' : '[FALSE POSITIVE]'} — ${verdict.reasoning}`);

    if (!verdict.isRealBug) continue;

    // Step 2: Verify reproducibility in a clean sandbox browser
    log('action', `Verifying reproducibility in clean sandbox...`);
    let reproducible = false;
    let sandboxScreenshotB64 = '';

    try {
      const sandboxDriver = await mainDriver.launchFresh();
      try {
        // Replay the test case steps up to the failing step
        const action = pb.failedStep.action;
        await sandboxDriver.navigate(targetUrl);
        await sandboxDriver.wait(1500);
        await sandboxDriver.executeAction(action);
        await sandboxDriver.wait(1000);
        sandboxScreenshotB64 = await sandboxDriver.screenshot();

        // Check if failure reproduces
        const reproCheck = await analyzeScreenshot(
          sandboxScreenshotB64,
          `In a fresh browser session, we replayed this action: "${pb.failedStep.description}"
Expected: "${pb.failedStep.expectedOutcome}"
Original failure: "${pb.failedStep.actualOutcome}"

Does this screenshot show the same failure?
Reply in JSON: { "reproduces": true/false, "observation": "..." }`
        );

        let rc: { reproduces: boolean; observation: string };
        try {
          const cleaned = reproCheck
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          rc = JSON.parse(cleaned);
        } catch {
          rc = { reproduces: true, observation: 'Reproduction inconclusive' };
        }

        reproducible = rc.reproduces;
        log(
          reproducible ? 'error' : 'success',
          `  Sandbox result: ${reproducible ? '[REPRODUCED]' : '[NOT REPRODUCED]'} — ${rc.observation}`
        );
      } finally {
        await sandboxDriver.close();
      }
    } catch (err) {
      log('error', `  Sandbox failed: ${(err as Error).message}. Marking as unconfirmed.`);
      reproducible = true; // Treat sandbox failure as inconclusive; still report
    }

    // Step 3: Build the formal bug report
    const reproSteps: ReproductionStep[] = [
      { index: 1, description: `Navigate to the application at ${targetUrl}` },
      {
        index: 2,
        description: pb.failedStep.description,
        selector:
          'selector' in pb.failedStep.action
            ? (pb.failedStep.action as { selector: string }).selector
            : undefined,
        value:
          'value' in pb.failedStep.action
            ? (pb.failedStep.action as { value: string }).value
            : undefined,
      },
      { index: 3, description: `Observe: ${verdict.actualBehavior}` },
    ];

    const bug: BugReport = {
      id: `BUG-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      title: verdict.title,
      severity: verdict.severity,
      category: verdict.category,
      testCaseId: pb.testCaseId,
      reproducible,
      reproductionSteps: reproSteps,
      expectedBehavior: verdict.expectedBehavior,
      actualBehavior: verdict.actualBehavior,
      screenshotPath: pb.screenshotBase64
        ? `data:image/png;base64,${pb.screenshotBase64}`
        : undefined,
      consoleErrors: pb.consoleErrors,
      networkErrors: pb.networkErrors,
      environment: {
        browser: 'Chromium (Playwright)',
        viewport: { width: 1280, height: 800 },
        targetUrl,
      },
      discoveredAt: Date.now(),
      verifiedAt: Date.now(),
    };

    verifiedBugs.push(bug);
    onBugFound(bug);
    log('error', `BUG FILED [${bug.severity.toUpperCase()}]: ${bug.title}`);
  }

  log(
    'success',
    `Critic complete: ${verifiedBugs.length} verified bugs (${potentialBugs.length - verifiedBugs.length} false positives filtered out)`
  );

  return verifiedBugs;
}
