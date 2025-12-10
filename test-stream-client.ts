/**
 * Test script for GeminiStreamClient
 * Tests the new stream JSON input mode
 */

import { GeminiStreamClient, JsonStreamEventType } from './src/index';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testStreamClient() {
  const pathToGeminiCLI = join(
    __dirname,
    '../ganyi/aoe-desktop/resources/gemini-cli/gemini.js'
  );

  console.log('[Test] Creating GeminiStreamClient...');
  console.log('[Test] CLI Path:', pathToGeminiCLI);

  const client = new GeminiStreamClient({
    pathToGeminiCLI,
    sessionId: 'test-session-' + Date.now(),
    workspaceId: 'test-workspace',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash-exp',
    approvalMode: 'yolo',
    debug: true,
  });

  // Listen to events
  client.on('init', (event) => {
    console.log('[Test] INIT event received:', event);
  });

  client.on('message', (event) => {
    console.log('[Test] MESSAGE event:', event.role, event.content.substring(0, 50));
  });

  client.on('tool_use', (event) => {
    console.log('[Test] TOOL_USE event:', event.tool_name);
  });

  client.on('tool_result', (event) => {
    console.log('[Test] TOOL_RESULT event:', event.tool_id, event.status);
  });

  client.on('result', (event) => {
    console.log('[Test] RESULT event:', event.status);
  });

  client.on('error', (event) => {
    console.error('[Test] ERROR event:', event);
  });

  try {
    console.log('[Test] Starting client...');
    await client.start();

    console.log('[Test] Client started successfully!');
    console.log('[Test] Sending message...');

    await client.sendMessage('Hello! What is 2+2?');

    console.log('[Test] Message sent, waiting for response...');

    // Wait for result event (simplified - in real code use event listeners)
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('[Test] Stopping client...');
    await client.stop();

    console.log('[Test] Test completed successfully!');
  } catch (error) {
    console.error('[Test] Error during test:', error);
    process.exit(1);
  }
}

// Run test
testStreamClient().catch(console.error);
