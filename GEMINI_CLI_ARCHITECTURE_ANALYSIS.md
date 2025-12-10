# Gemini CLI Architecture Analysis - Stream Client Feasibility

## 核心架构分析

### 1. 入口点和模式选择 (`packages/cli/src/gemini.tsx`)

```typescript
// Line 527-532: Interactive mode 判定
const hasQuery = !!argv.query;
const interactive =
  !!argv.promptInteractive ||              // ← --prompt-interactive 标志
  !!argv.experimentalAcp ||
  (process.stdin.isTTY && !hasQuery && !argv.prompt);

// Line 591-601: 路由到不同模式
if (config.isInteractive()) {
  await startInteractiveUI(...);  // ← Ink React UI (需要 TTY)
  return;
}

// Line 603-675: 非交互模式
await config.initialize();
if (!process.stdin.isTTY) {
  // 从 stdin 读取输入
  const stdinData = await readStdin();
  if (stdinData) {
    input = `${stdinData}\n\n${input}`;
  }
}
await runNonInteractive({...});
```

### 2. 两种模式的关键差异

#### Interactive Mode (`startInteractiveUI`)

**文件**: `packages/cli/src/gemini.tsx:175-298`

**特征**:
- 使用 **Ink** (React for CLI)
- 需要 `process.stdin.isTTY === true`
- 渲染全屏终端 UI
- 支持多轮对话,但通过 UI 组件管理输入

**关键代码**:
```typescript
const instance = render(<AppContainer ... />, {
  stdin: process.stdin,
  stdout: inkStdout,
  stderr: inkStderr,
  exitOnCtrlC: false,
  patchConsole: false,
});
```

**问题**: **Ink 完全接管 stdin**,无法直接从 stdin 读取 JSONL 消息!

#### Non-Interactive Mode (`runNonInteractive`)

**文件**: `packages/cli/src/nonInteractiveCli.ts`

**特征**:
- 单次执行模式
- 支持从 stdin 管道读取输入
- 输出 JSONL (当 `--output-format stream-json`)
- **执行完成后退出进程**

## 关键发现

### ❌ 问题 1: `--prompt-interactive` 强制使用 Ink UI

**代码**: `packages/cli/src/config/config.ts:529-532`

```typescript
const interactive =
  !!argv.promptInteractive ||  // ← 这个标志直接开启 interactive 模式
  // ...
```

一旦 `interactive = true`,就会调用 `startInteractiveUI()`,这意味着:

1. **强制 Ink 渲染**: 启动 React 组件树
2. **stdin 被 Ink 接管**: 用于键盘事件处理
3. **无法读取 JSONL**: Ink 不支持从 stdin 读取数据流

### ❌ 问题 2: 测试脚本的误导性

回顾我们的 `test_interactive_mode.py`:

```python
args = [
    'node', cli_path,
    '--prompt-interactive', '你好',  # ← 提供了初始 prompt
    '--output-format', 'stream-json',
]

# 通过 stdin 发送消息
process.stdin.write(b'hello\\n')
```

**实际发生了什么**:

1. CLI 启动,进入 interactive 模式
2. Ink UI 渲染(但因为没有 TTY,可能表现异常)
3. Ink 从 stdin 读取字符作为**键盘输入**,而不是 JSONL 消息
4. 字符被当作用户在终端输入的文本

**为什么测试看起来"成功"?**

可能是因为:
- Ink 将 stdin 的文本当作键盘输入
- 输入的文本恰好触发了某些 UI 交互
- 但这不是我们想要的"JSONL 消息处理"

### ✅ 可行的方案

#### 方案 A: 新增 `--stream-json-input` 模式 (推荐)

**修改点**: `packages/cli/src/gemini.tsx`

```typescript
// 1. 新增命令行参数
.option('stream-json-input', {
  describe: 'Enable JSONL input mode from stdin (non-TTY streaming)',
  type: 'boolean',
})

// 2. 修改 interactive 判定逻辑
const interactive =
  (!!argv.promptInteractive && !argv.streamJsonInput) ||  // ← 关键修改
  !!argv.experimentalAcp ||
  (process.stdin.isTTY && !hasQuery && !argv.prompt);

// 3. 新增 Stream JSON 模式处理
if (argv.streamJsonInput) {
  // 新的持久化 JSONL 输入/输出模式
  await runStreamJsonMode(config, settings, initializationResult);
  return;
}
```

**新增文件**: `packages/cli/src/streamJsonCli.ts`

```typescript
export async function runStreamJsonMode(
  config: Config,
  settings: LoadedSettings,
  initializationResult: InitializationResult,
) {
  const { GeminiClient } = await import('@google/gemini-cli-core');

  // 初始化客户端(复用 GeminiClient)
  const client = new GeminiClient(config);
  await client.initialize();

  // 设置 JSONL 输出
  const outputFormatter = new StreamJsonFormatter(config);

  // 发送 INIT 事件
  outputFormatter.emitEvent({
    type: JsonStreamEventType.INIT,
    timestamp: new Date().toISOString(),
    session_id: config.getSessionId(),
    model: config.getSelectedModel(),
  });

  // 从 stdin 逐行读取 JSONL 消息
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,  // ← 关键: 非终端模式
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line) as JsonInputMessage;

      if (message.type === 'user') {
        // 处理用户消息
        await handleUserMessage(client, message, outputFormatter);
      } else if (message.type === 'control') {
        // 处理控制命令 (如 interrupt)
        await handleControlMessage(client, message, outputFormatter);
      }
    } catch (error) {
      outputFormatter.emitEvent({
        type: JsonStreamEventType.ERROR,
        timestamp: new Date().toISOString(),
        error: {
          type: 'PARSE_ERROR',
          message: `Failed to parse JSON: ${error.message}`,
        },
      });
    }
  }
}

async function handleUserMessage(
  client: GeminiClient,
  message: JsonInputMessage,
  formatter: StreamJsonFormatter,
) {
  // 使用现有的流式 API
  for await (const event of client.sendMessageStream(message.content)) {
    // event 已经是 GeminiEvent,需要转换为 JsonStreamEvent
    const jsonEvent = convertGeminiEventToJsonStreamEvent(event);
    formatter.emitEvent(jsonEvent);
  }

  // 发送 RESULT 事件
  formatter.emitEvent({
    type: JsonStreamEventType.RESULT,
    timestamp: new Date().toISOString(),
    // ... 统计信息
  });
}
```

**优势**:
- ✅ **最小修改**: 复用现有 GeminiClient 和 StreamJsonFormatter
- ✅ **清晰分离**: 三种模式互不干扰 (interactive/non-interactive/stream-json)
- ✅ **持久化会话**: 进程保持运行,多轮对话
- ✅ **标准协议**: JSONL 输入/输出,与 Claude SDK 一致

**使用方式**:

```bash
# SDK 启动 CLI
node gemini.js --stream-json-input --output-format stream-json --model gemini-2.0-flash-exp

# SDK 发送消息 (stdin)
{"type": "user", "content": "Hello", "session_id": "abc123"}

# CLI 响应 (stdout)
{"type": "init", "timestamp": "...", "session_id": "abc123", "model": "gemini-2.0-flash-exp"}
{"type": "message", "role": "assistant", "content": [{"type": "text", "text": "Hi!"}]}
{"type": "result", "timestamp": "...", "total_cost_usd": 0.001}
```

#### 方案 B: 修改 Non-Interactive 模式支持持久化 (不推荐)

**问题**:
- `runNonInteractive` 设计为单次执行
- 需要大量重构才能支持多轮对话
- 违反现有架构设计

### 方案 A 的实施步骤

#### Phase 1: CLI 修改

1. **添加 `--stream-json-input` 参数**
   - 文件: `packages/cli/src/config/config.ts`
   - 添加新的命令行选项

2. **创建 StreamJsonCli 模块**
   - 文件: `packages/cli/src/streamJsonCli.ts` (新建)
   - 实现 JSONL 输入循环
   - 复用 GeminiClient 和 StreamJsonFormatter

3. **修改主入口逻辑**
   - 文件: `packages/cli/src/gemini.tsx`
   - 添加 stream-json 模式分支

#### Phase 2: 消息格式定义

**输入消息类型** (SDK → CLI):

```typescript
// packages/core/src/output/types.ts

export interface JsonInputMessage {
  type: 'user' | 'control';
  session_id?: string;
  content?: string;  // for type='user'
  control?: {        // for type='control'
    subtype: 'interrupt' | 'cancel';
  };
}
```

**输出事件** (CLI → SDK): 已有,无需修改

#### Phase 3: SDK 实现

**文件**: `gemini-cli-sdk/src/streamClient.ts` (新建)

```typescript
export class GeminiStreamClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdinStream: Writable | null = null;
  private readlineInterface: readline.Interface | null = null;

  async start(): Promise<void> {
    this.process = spawn('node', [
      this.options.pathToGeminiCLI,
      '--stream-json-input',      // ← 新参数
      '--output-format', 'stream-json',
      '--model', this.options.model,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildEnv(),
    });

    this.stdinStream = this.process.stdin!;

    // 从 stdout 逐行读取 JSONL
    this.readlineInterface = readline.createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.startReadLoop();
    await this.waitForInit();
  }

  async sendMessage(content: string): Promise<void> {
    const message: JsonInputMessage = {
      type: 'user',
      content,
      session_id: this.options.sessionId,
    };
    this.stdinStream!.write(JSON.stringify(message) + '\n');
  }

  private async startReadLoop(): Promise<void> {
    for await (const line of this.readlineInterface!) {
      if (!line.trim()) continue;

      const event = JSON.parse(line) as JsonStreamEvent;
      this.emit('event', event);
    }
  }
}
```

## 总结

### 核心问题

Gemini CLI 当前架构**不直接支持** stdin JSONL 输入的持久化模式,因为:

1. `--prompt-interactive` 强制使用 Ink UI
2. Ink 接管 stdin 用于键盘事件
3. Non-interactive 模式是单次执行设计

### 推荐方案

**新增 `--stream-json-input` 模式**:

```
SDK (GeminiStreamClient)
  ↓ spawn with --stream-json-input
CLI Process (新模式: runStreamJsonMode)
  ↓ stdin: JSONL 消息 (readline)
  ↓ stdout: JSONL 事件 (StreamJsonFormatter)
  ↓ 持久化运行,多轮对话
SDK 逐行解析并 emit 事件
```

**优势**:
- ✅ 最小修改量 (~200 行新代码)
- ✅ 清晰的架构分离
- ✅ 复用现有组件 (GeminiClient, StreamJsonFormatter)
- ✅ 符合业界标准 (与 Claude SDK 一致)
- ✅ 持久化会话,零冷启动

**预估工作量**:
- CLI 修改: 1-2 天
- SDK 实现: 1 天
- 测试验证: 1 天
- **总计: 3-4 天**

这比原 DAEMON_MODE_REFACTOR.md 的 HTTP 方案**简单 3 倍**!
