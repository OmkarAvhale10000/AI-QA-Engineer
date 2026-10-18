import type { ActionLog, StateNode, TestCase, TestStep, BrowserAction } from '../types.js';
import { askGeminiJSON } from '../llm/gemini.js';

/**
 * Agent 2: The Strategist (Planner)
 * Takes the site map and app description, generates structured test cases.
 */
export async function runPlanner(
  targetUrl: string,
  appDescription: string,
  stateGraph: StateNode[],
  onLog: (log: Omit<ActionLog, 'timestamp'>) => void
): Promise<TestCase[]> {
  const log = (type: ActionLog['type'], message: string) =>
    onLog({ agent: 'planner', type, message });

  log('thought', 'Analyzing app structure and generating test strategy...');

  const siteMap = stateGraph
    .map((s) => `- "${s.title}" (${s.url})\n  Components: ${s.components.join(', ')}`)
    .join('\n');

  interface RawTestCase {
    id: string;
    title: string;
    category: 'happy-path' | 'boundary' | 'edge' | 'error';
    priority: 'critical' | 'high' | 'medium' | 'low';
    steps: Array<{
      index: number;
      description: string;
      action: BrowserAction;
      expectedOutcome: string;
    }>;
  }

  const response = await askGeminiJSON<{ testCases: RawTestCase[] }>(
    `You are a senior QA engineer generating thorough test cases for a web application.
App: "${appDescription}"
Base URL: ${targetUrl}

IMPORTANT RULES:
- Generate exactly 8-10 test cases across all 4 categories
- Category "happy-path": 3 tests (main user journeys that should succeed)
- Category "boundary": 2 tests (edge inputs like empty fields, special characters, negative numbers)
- Category "edge": 2 tests (e.g. double click submit, browser back mid-flow, reload during process)
- Category "error": 2 tests (network errors, invalid data that should show validation messages)
- Each test has 3-7 steps
- Use valid CSS selectors for inputs (prefer [placeholder], [name], [type="submit"])
- Use descriptive text selectors for buttons like: text=Add to Cart
- For fill actions use realistic test data`,
    `Site map discovered:
${siteMap}

Generate a JSON with shape:
{
  "testCases": [
    {
      "id": "tc_001",
      "title": "...",
      "category": "happy-path",
      "priority": "critical",
      "steps": [
        {
          "index": 1,
          "description": "Navigate to homepage",
          "action": { "type": "navigate", "url": "${targetUrl}" },
          "expectedOutcome": "Homepage loads with product listings visible"
        }
      ]
    }
  ]
}`
  );

  const testCases: TestCase[] = (response.testCases || []).map((tc) => ({
    ...tc,
    status: 'pending' as const,
    steps: (tc.steps || []).map(
      (s): TestStep => ({
        ...s,
        passed: undefined,
        screenshotPath: undefined,
        durationMs: undefined,
        actualOutcome: undefined,
      })
    ),
  }));

  log('success', `Generated ${testCases.length} test cases:`);
  for (const tc of testCases) {
    log('observation', `  [${tc.priority.toUpperCase()}] ${tc.category}: "${tc.title}"`);
  }

  return testCases;
}
