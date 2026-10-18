import { Browser, BrowserContext, Page, chromium } from 'playwright';
import type { ActionLog, BrowserAction, NetworkError } from '../types.js';

export class BrowserDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  public page: Page | null = null;

  public consoleErrors: string[] = [];
  public networkErrors: NetworkError[] = [];

  private logFn: (log: Omit<ActionLog, 'timestamp'>) => void;

  constructor(logFn: (log: Omit<ActionLog, 'timestamp'>) => void) {
    this.logFn = logFn;
  }

  async launch(headless = true) {
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    this.page = await this.context.newPage();

    // Wire up console listener
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(`[Console Error] ${msg.text()}`);
      }
    });

    // Wire up page error listener
    this.page.on('pageerror', (err) => {
      this.consoleErrors.push(`[Page Error] ${err.message}`);
    });

    // Wire up network failure listener
    this.page.on('response', async (response) => {
      const status = response.status();
      if (status >= 400) {
        this.networkErrors.push({
          url: response.url(),
          method: response.request().method(),
          status,
          statusText: response.statusText(),
        });
      }
    });

    this.log('action', 'Browser launched (Chromium)');
  }

  async launchFresh(): Promise<BrowserDriver> {
    const fresh = new BrowserDriver(this.logFn);
    await fresh.launch(true);
    return fresh;
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private ensurePage(): Page {
    if (!this.page) throw new Error('Browser not launched. Call launch() first.');
    return this.page;
  }

  private log(type: ActionLog['type'], message: string, data?: Record<string, unknown>) {
    this.logFn({ agent: 'executor', type, message, data });
  }

  // ─── Core Actions ───────────────────────────────────────────────────────────

  async navigate(url: string) {
    const page = this.ensurePage();
    this.log('action', `Navigate -> ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async click(selector: string, description: string) {
    const page = this.ensurePage();
    this.log('action', `Click: ${description} (${selector})`);
    try {
      await page.locator(selector).first().click({ timeout: 8000 });
    } catch {
      // fallback to text-based locator
      await page.getByText(selector, { exact: false }).first().click({ timeout: 5000 });
    }
  }

  async fill(selector: string, value: string, description: string) {
    const page = this.ensurePage();
    this.log('action', `Fill: ${description} = "${value}"`);
    await page.locator(selector).first().fill(value, { timeout: 8000 });
  }

  async selectOption(selector: string, value: string, description: string) {
    const page = this.ensurePage();
    this.log('action', `Select: ${description} = "${value}"`);
    await page.locator(selector).first().selectOption(value, { timeout: 8000 });
  }

  async press(key: string, description: string) {
    const page = this.ensurePage();
    this.log('action', `Press: ${key} (${description})`);
    await page.keyboard.press(key);
  }

  async wait(ms: number) {
    this.log('action', `Wait ${ms}ms`);
    await new Promise((r) => setTimeout(r, ms));
  }

  async screenshot(label?: string): Promise<string> {
    const page = this.ensurePage();
    const buffer = await page.screenshot({ fullPage: false });
    const base64 = buffer.toString('base64');
    this.log('observation', `Screenshot captured${label ? `: ${label}` : ''}`);
    return base64;
  }

  async getTitle(): Promise<string> {
    return this.ensurePage().title();
  }

  async getUrl(): Promise<string> {
    return this.ensurePage().url();
  }

  // ─── Accessibility Tree Extraction ─────────────────────────────────────────

  async getAccessibilitySnapshot(): Promise<string> {
    const page = this.ensurePage();

    // Extract interactive elements into a compact token-efficient format
    const elements = await page.evaluate(() => {
      const results: Array<{
        tag: string;
        role: string;
        name: string;
        id: string;
        selector: string;
        value: string;
        visible: boolean;
        type: string;
      }> = [];

      const interactiveTags = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"]';

      document.querySelectorAll(interactiveTags).forEach((el) => {
        const htmlEl = el as HTMLElement;
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';

        // Build a reliable selector
        let selector = '';
        if (el.id) {
          selector = `#${el.id}`;
        } else if ((el as HTMLInputElement).name) {
          selector = `[name="${(el as HTMLInputElement).name}"]`;
        } else {
          const text = htmlEl.textContent?.trim().slice(0, 40);
          if (text) selector = `text=${text}`;
        }

        results.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name:
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            htmlEl.textContent?.trim().slice(0, 60) ||
            '',
          id: el.id,
          selector,
          value: (el as HTMLInputElement).value || '',
          visible,
          type: (el as HTMLInputElement).type || '',
        });
      });

      return results.filter((r) => r.visible && r.selector);
    });

    const url = page.url();
    const title = await page.title();
    const lines = [`Page: "${title}" (${url})`, `Interactive Elements (${elements.length}):`];

    for (const el of elements.slice(0, 60)) {
      lines.push(
        `  [${el.tag}${el.type ? `[${el.type}]` : ''}] name="${el.name}" selector="${el.selector}"`
      );
    }

    return lines.join('\n');
  }

  // ─── Execute a Generic BrowserAction ──────────────────────────────────────

  async executeAction(action: BrowserAction): Promise<void> {
    switch (action.type) {
      case 'navigate':
        await this.navigate(action.url);
        break;
      case 'click':
        await this.click(action.selector, action.description);
        break;
      case 'fill':
        await this.fill(action.selector, action.value, action.description);
        break;
      case 'select':
        await this.selectOption(action.selector, action.value, action.description);
        break;
      case 'press':
        await this.press(action.key, action.description);
        break;
      case 'wait':
        await this.wait(action.ms);
        break;
      case 'screenshot':
        await this.screenshot(action.label);
        break;
      case 'assert':
        // Assertions handled by executor agent
        break;
    }
  }

  clearErrors() {
    this.consoleErrors = [];
    this.networkErrors = [];
  }
}
