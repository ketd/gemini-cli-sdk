/**
 * Basic usage example
 */

import { GeminiClient } from '../src';

async function main() {
  const client = new GeminiClient({
    pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
    apiKey: process.env.GOOGLE_API_KEY!,
    model: 'gemini-2.0-flash-exp',
  });

  console.log('Querying Gemini...\n');

  const result = await client.query('Explain TypeScript generics in 2 sentences');

  console.log('\n--- Response ---');
  console.log(result.response);

  console.log('\n--- Stats ---');
  console.log('Session ID:', result.sessionId);
  console.log('Model:', result.model);
  console.log('Total tokens:', result.stats?.total_tokens);
  console.log('Duration:', result.stats?.duration_ms, 'ms');
}

main().catch(console.error);
