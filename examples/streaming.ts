/**
 * Streaming example
 */

import { GeminiClient } from '../src';

async function main() {
  const client = new GeminiClient({
    pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
    apiKey: process.env.GOOGLE_API_KEY!,
  });

  console.log('Streaming response...\n');

  for await (const event of client.stream('Write a haiku about TypeScript')) {
    if (event.type === 'message' && event.role === 'assistant' && event.delta) {
      process.stdout.write(event.content);
    } else if (event.type === 'result') {
      console.log('\n\n--- Stats ---');
      console.log('Tokens:', event.stats?.total_tokens);
      console.log('Duration:', event.stats?.duration_ms, 'ms');
    }
  }
}

main().catch(console.error);
