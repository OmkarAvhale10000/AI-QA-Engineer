# Autonomous AI QA Engineer

> **Problem Statement IM-02** — A multi-agent AI system that explores, tests, reports bugs, and synthesizes Playwright regression suites for any web application.

---

## Architecture

```
apps/
  dashboard/         → Split-Studio QA Dashboard (React + Vite, port 5173)
  benchmark-app/     → BuggyCart Demo App with 6 planted bugs (React + Vite, port 5174)

packages/
  agent-core/        → Multi-Agent Engine + WebSocket API (Node.js + Playwright, port 3001)
    src/
      agents/
        explorer.ts    → Cartographer: maps site state graph
        planner.ts     → Strategist: generates test cases
        executor.ts    → Driver: runs Playwright browser actions
        critic.ts      → Verifier: confirms bugs in clean sandbox
        synthesizer.ts → Code gen: produces Playwright .spec.ts files
      browser/
        driver.ts      → Playwright wrapper (actions, a11y tree, screenshots)
      llm/
        gemini.ts      → Google Gemini integration (JSON, text, vision)
      orchestrator.ts  → Coordinates all agents
      server.ts        → Express + WebSocket backend
```

---

## Quick Start

### Prerequisites
- **Node.js 20+** (download from https://nodejs.org)
- **npm 9+** (included with Node.js)
- **Google Gemini API Key** (free at https://aistudio.google.com/app/apikey)

### 1. Clone & Install

```powershell
# From the project root: "AI QA Engineer/"
npm install
```

### 2. Configure API Key

```powershell
# Copy the template
copy .env.example .env

# Edit .env and replace the placeholder:
# GEMINI_API_KEY=your_actual_key_here
notepad .env
```

### 3. Install Playwright Browser

```powershell
npx playwright install chromium
```

### 4. Start Everything

```powershell
npm run dev
```

This starts three servers simultaneously:
| Service | Port | Description |
|---|---|---|
| QA Dashboard | http://localhost:5173 | Split-Studio IDE interface |
| BuggyCart App | http://localhost:5174 | Benchmark target app with planted bugs |
| Agent Backend | http://localhost:3001 | WebSocket + REST API |

### 5. Run Your First QA Session

1. Open **http://localhost:5173** in your browser
2. In the setup modal, click **"BuggyCart (localhost:5174)"** to pre-fill the demo app
3. Click **"Start QA Session"**
4. Watch the agents explore, plan, execute, verify bugs, and generate test code in real time

---

## Benchmark: Testing BuggyCart with All Bugs Active

BuggyCart includes **6 deliberately planted bugs** you can toggle:

| # | Bug | Location |
|---|---|---|
| 1 | Double discount applied on item removal | Cart → Remove Item |
| 2 | Negative quantity reduces total price | Cart → Quantity Input |
| 3 | Special characters crash checkout form | Checkout → Name Fields |
| 4 | Invisible overlay blocks checkout button | Global (z-index trap) |
| 5 | Browser Back button wipes cart state | Back Navigation |
| 6 | Silent API failure (infinite spinner) | Checkout → Place Order |

**To enable all bugs:** Open BuggyCart at `http://localhost:5174`, expand the **Bug Matrix** panel (bottom-right), click **"Enable All Bugs"**, then run the AI QA agent.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key (required) | — |
| `AGENT_PORT` | Agent backend port | 3001 |
| `BENCHMARK_PORT` | BuggyCart app port | 5174 |
| `DASHBOARD_PORT` | Dashboard app port | 5173 |

---

## Generated Playwright Tests

After a successful session, the **Generated** tab in the dashboard shows `.spec.ts` files you can:
- **Copy** to clipboard
- **Download** directly
- **Run** against the app:

```powershell
# Save a generated file, then run:
npx playwright test path/to/your-test.spec.ts
```

---

## Output Examples

### Bug Report (JSON)
```json
{
  "id": "BUG-1728340-XYZ1",
  "title": "Negative quantity reduces cart total below zero",
  "severity": "critical",
  "reproducible": true,
  "reproductionSteps": [
    { "index": 1, "description": "Navigate to http://localhost:5174" },
    { "index": 2, "description": "Add any product to cart" },
    { "index": 3, "description": "Set quantity to -2 in the cart quantity input" },
    { "index": 4, "description": "Observe total shows negative value" }
  ],
  "expectedBehavior": "Minimum quantity of 1 enforced, total stays positive",
  "actualBehavior": "Quantity accepts -2, total becomes -$179.98"
}
```

### Generated Playwright Test
```typescript
import { test, expect } from '@playwright/test';

test.describe('happy-path: Add to cart and checkout', () => {
  test('User can add product, apply coupon, and complete checkout', async ({ page }) => {
    // Navigate to the store
    await page.goto('http://localhost:5174');
    await expect(page.getByText('Featured Products')).toBeVisible();

    // Add product to cart
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await expect(page.getByText('added to cart')).toBeVisible();

    // Proceed to checkout
    await page.getByRole('link', { name: /cart/i }).click();
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();

    // Fill shipping form
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Email Address').fill('john@example.com');
    // ...
  });
});
```
