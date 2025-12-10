# Gemini CLI SDK - Interactive Mode 重构方案（无需修改 CLI 源码）

## 1. 核心发现：CLI 已支持交互式模式！

### 现有能力分析

通过分析 Gemini CLI 的帮助文档和源码，发现 CLI **已经支持持久进程模式**：

```bash
-i, --prompt-interactive   Execute the provided prompt and continue in interactive mode
```

**关键发现**：
1. ✅ CLI 可以启动后保持运行（交互模式）
2. ✅ 支持通过 stdin 持续接收输入
3. ✅ 支持 `--output-format stream-json` 输出结构化数据
4. ✅ 支持 `--resume` 恢复会话

### 工作原理

```
┌─────────────────────────────────────────┐
│   启动 CLI (Interactive Mode)           │
│   node gemini.js --prompt-interactive   │
│   --output-format stream-json           │
└─────────────┬───────────────────────────┘
              │
              │ stdin/stdout (持续通信)
              │
┌─────────────▼───────────────────────────┐
│  SDK 通过 stdin 发送消息                │
│  SDK 通过 stdout 接收 JSONL 响应        │
└─────────────────────────────────────────┘
```

**优势**：
- ✅ **零修改**：完全不需要修改 CLI 源码
- ✅ **原生支持**：利用 CLI 原生的交互模式
- ✅ **简单可靠**：stdin/stdout 通信，成熟稳定
- ✅ **向后兼容**：CLI 更新不影响 SDK

---

## 2. 问题与解决方案

### 当前架构的问题

**现状**：SDK 每次调用 `client.stream()` 都会 `spawn()` 一个新进程并立即退出

```typescript
// 当前实现 (query.ts)
export async function* query(prompt: string, options: GeminiOptions) {
  const geminiProcess = spawn('node', [pathToGeminiCLI, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // 读取输出...

  // 等待进程退出
  await waitForExit(geminiProcess);
}
```

**问题**：
- 每次请求启动新进程：~400-700ms 开销
- 无法复用会话状态
- API 连接需要重新建立

### 新架构：持久进程 + stdin/stdout 通信

```typescript
export class GeminiInteractiveClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdoutReader: ReadlineInterface | null = null;
  private isReady: boolean = false;

  async start(): Promise<void> {
    // 启动交互式 CLI 进程
    this.process = spawn('node', [
      this.options.pathToGeminiCLI,
      '--prompt-interactive', '', // 空 prompt 直接进入交互模式
      '--output-format', 'stream-json',
      '--resume', this.options.resumeSessionId || 'latest',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildEnv(),
      cwd: this.options.cwd,
    });

    // 设置 stdout 读取器
    this.stdoutReader = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.isReady = true;
  }

  async *stream(prompt: string): AsyncGenerator<JsonStreamEvent> {
    if (!this.isReady || !this.process) {
      throw new Error('Client not started');
    }

    // 发送消息到 stdin
    this.process.stdin!.write(prompt + '\n');

    // 读取响应直到收到 RESULT 事件
    for await (const line of this.stdoutReader!) {
      const event = JSON.parse(line) as JsonStreamEvent;
      yield event;

      if (event.type === JsonStreamEventType.RESULT) {
        break; // 本轮对话结束
      }
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.stdin!.end(); // 关闭 stdin，优雅退出
      await waitForExit(this.process);
      this.process = null;
    }
    this.isReady = false;
  }
}
```

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│              AoE Desktop (Electron)                          │
│  ┌────────────────────────────────────────────────────┐     │
│  │        GeminiAdapter (Main Process)                │     │
│  │  • 使用 GeminiInteractiveClient                    │     │
│  │  • 管理进程生命周期                                 │     │
│  │  • 转换协议消息                                    │     │
│  └──────────────────┬─────────────────────────────────┘     │
└────────────────────┼────────────────────────────────────────┘
                     │
                     │ SDK (stdin/stdout)
                     │
┌────────────────────▼────────────────────────────────────────┐
│         Gemini CLI Process (Interactive Mode)               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  node gemini.js --prompt-interactive               │     │
│  │  --output-format stream-json                       │     │
│  │  --resume latest                                   │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  • stdin: 接收用户消息 (一行一条)                            │
│  • stdout: 输出 JSONL 事件流                               │
│  • 保持运行，等待下一条消息                                  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 通信协议

#### 输入（stdin）

**格式**：纯文本，每行一条消息

```
你好\n
帮我写一个 React 组件\n
修改一下，加上类型注解\n
```

#### 输出（stdout）

**格式**：JSONL（Newline-Delimited JSON），CLI 原生支持

```jsonl
{"type":"init","timestamp":"2025-12-10T07:37:49.789Z","session_id":"session-123","model":"gemini-2.0-flash-exp"}
{"type":"thought","timestamp":"2025-12-10T07:37:50.123Z","subject":"Analyzing request","description":"..."}
{"type":"message","timestamp":"2025-12-10T07:37:51.456Z","role":"assistant","content":"我可以","delta":true}
{"type":"message","timestamp":"2025-12-10T07:37:51.789Z","role":"assistant","content":"帮你","delta":true}
{"type":"result","timestamp":"2025-12-10T07:37:52.000Z","status":"success","stats":{...}}
```

**关键事件**：
- `RESULT` - 表示一轮对话结束，SDK 可以继续发送下一条消息

---

## 4. 核心组件实现

### 4.1 GeminiInteractiveClient (SDK 新增)

**文件**：`gemini-cli-sdk/src/interactiveClient.ts`

```typescript
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { GeminiOptions, JsonStreamEvent } from './types';
import { JsonStreamEventType } from './types';

export interface GeminiInteractiveOptions extends GeminiOptions {
  /**
   * 会话 ID（用于恢复）
   */
  sessionId?: string;
}

/**
 * Gemini Interactive Client
 *
 * 启动一个持久的 CLI 进程，通过 stdin/stdout 进行多轮对话
 */
export class GeminiInteractiveClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdoutReader: readline.Interface | null = null;
  private stderrBuffer: Buffer[] = [];
  private isReady: boolean = false;
  private isProcessing: boolean = false;
  private messageQueue: Array<{ prompt: string; resolve: () => void }> = [];

  constructor(private options: GeminiInteractiveOptions) {
    super();
  }

  /**
   * 启动交互式 CLI 进程
   */
  async start(): Promise<void> {
    if (this.isReady) {
      console.warn('[InteractiveClient] Already started');
      return;
    }

    // 构建 CLI 参数
    const args = this.buildCliArgs();
    const env = this.buildEnv();

    console.log('[InteractiveClient] Starting CLI process...');
    this.process = spawn('node', [this.options.pathToGeminiCLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: this.options.cwd || process.cwd(),
    });

    // 设置 stdout 读取器
    this.stdoutReader = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    // 处理 stderr（错误日志）
    this.process.stderr!.on('data', (data: Buffer) => {
      this.stderrBuffer.push(data);
      if (this.options.debug) {
        console.error('[CLI stderr]:', data.toString());
      }
    });

    // 监听进程退出
    this.process.on('exit', (code, signal) => {
      console.log(`[InteractiveClient] Process exited: code=${code}, signal=${signal}`);
      this.isReady = false;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (error) => {
      console.error('[InteractiveClient] Process error:', error);
      this.emit('error', error);
    });

    // 等待 CLI 就绪（检测首个 INIT 事件）
    await this.waitForInit();

    this.isReady = true;
    console.log('[InteractiveClient] CLI process ready');
  }

  /**
   * 发送消息并流式接收响应
   */
  async *stream(prompt: string): AsyncGenerator<JsonStreamEvent> {
    if (!this.isReady || !this.process || !this.stdoutReader) {
      throw new Error('Client not ready. Call start() first.');
    }

    // 如果正在处理其他请求，等待
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessing = true;

    try {
      // 发送消息到 stdin
      console.log('[InteractiveClient] Sending message:', prompt.substring(0, 50) + '...');
      this.process.stdin!.write(prompt + '\n');

      // 读取响应直到收到 RESULT 事件
      for await (const line of this.stdoutReader) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as JsonStreamEvent;
          this.emit('event', event);
          yield event;

          // RESULT 表示本轮对话结束
          if (event.type === JsonStreamEventType.RESULT) {
            console.log('[InteractiveClient] Conversation turn completed');
            break;
          }
        } catch (parseError) {
          console.error('[InteractiveClient] Failed to parse JSON:', line);
          if (this.options.debug) {
            console.error('Parse error:', parseError);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 停止 CLI 进程
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    console.log('[InteractiveClient] Stopping CLI process...');

    // 优雅关闭：关闭 stdin，CLI 会自然退出
    this.process.stdin!.end();

    // 等待进程退出（最多 5 秒）
    const exitPromise = new Promise<void>((resolve) => {
      this.process!.once('exit', () => resolve());
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[InteractiveClient] Process did not exit gracefully, killing...');
        this.process!.kill('SIGTERM');
        resolve();
      }, 5000);
    });

    await Promise.race([exitPromise, timeoutPromise]);

    this.stdoutReader?.close();
    this.process = null;
    this.stdoutReader = null;
    this.isReady = false;

    console.log('[InteractiveClient] Stopped');
  }

  /**
   * 检查进程是否运行
   */
  isRunning(): boolean {
    return this.isReady && this.process !== null;
  }

  /**
   * 构建 CLI 参数
   */
  private buildCliArgs(): string[] {
    const args: string[] = [];

    // 交互模式（关键！）
    args.push('--prompt-interactive', ''); // 空 prompt 直接进入交互模式

    // 输出格式
    args.push('--output-format', 'stream-json');

    // 模型
    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    // 批准模式
    if (this.options.approvalMode) {
      args.push('--approval-mode', this.options.approvalMode);
    }

    // 允许的工具
    if (this.options.allowedTools && this.options.allowedTools.length > 0) {
      args.push('--allowed-tools', this.options.allowedTools.join(','));
    }

    // 恢复会话
    if (this.options.sessionId) {
      args.push('--resume', this.options.sessionId);
    } else if (this.options.resumeSessionId) {
      args.push('--resume', this.options.resumeSessionId);
    }

    // 调试模式
    if (this.options.debug) {
      args.push('--debug');
    }

    return args;
  }

  /**
   * 构建环境变量
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
    };

    if (this.options.apiKey) {
      env.GEMINI_API_KEY = this.options.apiKey;
    }

    return env;
  }

  /**
   * 等待 CLI 初始化完成（检测到 INIT 事件）
   */
  private async waitForInit(timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('CLI initialization timeout'));
      }, timeoutMs);

      const onLine = async (line: string) => {
        if (!line.trim()) return;

        try {
          const event = JSON.parse(line) as JsonStreamEvent;
          if (event.type === JsonStreamEventType.INIT) {
            clearTimeout(timeout);
            this.stdoutReader!.off('line', onLine);
            resolve();
          }
        } catch {
          // 忽略解析错误
        }
      };

      this.stdoutReader!.on('line', onLine);
    });
  }
}
```

### 4.2 向后兼容的 query 函数

为了保持 API 兼容性，保留原有的 `query()` 函数（冷启动模式）：

```typescript
// gemini-cli-sdk/src/index.ts
export { GeminiClient } from './client'; // 旧版：冷启动
export { GeminiInteractiveClient } from './interactiveClient'; // 新版：交互式
export { query } from './query'; // 保留原有函数
```

### 4.3 GeminiAdapter 改造

**文件**：`aoe-desktop/src/main/adapter/GeminiAdapter.ts`

```typescript
import { GeminiInteractiveClient } from '@ketd/gemini-cli-sdk';

export class GeminiAdapter extends EventEmitter implements IAgentAdapter {
  private client: GeminiInteractiveClient | null = null;

  async start(): Promise<void> {
    // 创建交互式客户端
    this.client = new GeminiInteractiveClient({
      pathToGeminiCLI: this.getGeminiCLIPath(),
      apiKey: this.config.apiKey,
      sessionId: this.currentSessionId,
      model: this.config.model,
      cwd: this.config.workingDirectory,
      approvalMode: this.mapApprovalMode(this.config.permissionMode),
      allowedTools: this.config.allowedTools,
      debug: false,
    });

    // 启动 CLI 进程
    await this.client.start();

    this.status = 'running';
    console.log('[GeminiAdapter] Started with interactive client');
  }

  async stop(force?: boolean): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.status = 'stopped';
  }

  // handleUserMessage 保持不变，继续使用 this.client.stream()
  private async handleUserMessage(message: ProtocolMessage): Promise<void> {
    // ... 与之前完全相同
    for await (const event of this.client!.stream(userContent)) {
      // 转换事件并发送...
    }
  }
}
```

---

## 5. 关键技术细节

### 5.1 stdin/stdout 通信模式

#### 消息边界

**问题**：stdin 是流式的，如何区分多条消息？

**解决**：使用**换行符**作为消息分隔符
- 每条用户消息以 `\n` 结尾
- CLI 检测到换行符后开始处理
- stdout 输出 JSONL（每行一个事件）

```typescript
// 发送消息
this.process.stdin!.write('你好\n');

// 接收响应（逐行读取）
for await (const line of this.stdoutReader) {
  const event = JSON.parse(line);
  yield event;
  if (event.type === 'result') break; // 本轮结束
}

// 发送下一条消息
this.process.stdin!.write('你叫什么名字\n');
```

#### 并发控制

**问题**：如果同时发送多条消息到 stdin，CLI 如何处理？

**解决**：SDK 端实现**串行化**
```typescript
private isProcessing: boolean = false;

async *stream(prompt: string) {
  // 等待上一个请求完成
  while (this.isProcessing) {
    await delay(100);
  }

  this.isProcessing = true;
  try {
    // 发送消息并接收响应...
  } finally {
    this.isProcessing = false;
  }
}
```

### 5.2 进程生命周期

#### 启动时机

```typescript
// GeminiAdapter.start() 时启动 CLI 进程
async start(): Promise<void> {
  this.client = new GeminiInteractiveClient({ ... });
  await this.client.start(); // 启动进程并等待就绪
  this.status = 'running';
}
```

#### 停止时机

```typescript
// GeminiAdapter.stop() 时停止 CLI 进程
async stop(): Promise<void> {
  await this.client.stop(); // 关闭 stdin，优雅退出
  this.status = 'stopped';
}
```

#### 崩溃恢复

```typescript
class GeminiInteractiveClient {
  constructor(options) {
    // 监听进程退出
    this.process.on('exit', (code) => {
      console.warn('[InteractiveClient] Process exited unexpectedly');
      this.emit('exit', code);
    });
  }
}

// Adapter 监听退出事件
this.client.on('exit', async (code) => {
  if (code !== 0) {
    console.error('[GeminiAdapter] CLI crashed, restarting...');
    await this.client.start(); // 自动重启
  }
});
```

### 5.3 会话恢复

利用 CLI 的 `--resume` 选项：

```bash
# 首次启动（创建新会话）
node gemini.js --prompt-interactive '' --output-format stream-json

# 后续启动（恢复会话）
node gemini.js --prompt-interactive '' --output-format stream-json --resume session-123
```

SDK 实现：
```typescript
const args = ['--prompt-interactive', ''];

if (this.options.sessionId) {
  args.push('--resume', this.options.sessionId);
}
```

---

## 6. 实施步骤

### Phase 1: SDK 交互式客户端 (第1-2天)

**目标**：实现 `GeminiInteractiveClient`，验证 stdin/stdout 通信

**任务**：
1. ✅ **创建 `interactiveClient.ts`**
   - 实现进程启动逻辑
   - 实现 stdin 消息发送
   - 实现 stdout JSONL 解析
   - 实现并发控制（串行化）

2. ✅ **测试通信**
   - 手动测试：启动 CLI 并通过 stdin 发送消息
   - 单元测试：验证 SDK 的 stream() 方法
   - 多轮对话测试：连续发送 3 条消息

**验证**：
```typescript
const client = new GeminiInteractiveClient({ ... });
await client.start();

for await (const event of client.stream('你好')) {
  console.log(event);
}

for await (const event of client.stream('你叫什么名字')) {
  console.log(event);
}

await client.stop();
```

**成功标准**：
- CLI 进程保持运行
- 可以连续发送多条消息
- 每条消息都收到完整响应

### Phase 2: Adapter 集成 (第3-4天)

**目标**：将 GeminiAdapter 切换到 `GeminiInteractiveClient`

**任务**：
1. ✅ **更新 GeminiAdapter**
   - 替换 `GeminiClient` 为 `GeminiInteractiveClient`
   - 调整 `start()` 和 `stop()` 逻辑
   - 保持其他代码不变

2. ✅ **更新 SDK 依赖**
   - 发布 SDK v0.2.0
   - 更新 AoE Desktop 的 `package.json`

3. ✅ **测试集成**
   - 在 AoE Desktop 中测试单会话
   - 测试多轮对话
   - 验证会话恢复

**成功标准**：
- 首次消息：~500ms（启动开销）
- 后续消息：<50ms（无启动开销）
- 进程保持运行，资源占用稳定

### Phase 3: 多会话支持 (第5-6天)

**目标**：支持多个并发会话（每个会话一个 CLI 进程）

**任务**：
1. ✅ **AdapterManager 验证**
   - 验证 AdapterManager 已支持多 Adapter 实例
   - 每个 Adapter 持有独立的 `GeminiInteractiveClient`

2. ✅ **测试多会话**
   - 创建 3 个 Tab，每个 Tab 一个会话
   - 同时发送消息到不同会话
   - 验证互不干扰

**成功标准**：
- 可以同时运行多个会话
- 每个会话的响应互不混淆
- 资源占用线性增长（每个会话 ~50-80MB）

### Phase 4: 错误处理与优化 (第7-8天)

**目标**：增强稳定性，优化性能

**任务**：
1. ✅ **进程崩溃恢复**
   - 监听进程 `exit` 事件
   - 自动重启机制
   - 重试失败的消息

2. ✅ **超时处理**
   - 消息发送超时（120 秒）
   - 进程启动超时（30 秒）
   - 优雅降级：超时后回退到冷启动模式

3. ✅ **性能优化**
   - 预热：Adapter start() 后立即发送测试消息
   - 内存优化：限制 stdout buffer 大小

**成功标准**：
- 进程崩溃后可以自动恢复
- 超时情况有明确的错误提示
- 资源占用稳定（无内存泄漏）

### Phase 5: 文档与发布 (第9-10天)

**目标**：完善文档，发布正式版本

**任务**：
1. ✅ **更新文档**
   - 更新 SDK README
   - 添加交互模式使用说明
   - 性能对比数据

2. ✅ **发布**
   - 发布 SDK v0.2.0 到 npm
   - 更新 AoE Desktop
   - 发布 Release Notes

**成功标准**：
- 文档完整清晰
- SDK 成功发布到 npm
- AoE Desktop 集成并验证通过

---

## 7. 性能预期

### 响应时间对比

| 场景 | 当前架构 (冷启动) | 交互模式 | 提升 |
|------|------------------|---------|------|
| 首次请求 | 600-800ms | 600-800ms | - |
| 第二次请求 | 600-800ms | 30-50ms | **12-26x** |
| 第三次请求 | 600-800ms | 30-50ms | **12-26x** |
| 会话恢复 | 700-900ms | 50-100ms | **7-18x** |

### 资源使用

- **单会话**：~50-80MB（进程 + 会话历史）
- **10 并发会话**：~500-800MB（每个独立进程）
- **CPU**：空闲时 <1%，对话时 5-15%

---

## 8. 风险与缓解

### 风险 1：stdin 输入缓冲

**风险**：CLI 的 stdin 缓冲区可能有限制

**缓解**：
- 测试大消息（>10KB）是否正常
- 如果有问题，实现分块发送

### 风险 2：stdout 解析错误

**风险**：CLI 可能输出非 JSON 内容（错误信息、警告等）

**缓解**：
- 严格解析 JSON，捕获 parse 错误
- 记录无法解析的行到日志
- 不因解析错误中断流

### 风险 3：进程僵死

**风险**：CLI 进程可能卡住不响应

**缓解**：
- 实现消息发送超时（120 秒）
- 超时后强制 kill 进程并重启
- 重试失败的消息

### 风险 4：多进程管理

**风险**：多个会话 = 多个进程，资源占用可能过高

**缓解**：
- 限制最大并发会话数（如 10 个）
- 实现空闲会话自动关闭（30 分钟无活动）
- 监控内存使用，超阈值时清理

---

## 9. 与 V1 方案对比

| 维度 | V1 (Daemon Server) | V2 (Interactive Mode) |
|------|-------------------|----------------------|
| **复杂度** | 高（需要实现 HTTP 服务器） | 低（利用 CLI 原生能力） |
| **CLI 修改** | 需要大量修改 | **零修改** ✅ |
| **维护成本** | 高（需要维护服务器代码） | 低（CLI 更新自动受益） |
| **性能** | 略优（HTTP 开销 <5ms） | 优秀（stdin/stdout <1ms） |
| **稳定性** | 一般（多组件协同） | 高（单进程通信） |
| **调试难度** | 高（后台进程日志难查看） | 低（前台进程，日志直观） |

**结论**：V2 方案更简单、更稳定、更易维护，是**明显更优的选择**。

---

## 10. 总结

这个重构方案通过利用 Gemini CLI 的**原生交互模式**，实现了持久进程通信，无需修改 CLI 源码。

**核心优势**：
- ✅ **零修改 CLI**：利用 `--prompt-interactive` 原生能力
- ✅ **简单可靠**：stdin/stdout 通信，成熟稳定
- ✅ **性能卓越**：后续请求 12-26 倍提速
- ✅ **易于维护**：代码量少，逻辑清晰
- ✅ **向后兼容**：保留旧 API，平滑迁移

**准备开始编码！** 🚀
