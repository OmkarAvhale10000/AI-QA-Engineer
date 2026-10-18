import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

let model: GenerativeModel | null = null;

// ── In-memory prompt cache ─────────────────────────────────────────────────────────────
// Deduplicates identical text prompts within a single session.
// Vision calls (analyzeScreenshot) are NOT cached - screenshots are always unique.
const CACHE_MAX = 100;
const promptCache = new Map<string, string>();

function getCached(key: string): string | undefined {
  return promptCache.get(key);
}

function setCache(key: string, value: string): void {
  if (promptCache.size >= CACHE_MAX) {
    // Evict oldest entry
    const firstKey = promptCache.keys().next().value;
    if (firstKey !== undefined) promptCache.delete(firstKey);
  }
  promptCache.set(key, value);
}

function getModel(): GenerativeModel {
  if (model) return model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      'GEMINI_API_KEY is not set. Please copy .env.example to .env and add your API key from https://aistudio.google.com/app/apikey'
    );
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

  return model;
}

export interface GeminiMessage {
  role: 'user' | 'model';
  content: string;
}

/**
 * Call Gemini with a structured prompt and get a JSON response.
 */
export async function askGeminiJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  retries = 3
): Promise<T> {
  const m = getModel();
  const fullPrompt = `${systemPrompt}\n\nRespond ONLY with valid JSON, no markdown fences, no explanation.\n\n${userPrompt}`;

  // Check cache first
  const cached = getCached(fullPrompt);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await m.generateContent(fullPrompt);
      const text = result.response.text().trim();

      // Strip markdown fences if present
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned) as T;
      setCache(fullPrompt, JSON.stringify(parsed));
      return parsed;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
  throw new Error('Gemini request failed after retries');
}

/**
 * Call Gemini for plain text (agent thoughts, descriptions).
 */
export async function askGeminiText(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const m = getModel();
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  const cached = getCached(fullPrompt);
  if (cached) return cached;

  const result = await m.generateContent(fullPrompt);
  const text = result.response.text().trim();
  setCache(fullPrompt, text);
  return text;
}

/**
 * Analyze a screenshot (base64) and return a text observation.
 */
export async function analyzeScreenshot(
  screenshotBase64: string,
  prompt: string
): Promise<string> {
  const m = getModel();
  const result = await m.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: 'image/png',
        data: screenshotBase64,
      },
    },
  ]);
  return result.response.text().trim();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
