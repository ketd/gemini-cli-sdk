# @google/gemini-cli-sdk

TypeScript SDK for Google Gemini CLI - spawn and interact with Gemini CLI as a subprocess.

## Features

- 🚀 **Simple API**: Easy-to-use client for Gemini CLI
- 📡 **Streaming Support**: Real-time event streaming
- 🔧 **TypeScript**: Full type safety with TypeScript
- 🎯 **Tool Calling**: Automatic tool execution handling
- 📦 **Lightweight**: Minimal dependencies
- 🔄 **Session Management**: Resume previous sessions
- ⚡ **Async Generators**: Modern async/await patterns

## Installation

```bash
npm install @google/gemini-cli-sdk @google/gemini-cli
```

Or with pnpm:

```bash
pnpm add @google/gemini-cli-sdk @google/gemini-cli
```

## Prerequisites

- Node.js >= 18.0.0
- `@google/gemini-cli` installed (peer dependency)
- Google AI API Key

## Quick Start

### Basic Usage

```typescript
import { GeminiClient } from '@google/gemini-cli-sdk';

const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.0-flash-exp',
});

// Get complete response
const result = await client.query('Explain TypeScript generics');
console.log(result.response);
console.log('Tokens used:', result.stats?.total_tokens);
```

### Streaming Events

```typescript
import { GeminiClient } from '@google/gemini-cli-sdk';

const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
});

// Stream events in real-time
for await (const event of client.stream('Write a hello world program')) {
  if (event.type === 'message' && event.role === 'assistant' && event.delta) {
    process.stdout.write(event.content);
  }
}
```

### Low-Level API

```typescript
import { query } from '@google/gemini-cli-sdk';

const stream = query('Hello, Gemini!', {
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
});

for await (const event of stream) {
  console.log(event);
}
```

## API Reference

### `GeminiClient`

High-level client for interacting with Gemini CLI.

#### Constructor

```typescript
new GeminiClient(options: GeminiOptions)
```

#### Methods

##### `query(prompt: string): Promise<QueryResult>`

Send a query and get the complete result.

```typescript
const result = await client.query('Explain async/await');
console.log(result.response);
console.log(result.stats);
```

##### `stream(prompt: string): AsyncGenerator<JsonStreamEvent>`

Stream events from Gemini CLI.

```typescript
for await (const event of client.stream('Hello')) {
  if (event.type === 'message') {
    console.log(event.content);
  }
}
```

##### `getStatus(): ProcessStatus`

Get current process status.

```typescript
const status = client.getStatus();
// 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
```

##### `getSessionId(): string | null`

Get current session ID.

```typescript
const sessionId = client.getSessionId();
```

### `query(prompt: string, options: GeminiOptions)`

Low-level function to query Gemini CLI.

```typescript
import { query } from '@google/gemini-cli-sdk';

for await (const event of query('Hello', options)) {
  console.log(event);
}
```

## Configuration Options

```typescript
interface GeminiOptions {
  // Required
  pathToGeminiCLI: string;

  // Optional
  apiKey?: string; // Or set GOOGLE_API_KEY env var
  model?: string; // Default: 'gemini-2.0-flash-exp'
  cwd?: string; // Working directory
  approvalMode?: 'default' | 'auto_edit' | 'yolo';
  allowedTools?: string[]; // e.g., ['read', 'write', 'bash']
  allowedMcpServerNames?: string[];
  debug?: boolean;
  resumeSessionId?: string; // Resume previous session
  sandbox?: boolean;
  includeDirectories?: string[];
  env?: Record<string, string>; // Custom env vars
  timeout?: number; // Timeout in milliseconds
}
```

## Event Types

### `InitEvent`

Session initialization event.

```typescript
{
  type: 'init',
  timestamp: '2025-12-08T10:30:00.123Z',
  session_id: 'abc123',
  model: 'gemini-2.0-flash-exp'
}
```

### `MessageEvent`

Message content from user or assistant.

```typescript
{
  type: 'message',
  timestamp: '2025-12-08T10:30:01.000Z',
  role: 'assistant',
  content: 'Hello! How can I help you?',
  delta: true // Incremental content
}
```

### `ToolUseEvent`

Tool call request.

```typescript
{
  type: 'tool_use',
  timestamp: '2025-12-08T10:30:02.000Z',
  tool_name: 'read',
  tool_id: 'tool_123',
  parameters: { path: 'package.json' }
}
```

### `ToolResultEvent`

Tool execution result.

```typescript
{
  type: 'tool_result',
  timestamp: '2025-12-08T10:30:03.000Z',
  tool_id: 'tool_123',
  status: 'success',
  output: '{"name": "my-app"}'
}
```

### `ErrorEvent`

Error or warning event.

```typescript
{
  type: 'error',
  timestamp: '2025-12-08T10:30:04.000Z',
  severity: 'warning',
  message: 'Loop detected'
}
```

### `ResultEvent`

Final result with statistics.

```typescript
{
  type: 'result',
  timestamp: '2025-12-08T10:30:05.000Z',
  status: 'success',
  stats: {
    total_tokens: 1500,
    input_tokens: 500,
    output_tokens: 1000,
    duration_ms: 5000,
    tool_calls: 3
  }
}
```

## Advanced Examples

### With Tool Approval

```typescript
const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
  approvalMode: 'auto_edit', // Auto-approve edit tools
  allowedTools: ['read', 'write'], // Allow these tools without confirmation
});

const result = await client.query('Read package.json and update version');
```

### Resume Previous Session

```typescript
const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
  resumeSessionId: 'latest', // Or specific session ID
});

const result = await client.query('Continue from where we left off');
```

### Event Listeners

```typescript
const client = new GeminiClient(options);

client.on('event', (event) => {
  console.log('Event:', event.type);
});

client.on('status', (status) => {
  console.log('Status:', status);
});

client.on('session', (sessionId) => {
  console.log('Session ID:', sessionId);
});

client.on('error', (error) => {
  console.error('Error:', error);
});

await client.query('Hello');
```

### Custom Working Directory

```typescript
const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
  cwd: '/path/to/project',
  includeDirectories: ['./src', './docs'],
});
```

### Timeout Handling

```typescript
const client = new GeminiClient({
  pathToGeminiCLI: './node_modules/@google/gemini-cli/bundle/gemini.js',
  apiKey: process.env.GOOGLE_API_KEY,
  timeout: 30000, // 30 seconds
});

try {
  const result = await client.query('Long running task');
} catch (error) {
  if (error.code === 130) {
    console.log('Query timed out');
  }
}
```

## Utilities

### `findGeminiCLI(cwd?: string): string`

Automatically find Gemini CLI executable.

```typescript
import { findGeminiCLI } from '@google/gemini-cli-sdk';

const cliPath = findGeminiCLI();
console.log('Found Gemini CLI at:', cliPath);
```

### `getApiKey(apiKey?: string): string`

Get API key from options or environment.

```typescript
import { getApiKey } from '@google/gemini-cli-sdk';

const apiKey = getApiKey(); // Reads from GOOGLE_API_KEY env var
```

### `formatDuration(ms: number): string`

Format duration in milliseconds.

```typescript
import { formatDuration } from '@google/gemini-cli-sdk';

console.log(formatDuration(5432)); // "5.43s"
console.log(formatDuration(125000)); // "2m 5s"
```

### `formatTokens(tokens: number): string`

Format token count with commas.

```typescript
import { formatTokens } from '@google/gemini-cli-sdk';

console.log(formatTokens(1234567)); // "1,234,567"
```

## Error Handling

```typescript
import { GeminiSDKError, ExitCode } from '@google/gemini-cli-sdk';

try {
  const result = await client.query('Hello');
} catch (error) {
  if (error instanceof GeminiSDKError) {
    console.error('SDK Error:', error.message);
    console.error('Exit Code:', error.code);
    console.error('Details:', error.details);

    if (error.code === ExitCode.USER_INTERRUPTED) {
      console.log('User cancelled the query');
    }
  }
}
```

## Environment Variables

- `GOOGLE_API_KEY`: Google AI API Key (required if not provided in options)
- `GEMINI_CLI_PATH`: Custom path to Gemini CLI executable
- `DEBUG`: Enable debug logging

## Architecture

This SDK follows the same architecture as `@anthropic-ai/claude-agent-sdk`:

1. **Subprocess Spawning**: Gemini CLI runs as a separate Node.js process
2. **stdio Communication**: JSON-Lines format over stdin/stdout
3. **Event Streaming**: Real-time event streaming via AsyncGenerator
4. **Process Isolation**: Clean separation between SDK and CLI

## Comparison with Claude Code SDK

| Feature | Gemini CLI SDK | Claude Code SDK |
|---------|---------------|-----------------|
| **Output Format** | `--output-format stream-json` | JSON-Lines |
| **Tool Calling** | CLI handles automatically | SDK handles |
| **Session Management** | CLI built-in | SDK manages |
| **Approval Mode** | `--approval-mode` flag | SDK config |
| **API Key** | `GOOGLE_API_KEY` | `ANTHROPIC_API_KEY` |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint

# Format
pnpm format
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Related Projects

- [@google/gemini-cli](https://github.com/google-gemini/gemini-cli) - Official Gemini CLI
- [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/claude-agent-sdk) - Claude Agent SDK (inspiration)

## Support

For issues and questions:
- GitHub Issues: [github.com/yourusername/gemini-cli-sdk/issues](https://github.com/yourusername/gemini-cli-sdk/issues)
- Gemini CLI Docs: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
