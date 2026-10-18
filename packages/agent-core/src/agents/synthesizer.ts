import type { ActionLog, TestCase, GeneratedTest } from '../types.js';
import { askGeminiJSON } from '../llm/gemini.js';

/**
 * Agent 5: The Test Synthesizer
 * Converts passed test cases into clean, idiomatic Playwright TypeScript test files.
 */
export async function runSynthesizer(
  testCases: TestCase[],
  targetUrl: string,
  onLog: (log: Omit<ActionLog, 'timestamp'>) => void,
  onTestGenerated: (test: GeneratedTest) => void
): Promise<GeneratedTest[]> {
  const log = (type: ActionLog['type'], message: string) =>
    onLog({ agent: 'synthesizer', type, message });

  const passedTests = testCases.filter((tc) => tc.status === 'passed');
  log('thought', `Synthesizing ${passedTests.length} passing tests into Playwright spec files...`);

  if (passedTests.length === 0) {
    log('success', 'No passing tests to synthesize.');
    return [];
  }

  // ── Batch all tests into ONE Gemini call ────────────────────────────────────────
  // Previously: N calls (one per test). Now: 1 call for all tests.
  const allTestDescriptions = passedTests.map((tc) => ({
    id: tc.id,
    title: tc.title,
    category: tc.category,
    steps: tc.steps.map((s) => ({
      index: s.index,
      description: s.description,
      action: s.action,
      expectedOutcome: s.expectedOutcome,
    })),
  }));

  log('action', `Batching ${passedTests.length} tests into single Gemini call...`);

  let batchResult: { tests: Array<{ id: string; filename: string; code: string }> } = { tests: [] };
  try {
    batchResult = await askGeminiJSON<{ tests: Array<{ id: string; filename: string; code: string }> }>(
      `You are an expert Playwright TypeScript test automation engineer.
Generate clean, idiomatic Playwright test files for all given test cases.

Rules:
- Use \`import { test, expect } from '@playwright/test';\`
- Use \`page.getByRole()\`, \`page.getByLabel()\`, \`page.getByPlaceholder()\` where possible
- Prefer \`page.getByText()\` over CSS selectors for buttons
- Add descriptive comments before each step
- Use \`await expect(...).toBeVisible()\` for assertions
- Include a \`test.describe\` block wrapping each test
- filename should be kebab-case like \`checkout-flow.spec.ts\`
- Return one entry per test case, matching the given id`,
      `Base URL: "${targetUrl}"

Generate Playwright files for ALL of these test cases:
${JSON.stringify(allTestDescriptions, null, 2)}

Return JSON: { "tests": [ { "id": "tc_id", "filename": "...", "code": "full ts code" } ] }`
    );
  } catch (err) {
    log('error', `Batch synthesis failed: ${(err as Error).message}. Falling back to individual generation.`);
    // Fallback: generate using template (zero extra API calls)
    batchResult.tests = passedTests.map((tc) => ({
      id: tc.id,
      filename: `${tc.id}.spec.ts`,
      code: generateFallbackCode(tc, targetUrl),
    }));
  }

  const generatedTests: GeneratedTest[] = [];
  for (const tc of passedTests) {
    const result = batchResult.tests.find((r) => r.id === tc.id);
    const generated: GeneratedTest = {
      id: `gen_${tc.id}`,
      filename: result?.filename || `${tc.id}.spec.ts`,
      testCaseId: tc.id,
      title: tc.title,
      code: result?.code || generateFallbackCode(tc, targetUrl),
      status: 'generated',
    };
    generatedTests.push(generated);
    onTestGenerated(generated);
    log('success', `Generated: ${generated.filename}`);
  }

  log('success', `Synthesis complete: ${generatedTests.length} Playwright test files generated (1 API call)`);
  return generatedTests;
}

function generateFallbackCode(tc: TestCase, targetUrl: string): string {
  const stepLines = tc.steps
    .map((s) => {
      const a = s.action;
      let line = `  // ${s.description}\n`;
      if (a.type === 'navigate') line += `  await page.goto('${a.url}');\n`;
      else if (a.type === 'click') line += `  await page.locator('${a.selector}').click();\n`;
      else if (a.type === 'fill')
        line += `  await page.locator('${a.selector}').fill('${a.value}');\n`;
      else if (a.type === 'wait') line += `  await page.waitForTimeout(${a.ms});\n`;
      return line;
    })
    .join('\n');

  return `import { test, expect } from '@playwright/test';

test.describe('${tc.category}: ${tc.title}', () => {
  test('${tc.title}', async ({ page }) => {
    // Base URL: ${targetUrl}
${stepLines}
  });
});
`;
}
