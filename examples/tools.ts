/**
 * Tool calling example
 */

import { GeminiClient } from '../src';

async function main() {
  const client = new GeminiClient({
    pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
    apiKey: process.env.GOOGLE_API_KEY!,
    approvalMode: 'auto_edit', // Auto-approve edit tools
    allowedTools: ['read', 'write'], // Allow these tools without confirmation
  });

  console.log('Querying with tool calls...\n');

  const result = await client.query('Read package.json and tell me the version');

  console.log('--- Response ---');
  console.log(result.response);

  console.log('\n--- Tool Calls ---');
  for (const toolCall of result.toolCalls) {
    console.log(`- ${toolCall.tool_name}:`, toolCall.parameters);
    console.log(`  Status: ${toolCall.result?.status}`);
  }
}

main().catch(console.error);
