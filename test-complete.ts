/**
 * Complete test for GeminiStreamClient
 * Tests multiple rounds of conversation and all event types
 */

import { GeminiStreamClient } from './src/index';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testComplete() {
  const pathToGeminiCLI = join(
    __dirname,
    '../gemini.js'
  );

  console.log('='.repeat(80));
  console.log('🧪 Complete GeminiStreamClient Test');
  console.log('='.repeat(80));
  console.log('[Test] CLI Path:', pathToGeminiCLI);
  console.log('[Test] Model: gemini-3-pro-preview');
  console.log('[Test] Authentication: Vertex AI\n');

  const client = new GeminiStreamClient({
    pathToGeminiCLI,
    sessionId: 'complete-test-' + Date.now(),
    workspaceId: 'test-workspace',
    apiKey: process.env.GOOGLE_API_KEY,
    model: 'gemini-3-pro-preview',
    approvalMode: 'yolo',
    debug: false,
    env: {
      GOOGLE_GENAI_USE_VERTEXAI: 'true',
    },
  });

  // Track events
  const events: any[] = [];
  let initReceived = false;
  let contentReceived = false;
  let thoughtReceived = false;
  let resultReceived = false;

  // Listen to all events
  client.on('event', (event) => {
    events.push(event);

    if (event.type === 'init') {
      console.log('✅ INIT:', {
        session_id: event.session_id,
        model: event.model,
      });
      initReceived = true;
    } else if (event.type === 'content') {
      console.log('✅ CONTENT:', event.value.substring(0, 100) + '...');
      contentReceived = true;
    } else if (event.type === 'thought') {
      console.log('💭 THOUGHT:', event.value.subject);
      thoughtReceived = true;
    } else if (event.type === 'tool_use') {
      console.log('🔧 TOOL_USE:', event.tool_name);
    } else if (event.type === 'tool_result') {
      console.log('📊 TOOL_RESULT:', event.tool_id, '-', event.status);
    } else if (event.type === 'result') {
      console.log('🏁 RESULT:', event.status);
      resultReceived = true;
    } else if (event.type === 'error') {
      console.error('❌ ERROR:', event.message || event.value?.message);
    } else if (event.type === 'model_info') {
      console.log('ℹ️  MODEL_INFO:', event.value);
    } else if (event.type === 'finished') {
      console.log('✔️  FINISHED:', {
        reason: event.value.reason,
        tokens: event.value.usageMetadata?.totalTokenCount,
      });
    }
  });

  client.on('error', (error) => {
    console.error('💥 CLIENT ERROR:', error);
  });

  try {
    console.log('\n' + '─'.repeat(80));
    console.log('Phase 1: Starting client and waiting for INIT...');
    console.log('─'.repeat(80));
    await client.start();
    console.log('✅ Client started successfully!\n');

    // Test 1: Simple greeting
    console.log('─'.repeat(80));
    console.log('Phase 2: Sending simple message...');
    console.log('─'.repeat(80));
    await client.sendMessage('Say "Hello World" in one sentence');

    await waitForResult();
    console.log('✅ First message completed!\n');

    // Test 2: Ask a question that might use tools
    console.log('─'.repeat(80));
    console.log('Phase 3: Sending question that may trigger tools...');
    console.log('─'.repeat(80));
    resultReceived = false;
    await client.sendMessage('What files are in the current directory? Just list the first 5.');

    await waitForResult();
    console.log('✅ Second message completed!\n');

    // Test 3: Ask about code
    console.log('─'.repeat(80));
    console.log('Phase 4: Asking about code...');
    console.log('─'.repeat(80));
    resultReceived = false;
    await client.sendMessage('Explain what GeminiStreamClient does in one sentence');

    await waitForResult();
    console.log('✅ Third message completed!\n');

    // Summary
    console.log('='.repeat(80));
    console.log('📊 Test Summary');
    console.log('='.repeat(80));
    console.log('Total events received:', events.length);
    console.log('INIT received:', initReceived ? '✅' : '❌');
    console.log('CONTENT received:', contentReceived ? '✅' : '❌');
    console.log('THOUGHT received:', thoughtReceived ? '✅' : '❌');
    console.log('RESULT received:', resultReceived ? '✅' : '❌');

    console.log('\nEvent type distribution:');
    const eventCounts = events.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(eventCounts).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    console.log('\n' + '─'.repeat(80));
    console.log('Stopping client...');
    console.log('─'.repeat(80));
    await client.stop();

    console.log('\n' + '='.repeat(80));
    if (initReceived && contentReceived && resultReceived) {
      console.log('🎉 All tests passed successfully!');
      console.log('='.repeat(80));
      process.exit(0);
    } else {
      console.log('⚠️  Some tests failed');
      console.log('='.repeat(80));
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Test failed with error:', error);
    try {
      await client.stop();
    } catch (e) {
      // Ignore cleanup errors
    }
    process.exit(1);
  }

  async function waitForResult() {
    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resultReceived) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        console.log('⚠️  Timeout waiting for result');
        resolve();
      }, 30000);
    });
  }
}

// Run test
testComplete().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
