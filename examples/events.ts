/**
 * Event listener example
 */

import { GeminiClient } from '../src';

async function main() {
  const client = new GeminiClient({
    pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
    apiKey: process.env.GOOGLE_API_KEY!,
  });

  // Listen to all events
  client.on('event', (event) => {
    console.log(`[${event.type}]`, event.timestamp);
  });

  // Listen to status changes
  client.on('status', (status) => {
    console.log('Status:', status);
  });

  // Listen to session ID
  client.on('session', (sessionId) => {
    console.log('Session ID:', sessionId);
  });

  // Listen to errors
  client.on('error', (error) => {
    console.error('Error:', error);
  });

  console.log('Querying with event listeners...\n');

  const result = await client.query('Hello, Gemini!');

  console.log('\n--- Final Response ---');
  console.log(result.response);
}

main().catch(console.error);
