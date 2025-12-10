# Stream Client 方案 - 进程模型说明

## 进程架构

### 推荐模型: **1 Client = 1 Process**

```
┌─────────────────────────────────────────────────────────────┐
│           AoE Desktop (Electron Main Process)                │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │  GeminiAdapter   │  │  GeminiAdapter   │  │  Gemini... │ │
│  │   (Session 1)    │  │   (Session 2)    │  │ (Session N)│ │
│  │                  │  │                  │  │            │ │
│  │ GeminiStream     │  │ GeminiStream     │  │ GeminiStr..│ │
│  │    Client        │  │    Client        │  │            │ │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬─────┘ │
│           │                     │                    │       │
└───────────┼─────────────────────┼────────────────────┼───────┘
            │                     │                    │
            │ spawn               │ spawn              │ spawn
            │                     │                    │
┌───────────▼─────────┐ ┌─────────▼──────────┐ ┌──────▼──────┐
│  Gemini CLI         │ │  Gemini CLI        │ │  Gemini CLI │
│  Process 1          │ │  Process 2         │ │  Process N  │
│  (PID: 12345)       │ │  (PID: 12346)      │ │  (PID: ...) │
│                     │ │                    │ │             │
│  Session: abc123    │ │  Session: def456   │ │  Session:.. │
│  Workspace: foo/    │ │  Workspace: bar/   │ │  Workspace..│
└─────────────────────┘ └────────────────────┘ └─────────────┘
```

### 关键特征

1. **独立进程**: 每个 `GeminiStreamClient` 实例启动一个独立的 Node.js 进程
2. **会话隔离**: 每个进程管理一个会话,完全隔离
3. **并发安全**: 多个 Tab/Workspace 可以同时运行,互不干扰
4. **独立生命周期**:
   - Session 关闭 → Client.stop() → Process 被 kill
   - Session 创建 → Client.start() → spawn 新 Process

## 与 Claude SDK 的对比

### Claude Agent SDK (参考实现)

```python
# 每个会话一个进程
async with ClaudeSDKClient(options) as client:  # ← spawn process
    await client.query("First message")
    await client.query("Second message")
# ← 退出上下文,kill process

# 多会话 = 多进程
client1 = ClaudeSDKClient(...)  # Process 1
client2 = ClaudeSDKClient(...)  # Process 2
```

### Gemini Stream Client (我们的实现)

```typescript
// 每个会话一个进程
const client1 = new GeminiStreamClient({
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
});
await client1.start();  // ← spawn process 1

const client2 = new GeminiStreamClient({
  sessionId: 'session-2',
  workspaceId: 'workspace-2',
});
await client2.start();  // ← spawn process 2

// 两个进程并发运行
await client1.sendMessage("Hello from session 1");
await client2.sendMessage("Hello from session 2");

// 关闭会话
await client1.stop();  // ← kill process 1
await client2.stop();  // ← kill process 2
```

## 在 AoE Desktop 中的应用

### 当前架构

```typescript
// aoe-desktop/src/main/adapter/GeminiAdapter.ts

export class GeminiAdapter extends EventEmitter implements IAgentAdapter {
  private client: GeminiStreamClient | null = null;

  async start(): Promise<void> {
    // 每个 Adapter 启动一个独立的 CLI 进程
    this.client = new GeminiStreamClient({
      pathToGeminiCLI: this.getGeminiCLIPath(),
      apiKey: this.config.apiKey,
      sessionId: this.config.sessionId,      // ← 唯一会话 ID
      workspaceId: this.config.workspaceId,  // ← 工作区 ID
      model: this.config.model,
      cwd: this.config.workingDirectory,
    });

    await this.client.start();  // ← spawn 进程
    this.status = 'running';
  }

  async stop(force?: boolean): Promise<void> {
    if (this.client) {
      await this.client.stop();  // ← kill 进程
      this.client = null;
    }
    this.status = 'stopped';
  }
}
```

### 多 Tab 场景

用户打开 3 个 Tab,每个 Tab 一个 Workspace:

```typescript
// Tab 1: Workspace A
const adapter1 = adapterManager.createAdapter('gemini-cli', {
  sessionId: 'session-a',
  workspaceId: 'workspace-a',
});
await adapter1.start();  // → spawn Process 1 (PID: 12345)

// Tab 2: Workspace B
const adapter2 = adapterManager.createAdapter('gemini-cli', {
  sessionId: 'session-b',
  workspaceId: 'workspace-b',
});
await adapter2.start();  // → spawn Process 2 (PID: 12346)

// Tab 3: Workspace C
const adapter3 = adapterManager.createAdapter('gemini-cli', {
  sessionId: 'session-c',
  workspaceId: 'workspace-c',
});
await adapter3.start();  // → spawn Process 3 (PID: 12347)

// 三个进程并发运行,互不干扰
```

## 进程管理

### 生命周期

```typescript
// GeminiStreamClient 内部

async start(): Promise<void> {
  // 1. Spawn 进程
  this.process = spawn('node', [
    this.options.pathToGeminiCLI,
    '--stream-json-input',
    '--output-format', 'stream-json',
    '--model', this.options.model,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: this.buildEnv(),
  });

  // 2. 设置 stdin/stdout 流
  this.stdinStream = this.process.stdin!;
  this.readlineInterface = readline.createInterface({
    input: this.process.stdout!,
    terminal: false,
  });

  // 3. 启动读取循环
  this.startReadLoop();

  // 4. 等待 INIT 事件
  await this.waitForInit();
}

async stop(): Promise<void> {
  // 1. 关闭 stdin (优雅关闭)
  if (this.stdinStream) {
    this.stdinStream.end();
  }

  // 2. 等待进程退出 (timeout: 5s)
  await Promise.race([
    new Promise(resolve => this.process!.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);

  // 3. 强制 kill (如果还没退出)
  if (this.process && !this.process.killed) {
    this.process.kill('SIGTERM');
  }

  this.process = null;
}
```

### 超时清理 (SessionLifecycleManager)

```typescript
// aoe-desktop/src/main/adapter/SessionLifecycleManager.ts

class SessionLifecycleManager {
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 分钟

  recordActivity(sessionId: string): void {
    // 重置超时
    this.clearTimeout(sessionId);

    const timeout = setTimeout(() => {
      console.log(`[SessionLifecycleManager] Session ${sessionId} idle, closing...`);
      this.closeSession(sessionId);
    }, this.IDLE_TIMEOUT);

    this.sessionTimeouts.set(sessionId, timeout);
  }

  async closeSession(sessionId: string): Promise<void> {
    // 清理超时
    this.clearTimeout(sessionId);

    // 停止 Adapter (会 kill 进程)
    await this.adapterManager.destroyAdapter(sessionId);
  }
}
```

## 资源使用

### 内存占用

```
单个 Gemini CLI 进程: ~100-150MB
10 个并发会话: ~1-1.5GB

对比:
- VS Code Electron: ~500MB-1GB
- Chrome Tab: ~100-200MB/Tab
```

### 进程数限制

**建议**: 最多 10-20 个并发会话

**原因**:
- 每个进程 ~100MB 内存
- 10 个进程 = ~1GB (可接受)
- 超过 20 个会影响系统性能

**实现**:
```typescript
// AdapterManager.ts

const MAX_CONCURRENT_SESSIONS = 10;

createAdapter(type, config): IAgentAdapter {
  if (this.adapters.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error('Maximum concurrent sessions reached');
  }
  // ...
}
```

## 优势

### ✅ 简单可靠

1. **1:1 映射**: 1 Client = 1 Process = 1 Session
2. **无状态共享**: 进程隔离,无竞争条件
3. **独立崩溃**: 一个进程崩溃不影响其他进程

### ✅ 易于调试

```bash
# 查看所有 Gemini 进程
ps aux | grep "gemini.js --stream-json-input"

# 输出示例:
# PID: 12345, Session: abc123, Workspace: /foo
# PID: 12346, Session: def456, Workspace: /bar
```

### ✅ 符合业界标准

- **Claude SDK**: 1 Client = 1 Process
- **Docker**: 1 Container = 1 Process 模型
- **Unix 哲学**: Do one thing well

## 与原 Daemon 方案的对比

### Daemon 方案 (V1 - 已废弃)

```
┌──────────────────────────────────────┐
│    Single Daemon Process (HTTP)      │
│  ┌────────────────────────────────┐  │
│  │      Session Manager           │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐  │  │
│  │  │ S1   │ │ S2   │ │ S3   │  │  │  ← 多会话共享一个进程
│  │  └──────┘ └──────┘ └──────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

**问题**:
- ❌ 复杂的会话管理
- ❌ HTTP 服务器开销
- ❌ 端口管理
- ❌ 会话隔离复杂
- ❌ 调试困难

### Stream Client 方案 (V3 - 推荐)

```
Process 1    Process 2    Process 3
Session 1    Session 2    Session 3
```

**优势**:
- ✅ 简单的 1:1 映射
- ✅ 无 HTTP 开销
- ✅ 无端口管理
- ✅ 天然隔离
- ✅ 易于调试

## 总结

### 推荐的进程模型

**1 GeminiStreamClient = 1 Node.js Process = 1 Session**

### 特点

- ✅ **简单**: 1:1 映射,无共享状态
- ✅ **可靠**: 进程隔离,独立崩溃
- ✅ **高效**: stdin/stdout 零开销
- ✅ **可扩展**: 支持 10-20 并发会话
- ✅ **易维护**: 符合业界标准 (Claude SDK)

### 资源占用

- 单进程: ~100MB
- 10 并发: ~1GB (可接受)
- 超时清理: 30 分钟无活动自动关闭

这就是为什么这个方案比 Daemon 方案简单 10 倍的原因 - **去除了所有多会话共享进程的复杂性**!
