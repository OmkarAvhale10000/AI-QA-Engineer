import type { ActionLog, StateNode } from '../types.js';
import { BrowserDriver } from '../browser/driver.js';
import { askGeminiJSON } from '../llm/gemini.js';

interface ExplorerResult {
  stateGraph: StateNode[];
  summary: string;
}

/**
 * Agent 1: The Cartographer
 * Explores the target application and maps it into a state graph.
 */
export async function runExplorer(
  targetUrl: string,
  appDescription: string,
  driver: BrowserDriver,
  onLog: (log: Omit<ActionLog, 'timestamp'>) => void
): Promise<ExplorerResult> {
  const log = (type: ActionLog['type'], message: string) =>
    onLog({ agent: 'cartographer', type, message });

  log('thought', `Starting site exploration: ${targetUrl}`);

  const visited = new Set<string>();
  const stateGraph: StateNode[] = [];
  const queue: string[] = [targetUrl];

  // Limit exploration to avoid infinite loops
  const MAX_PAGES = 5; // Reduced from 8 — saves ~3 Gemini calls per session

  while (queue.length > 0 && stateGraph.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      log('action', `Visiting: ${url}`);
      await driver.navigate(url);
      await driver.wait(1500);

      const snapshot = await driver.getAccessibilitySnapshot();
      const currentUrl = await driver.getUrl();
      const title = await driver.getTitle();

      // Truncate snapshot to avoid runaway token usage (accessibility trees can be huge)
      const SNAPSHOT_TOKEN_LIMIT = 6000; // ~4500 tokens max
      const trimmedSnapshot = snapshot.length > SNAPSHOT_TOKEN_LIMIT
        ? snapshot.slice(0, SNAPSHOT_TOKEN_LIMIT) + '\n... [truncated for token budget]'
        : snapshot;

      // Ask Gemini to analyze the page and find links/navigation targets
      const analysis = await askGeminiJSON<{
        components: string[];
        links: string[];
        hasForm: boolean;
        formFields: string[];
      }>(
        `You are analyzing a web page accessibility snapshot for QA purposes. App context: "${appDescription}"`,
        `Given this page snapshot, extract:
1. "components": key UI components visible (e.g. "Product Grid", "Cart Icon", "Login Form")
2. "links": relative or absolute URLs found that are worth exploring (max 3, same domain)
3. "hasForm": whether there is a form with inputs
4. "formFields": names of key form fields if any

Page snapshot:
${trimmedSnapshot}`
      );

      const node: StateNode = {
        id: `state_${stateGraph.length}`,
        url: currentUrl,
        title,
        components: analysis.components || [],
        edges: [],
      };

      stateGraph.push(node);
      log('observation', `Mapped: "${title}" — Components: ${analysis.components?.join(', ')}`);

      // Add discovered links to the queue (same origin only)
      const origin = new URL(targetUrl).origin;
      for (const link of analysis.links || []) {
        try {
          const absUrl = new URL(link, origin).href;
          if (absUrl.startsWith(origin) && !visited.has(absUrl)) {
            queue.push(absUrl);
          }
        } catch {
          // ignore invalid URLs
        }
      }
    } catch (err) {
      log('error', `Failed to explore ${url}: ${(err as Error).message}`);
    }
  }

  log(
    'success',
    `Exploration complete: ${stateGraph.length} pages mapped`
  );

  return {
    stateGraph,
    summary: stateGraph
      .map((s) => `• ${s.title} (${s.url}): ${s.components.join(', ')}`)
      .join('\n'),
  };
}
