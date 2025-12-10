# Gemini CLI SDK - Daemon Mode 重构方案

## 1. 背景与问题

### 当前架构的问题

**现状**：SDK 每次调用 `client.stream()` 都会 `spawn()` 一个新的 Node.js 进程运行 Gemini CLI，导致：

1. **严重的冷启动延迟**：
   - 启动 Node.js 运行时：~100-200ms
   - 加载 CLI 代码和依赖：~200-300ms
   - 初始化 Gemini API 连接：~100-200ms
   - **总计：每次请求 400-700ms+ 的开销**

2. **资源浪费**：
   - 每次请求创建和销毁进程
   - 无法复用 API 连接
   - 会话状态需要反复从磁盘加载

3. **与直接使用 CLI 的性能差距**：
   - 用户在终端直接运行 `gemini --prompt-interactive` 只有首次启动开销
   - 后续对话几乎无延迟

### 目标

实现**常驻进程模式（Daemon Mode）**，让 Gemini CLI 进程保持运行，通过双向 IPC 通信：

- ✅ 首次启动后，后续请求零冷启动
- ✅ API 连接保持温热状态
- ✅ 会话状态在内存中，快速访问
- ✅ 支持多会话并发
- ✅ 进程生命周期可管理（启动、停止、重启）

---

## 2. Gemini CLI 源码分析

### 2.1 关键发现

#### ✅ **CLI 已具备持久会话能力**

**文件**：`packages/core/src/core/client.ts` (Lines 63-646)

`GeminiClient` 类设计上支持多轮对话：
```typescript
class GeminiClient {
  initialize() // 创建新会话
  resumeChat(history, sessionData) // 恢复会话
  sendMessageStream(prompt) // 流式发送消息（异步生成器）
}
```

**关键点**：
- `sendMessageStream()` 是异步生成器，可以被多次调用
- 每次调用会创建新的 API 流，但客户端实例保持存活
- 会话历史在内存中维护（`this.history`）

#### ✅ **完善的流式输出格式**

**文件**：`packages/core/src/output/stream-json-formatter.ts`

已实现 JSONL（Newline-Delimited JSON）输出格式：
```typescript
class StreamJsonFormatter {
  emitEvent(event: JsonStreamEvent): void {
    process.stdout.write(JSON.stringify(event) + '\n');
  }
}
```

**事件类型**：
- `INIT` - 会话初始化（包含 session_id, model 等元数据）
- `MESSAGE` - 用户/助手消息（支持 delta 增量输出）
- `TOOL_USE` - 工具调用
- `TOOL_RESULT` - 工具执行结果
- `THOUGHT` - 思考过程（我们已添加）
- `RESULT` - 最终结果（包含统计信息）

#### ✅ **会话持久化机制**

**文件**：`packages/core/src/services/chatRecordingService.ts`

```typescript
interface ConversationRecord {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: MessageRecord[];
  summary?: string;
}
```

- 会话文件存储在 `~/.gemini/tmp/<project_hash>/chats/`
- 支持 `--resume` 从文件恢复会话
- 消息、工具调用、token 使用都有记录

#### ❌ **缺失的部分：持久进程模式**

**文件**：`packages/cli/src/gemini.tsx` (Lines 289-677)

当前只有两种模式：
1. **Interactive Mode**（Lines 591-600）：使用 Ink React UI，全屏终端界面
2. **Non-Interactive Mode**（Lines 603-675）：单次执行后退出

**问题**：
- 没有 `--daemon` 或 `--server` 模式
- 没有 HTTP/IPC 服务器
- 没有"等待下一个请求"的循环逻辑

### 2.2 架构参考：A2A Server

**文件**：`packages/a2a-server/src/http/app.ts`

CLI 代码库中包含一个 A2A（Agent-to-Agent）HTTP 服务器实现：

```typescript
// Express 路由
app.post('/api/tasks/create', async (req, res) => {
  const taskId = crypto.randomUUID();
  const task = { id: taskId, state: 'pending', ... };
  tasks.set(taskId, task);

  // 异步执行任务
  executeTask(task);

  res.json({ taskId });
});

// 流式输出
app.get('/api/tasks/:id/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  // Server-Sent Events 流
});
```

**可借鉴的模式**：
- Express HTTP 服务器框架
- 任务队列 + 状态跟踪
- SSE（Server-Sent Events）流式输出
- 独立的任务执行逻辑

---

## 3. 重构方案设计

### 3.1 架构概览

```
┌───────────────────────────────────────────────────────────────────┐
│                    AoE Desktop (Electron)                          │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │          GeminiAdapter (Main Process)                     │    │
│  │  • 使用 GeminiDaemonClient                                │    │
│  │  • 管理进程生命周期                                        │    │
│  │  • 转换协议消息                                           │    │
│  └────────────────┬─────────────────────────────────────────┘    │
└───────────────────┼──────────────────────────────────────────────┘
                    │ IPC (HTTP/Unix Socket)
                    │
┌───────────────────▼──────────────────────────────────────────────┐
│              Gemini CLI Daemon Process                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Daemon Server                           │   │
│  │  • HTTP/IPC 服务器                                        │   │
│  │  • 请求路由和会话管理                                      │   │
│  │  • 流式响应转发                                           │   │
│  └────────────────┬─────────────────────────────────────────┘   │
│                   │                                               │
│  ┌────────────────▼─────────────────────────────────────────┐   │
│  │              Session Manager                              │   │
│  │  • 多会话并发支持                                          │   │
│  │  • 会话状态缓存 (内存 + 磁盘)                             │   │
│  │  • 超时清理机制                                           │   │
│  └────────────────┬─────────────────────────────────────────┘   │
│                   │                                               │
│  ┌────────────────▼─────────────────────────────────────────┐   │
│  │           GeminiClient Pool                               │   │
│  │  • 每个会话一个 GeminiClient 实例                         │   │
│  │  • 保持 API 连接温热                                      │   │
│  │  • 流式响应生成                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件设计

#### 3.2.1 Daemon Server (新增)

**文件**：`packages/cli/src/daemonServer.ts`

**职责**：
- 启动 HTTP/IPC 服务器
- 接收客户端请求
- 路由到对应会话处理器
- 流式返回响应

**API 设计**：

```typescript
// POST /session/create
// 创建新会话
{
  "workspaceId": "workspace-123",
  "sessionId": "session-456", // 可选，不提供则自动生成
  "model": "gemini-2.0-flash-exp",
  "cwd": "/path/to/workspace"
}
→ { "sessionId": "session-456" }

// POST /session/:sessionId/message
// 发送消息到会话
{
  "content": "帮我写一个 React 组件",
  "attachments": [...] // 可选
}
→ Stream<JsonStreamEvent> (JSONL 格式)

// POST /session/:sessionId/resume
// 恢复已有会话
{
  "resumeFrom": "session-789" // 或 "latest"
}
→ { "sessionId": "session-456", "resumedFrom": "session-789" }

// DELETE /session/:sessionId
// 关闭会话，释放资源
→ { "closed": true }

// GET /health
// 健康检查
→ { "status": "ok", "sessions": 3, "uptime": 12345 }
```

**实现要点**：
```typescript
class DaemonServer {
  private sessions: Map<string, SessionHandler>;
  private server: http.Server | net.Server;

  async start(port: number): Promise<void> {
    // 启动 HTTP 服务器（或 Unix socket）
  }

  async handleMessage(sessionId: string, content: string): AsyncGenerator<JsonStreamEvent> {
    const handler = this.getOrCreateSession(sessionId);
    yield* handler.sendMessage(content);
  }

  async cleanup(): Promise<void> {
    // 清理所有会话，优雅关闭
  }
}
```

#### 3.2.2 Session Handler (新增)

**文件**：`packages/core/src/daemon/sessionHandler.ts`

**职责**：
- 管理单个会话的生命周期
- 持有 GeminiClient 实例
- 处理消息发送和流式响应
- 实现超时清理

**实现**：
```typescript
class SessionHandler {
  private client: GeminiClient;
  private sessionId: string;
  private lastActivity: number;
  private abortController: AbortController | null;

  constructor(config: SessionConfig) {
    this.client = new GeminiClient(config);
    this.lastActivity = Date.now();
  }

  async initialize(): Promise<void> {
    await this.client.initialize();
  }

  async *sendMessage(content: string): AsyncGenerator<JsonStreamEvent> {
    this.lastActivity = Date.now();
    this.abortController = new AbortController();

    try {
      for await (const event of this.client.sendMessageStream(content)) {
        yield event;
      }
    } finally {
      this.abortController = null;
    }
  }

  async resume(fromSessionId: string): Promise<void> {
    // 从磁盘加载会话历史
    const history = await loadSessionHistory(fromSessionId);
    await this.client.resumeChat(history.clientHistory, history);
  }

  cancel(): void {
    this.abortController?.abort();
  }

  isIdle(timeoutMs: number): boolean {
    return Date.now() - this.lastActivity > timeoutMs;
  }

  async dispose(): Promise<void> {
    this.cancel();
    // 清理资源
  }
}
```

#### 3.2.3 Session Manager (新增)

**文件**：`packages/core/src/daemon/sessionManager.ts`

**职责**：
- 管理所有活跃会话
- 会话创建和销毁
- 超时清理机制
- 并发控制

**实现**：
```typescript
class SessionManager {
  private sessions: Map<string, SessionHandler>;
  private cleanupInterval: NodeJS.Timeout;
  private maxIdleTime: number = 30 * 60 * 1000; // 30 分钟
  private maxConcurrentSessions: number = 10;

  constructor() {
    this.sessions = new Map();
    this.startCleanupTimer();
  }

  async createSession(sessionId: string, config: SessionConfig): Promise<SessionHandler> {
    if (this.sessions.size >= this.maxConcurrentSessions) {
      await this.cleanupIdleSessions(true); // 强制清理
    }

    const handler = new SessionHandler(config);
    await handler.initialize();
    this.sessions.set(sessionId, handler);
    return handler;
  }

  getSession(sessionId: string): SessionHandler | undefined {
    return this.sessions.get(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const handler = this.sessions.get(sessionId);
    if (handler) {
      await handler.dispose();
      this.sessions.delete(sessionId);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleSessions(false);
    }, 5 * 60 * 1000); // 每 5 分钟检查一次
  }

  private async cleanupIdleSessions(force: boolean): Promise<void> {
    const now = Date.now();
    for (const [id, handler] of this.sessions.entries()) {
      if (force || handler.isIdle(this.maxIdleTime)) {
        console.log(`[SessionManager] Cleaning up idle session: ${id}`);
        await this.closeSession(id);
      }
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.cleanupInterval);
    await Promise.all(
      Array.from(this.sessions.keys()).map(id => this.closeSession(id))
    );
  }
}
```

#### 3.2.4 Daemon Client (SDK 新增)

**文件**：`gemini-cli-sdk/src/daemonClient.ts`

**职责**：
- 启动和管理 Daemon 进程
- 通过 HTTP/IPC 发送请求
- 接收并解析流式响应
- 进程健康检查和重启

**实现**：
```typescript
export class GeminiDaemonClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private serverUrl: string;
  private sessionId: string;
  private isReady: boolean = false;

  constructor(private options: GeminiDaemonOptions) {
    super();
    this.serverUrl = options.serverUrl || 'http://localhost:3737';
    this.sessionId = options.sessionId;
  }

  /**
   * 启动 Daemon 进程（如果未运行）
   */
  async start(): Promise<void> {
    // 1. 检查 Daemon 是否已运行
    if (await this.checkHealth()) {
      console.log('[DaemonClient] Daemon already running');
      this.isReady = true;
      return;
    }

    // 2. 启动新的 Daemon 进程
    console.log('[DaemonClient] Starting daemon process...');
    this.process = spawn('node', [
      this.options.pathToGeminiCLI,
      '--daemon',
      '--daemon-port', this.getDaemonPort(),
      '--config-dir', this.options.configDir || getDefaultConfigDir(),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.buildEnv(),
      detached: true, // 独立进程组，可以在父进程退出后继续运行
    });

    // 3. 等待 Daemon 就绪
    await this.waitForReady();

    // 4. 创建会话
    await this.createSession();

    this.isReady = true;
  }

  /**
   * 发送消息并流式接收响应
   */
  async *stream(prompt: string): AsyncGenerator<JsonStreamEvent> {
    if (!this.isReady) {
      throw new Error('Daemon not ready. Call start() first.');
    }

    const url = `${this.serverUrl}/session/${this.sessionId}/message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: prompt }),
    });

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.statusText}`);
    }

    // 解析 JSONL 流
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留最后一个不完整的行

      for (const line of lines) {
        if (line.trim()) {
          const event = JSON.parse(line) as JsonStreamEvent;
          yield event;
        }
      }
    }
  }

  /**
   * 停止 Daemon（可选：只关闭会话而不停止进程）
   */
  async stop(killDaemon: boolean = false): Promise<void> {
    // 关闭会话
    if (this.isReady) {
      try {
        await fetch(`${this.serverUrl}/session/${this.sessionId}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('[DaemonClient] Failed to close session:', error);
      }
    }

    // 停止 Daemon 进程（可选）
    if (killDaemon && this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    this.isReady = false;
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000), // 1 秒超时
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (await this.checkHealth()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Daemon failed to start within timeout');
  }

  private async createSession(): Promise<void> {
    const url = `${this.serverUrl}/session/create`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        workspaceId: this.options.workspaceId,
        model: this.options.model,
        cwd: this.options.cwd,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }
  }

  private getDaemonPort(): string {
    const url = new URL(this.serverUrl);
    return url.port || '3737';
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GEMINI_API_KEY: this.options.apiKey,
      // 其他环境变量...
    };
  }
}
```

#### 3.2.5 GeminiAdapter 改造

**文件**：`aoe-desktop/src/main/adapter/GeminiAdapter.ts`

**改动**：
- 将 `GeminiClient` 替换为 `GeminiDaemonClient`
- `start()` 方法启动 Daemon 进程
- `stop()` 方法关闭会话（进程可选保持运行）
- 其他逻辑保持不变

```typescript
export class GeminiAdapter extends EventEmitter implements IAgentAdapter {
  private client: GeminiDaemonClient | null = null;

  async start(): Promise<void> {
    // 创建 Daemon Client（会自动启动进程或连接到已有进程）
    this.client = new GeminiDaemonClient({
      pathToGeminiCLI: this.getGeminiCLIPath(),
      apiKey: this.config.apiKey,
      sessionId: this.config.sessionId,
      workspaceId: this.config.workspaceId,
      model: this.config.model,
      cwd: this.config.workingDirectory,
      configDir: this.geminiConfigDir,
    });

    await this.client.start();
    this.status = 'running';
  }

  async stop(force?: boolean): Promise<void> {
    if (this.client) {
      // 关闭会话，但保持 Daemon 运行（供其他会话使用）
      await this.client.stop(false);
      this.client = null;
    }
    this.status = 'stopped';
  }

  // handleUserMessage 保持不变，继续使用 this.client.stream()
}
```

---

## 4. 实施步骤

### Phase 1: Daemon Server 基础 (第1-2天)

**目标**：实现基本的 Daemon 服务器，支持单会话

**任务**：
1. ✅ **添加 `--daemon` 模式到 CLI**
   - 修改 `packages/cli/src/config/config.ts`：添加 `--daemon`, `--daemon-port` 参数
   - 修改 `packages/cli/src/gemini.tsx`：添加 daemon 模式分支

2. ✅ **实现 DaemonServer**
   - 创建 `packages/cli/src/daemonServer.ts`
   - 使用 Express 搭建 HTTP 服务器
   - 实现 `/health` 端点
   - 实现 `/session/create` 端点（单会话版本）

3. ✅ **实现 SessionHandler**
   - 创建 `packages/core/src/daemon/sessionHandler.ts`
   - 封装 GeminiClient 的初始化和消息发送
   - 实现流式响应转发（JSONL）

4. ✅ **测试**
   - 手动启动 Daemon：`node gemini.js --daemon --daemon-port 3737`
   - 使用 `curl` 测试 API 端点
   - 验证流式输出格式正确

**成功标准**：
- Daemon 可以启动并响应 `/health` 请求
- 可以创建会话并发送消息
- 流式响应格式与原 `--output-format stream-json` 一致

### Phase 2: SDK Daemon Client (第3-4天)

**目标**：实现 SDK 的 DaemonClient，可以启动和管理 Daemon

**任务**：
1. ✅ **创建 GeminiDaemonClient**
   - 创建 `gemini-cli-sdk/src/daemonClient.ts`
   - 实现进程启动逻辑（spawn + detached）
   - 实现健康检查和就绪等待
   - 实现 HTTP 请求发送和流式响应解析

2. ✅ **导出新 API**
   - 修改 `gemini-cli-sdk/src/index.ts`：导出 `GeminiDaemonClient`
   - 添加类型定义到 `gemini-cli-sdk/src/types.ts`

3. ✅ **测试**
   - 编写单元测试（`tests/daemonClient.test.ts`）
   - 验证进程启动、请求发送、流式接收、进程停止

**成功标准**：
- SDK 可以自动启动 Daemon 进程
- 可以发送消息并接收流式响应
- 进程可以被正确停止或保持运行

### Phase 3: 多会话支持 (第5-6天)

**目标**：支持多个并发会话，实现会话管理

**任务**：
1. ✅ **实现 SessionManager**
   - 创建 `packages/core/src/daemon/sessionManager.ts`
   - 管理多个 SessionHandler 实例
   - 实现超时清理机制
   - 实现并发控制（最大会话数限制）

2. ✅ **扩展 DaemonServer**
   - 修改 `packages/cli/src/daemonServer.ts`
   - 使用 SessionManager 管理多会话
   - 实现 `/session/:id/message` 路由
   - 实现 `DELETE /session/:id` 路由

3. ✅ **会话恢复支持**
   - 实现 `POST /session/:id/resume` 端点
   - 利用现有的 `ChatRecordingService` 加载历史

**成功标准**：
- 可以同时运行多个会话
- 空闲会话会被自动清理
- 会话可以从历史恢复

### Phase 4: Adapter 集成 (第7天)

**目标**：将 GeminiAdapter 切换到 DaemonClient

**任务**：
1. ✅ **更新 GeminiAdapter**
   - 修改 `aoe-desktop/src/main/adapter/GeminiAdapter.ts`
   - 替换 `GeminiClient` 为 `GeminiDaemonClient`
   - 调整 `start()` 和 `stop()` 逻辑

2. ✅ **更新 SDK 依赖**
   - 发布新版本 SDK（v0.2.0）
   - 更新 AoE Desktop 的 `package.json`

3. ✅ **测试集成**
   - 在 AoE Desktop 中测试多会话场景
   - 验证进程生命周期管理
   - 性能基准测试（对比冷启动 vs 常驻模式）

**成功标准**：
- 首次消息有启动开销（~500ms）
- 后续消息无延迟（<50ms 开销）
- 多个 Tab/Workspace 可以并发对话

### Phase 5: 优化与监控 (第8-9天)

**目标**：优化性能，添加监控和调试工具

**任务**：
1. ✅ **性能优化**
   - 预热机制：启动时立即初始化一个会话
   - 连接池：复用 API 连接
   - 内存优化：限制会话历史长度

2. ✅ **监控与调试**
   - 添加 `/metrics` 端点（会话数、内存使用、请求数等）
   - 添加详细日志（可通过环境变量控制级别）
   - 实现进程崩溃自动重启机制

3. ✅ **错误处理**
   - Daemon 崩溃后自动重启
   - 网络错误重试机制
   - 优雅降级：Daemon 不可用时回退到冷启动模式

**成功标准**：
- 可以通过 `/metrics` 监控 Daemon 状态
- 进程崩溃后可以自动恢复
- 错误日志清晰，便于排查问题

### Phase 6: 文档与发布 (第10天)

**目标**：完善文档，发布正式版本

**任务**：
1. ✅ **更新文档**
   - 更新 SDK README（添加 Daemon 模式使用说明）
   - 添加架构图和性能对比
   - 编写迁移指南（从旧版 SDK 迁移）

2. ✅ **发布**
   - 发布 SDK v0.2.0 到 npm
   - 更新 AoE Desktop 到新版本
   - 发布 Release Notes

**成功标准**：
- 文档完整，用户可以轻松理解和使用
- SDK 发布到 npm
- AoE Desktop 集成并验证通过

---

## 5. 技术细节

### 5.1 进程生命周期管理

#### Daemon 启动选项

```bash
# 前台运行（开发调试）
node gemini.js --daemon --daemon-port 3737

# 后台运行（生产环境）
node gemini.js --daemon --daemon-port 3737 --daemon-detach

# 指定配置目录
node gemini.js --daemon --config-dir /path/to/config
```

#### 进程检测与复用

```typescript
async function ensureDaemonRunning(port: number): Promise<boolean> {
  // 1. 尝试连接到已有 Daemon
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      console.log('[DaemonClient] Connected to existing daemon');
      return true;
    }
  } catch {
    // Daemon 不存在，需要启动
  }

  // 2. 启动新 Daemon
  const process = spawn('node', [cliPath, '--daemon', '--daemon-port', port], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  process.unref(); // 允许父进程退出而不等待 Daemon

  // 3. 等待就绪
  return await waitForDaemonReady(port, 10000);
}
```

#### 优雅关闭

```typescript
// DaemonServer
async shutdown(signal: string): Promise<void> {
  console.log(`[DaemonServer] Received ${signal}, shutting down...`);

  // 1. 停止接收新请求
  this.server.close();

  // 2. 等待所有活跃会话完成（最多 30 秒）
  await this.sessionManager.gracefulShutdown(30000);

  // 3. 退出进程
  process.exit(0);
}

// 注册信号处理
process.on('SIGTERM', () => server.shutdown('SIGTERM'));
process.on('SIGINT', () => server.shutdown('SIGINT'));
```

### 5.2 流式响应处理

#### Server 端（JSONL 输出）

```typescript
// Express handler
app.post('/session/:sessionId/message', async (req, res) => {
  const { sessionId } = req.params;
  const { content } = req.body;

  res.setHeader('Content-Type', 'application/x-ndjson'); // Newline-Delimited JSON
  res.setHeader('Transfer-Encoding', 'chunked');

  const handler = sessionManager.getSession(sessionId);
  if (!handler) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    for await (const event of handler.sendMessage(content)) {
      res.write(JSON.stringify(event) + '\n');
    }
    res.end();
  } catch (error) {
    res.write(JSON.stringify({
      type: 'error',
      error: { message: error.message },
      timestamp: new Date().toISOString(),
    }) + '\n');
    res.end();
  }
});
```

#### Client 端（流式解析）

```typescript
async *parseJsonlStream(response: Response): AsyncGenerator<JsonStreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留不完整行

    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line) as JsonStreamEvent;
          yield event;
        } catch (error) {
          console.error('[DaemonClient] Failed to parse JSON:', line);
        }
      }
    }
  }

  // 处理剩余 buffer
  if (buffer.trim()) {
    yield JSON.parse(buffer);
  }
}
```

### 5.3 会话超时与清理

```typescript
class SessionManager {
  private cleanupIntervalMs = 5 * 60 * 1000; // 5 分钟
  private maxIdleTimeMs = 30 * 60 * 1000; // 30 分钟无活动

  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupIdleSessions();
    }, this.cleanupIntervalMs);
  }

  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const sessionsToClean: string[] = [];

    for (const [id, handler] of this.sessions.entries()) {
      if (now - handler.lastActivity > this.maxIdleTimeMs) {
        sessionsToClean.push(id);
      }
    }

    for (const id of sessionsToClean) {
      console.log(`[SessionManager] Cleaning up idle session: ${id}`);
      await this.closeSession(id);
    }
  }
}
```

### 5.4 错误处理与重试

#### Daemon 崩溃自动重启

```typescript
class GeminiDaemonClient {
  private maxRestartAttempts = 3;
  private restartAttempts = 0;

  async *stream(prompt: string): AsyncGenerator<JsonStreamEvent> {
    try {
      yield* this.streamInternal(prompt);
    } catch (error) {
      if (this.shouldRestart(error)) {
        console.warn('[DaemonClient] Daemon connection lost, restarting...');
        await this.restart();

        // 重试请求
        yield* this.streamInternal(prompt);
      } else {
        throw error;
      }
    }
  }

  private shouldRestart(error: any): boolean {
    // ECONNREFUSED, ECONNRESET 等网络错误
    return (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.message.includes('fetch failed')
    ) && this.restartAttempts < this.maxRestartAttempts;
  }

  private async restart(): Promise<void> {
    this.restartAttempts++;
    await this.stop(true); // 强制停止旧进程
    await this.start(); // 启动新进程
  }
}
```

### 5.5 监控与指标

```typescript
// GET /metrics
app.get('/metrics', (req, res) => {
  const metrics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: {
      total: sessionManager.getSessionCount(),
      active: sessionManager.getActiveSessionCount(),
      idle: sessionManager.getIdleSessionCount(),
    },
    requests: {
      total: requestCounter,
      success: successCounter,
      errors: errorCounter,
    },
  };

  res.json(metrics);
});
```

---

## 6. 性能基准

### 预期性能提升

| 场景 | 当前架构 (冷启动) | Daemon 模式 | 提升 |
|------|------------------|-------------|------|
| 首次请求 | 600-800ms | 600-800ms | - |
| 第二次请求 | 600-800ms | 30-50ms | **12-26x** |
| 第三次请求 | 600-800ms | 30-50ms | **12-26x** |
| 会话恢复 | 700-900ms | 50-100ms | **7-18x** |

### 内存使用

- **单会话**：~50-80MB（GeminiClient + 历史）
- **10 并发会话**：~500-800MB
- **超时清理后**：自动释放回 ~50MB

---

## 7. 向后兼容性

### 保留旧 API

SDK 将同时提供两种客户端：

```typescript
// 旧版：冷启动模式（保持向后兼容）
import { GeminiClient } from '@ketd/gemini-cli-sdk';
const client = new GeminiClient({ ... });

// 新版：Daemon 模式
import { GeminiDaemonClient } from '@ketd/gemini-cli-sdk';
const daemonClient = new GeminiDaemonClient({ ... });
```

### 迁移建议

1. **开发环境**：立即切换到 Daemon 模式，提升开发体验
2. **生产环境**：先在测试环境验证稳定性，再逐步迁移
3. **回退方案**：保留冷启动模式作为 fallback

---

## 8. 风险与缓解

### 风险 1：进程管理复杂度

**风险**：Daemon 进程可能因各种原因崩溃或僵死

**缓解**：
- 实现健壮的健康检查机制
- 自动重启逻辑
- 降级到冷启动模式

### 风险 2：资源泄漏

**风险**：长期运行的进程可能累积内存泄漏

**缓解**：
- 定期清理空闲会话
- 限制会话历史长度
- 监控内存使用，超阈值时重启

### 风险 3：并发竞争

**风险**：多个客户端同时启动 Daemon 可能导致端口冲突

**缓解**：
- 使用文件锁保证单例
- 端口冲突时自动选择新端口
- 客户端检测已有 Daemon 并复用

### 风险 4：调试困难

**风险**：后台进程的日志难以查看

**缓解**：
- 日志输出到文件（`~/.gemini/daemon.log`）
- 提供 `--daemon-foreground` 选项用于调试
- 详细的错误信息和堆栈跟踪

---

## 9. 开发约定

### 代码风格

- 遵循现有 Gemini CLI 的 TypeScript 风格
- 使用 async/await，避免回调
- 详细的 JSDoc 注释

### 测试要求

- 每个新模块至少 80% 覆盖率
- 集成测试覆盖关键流程
- 性能测试验证提升效果

### 提交规范

```
feat(daemon): add DaemonServer implementation
fix(sdk): handle connection timeout gracefully
docs(readme): add daemon mode usage guide
```

---

## 10. 总结

这个重构方案将彻底解决冷启动问题，使 AoE Desktop 的响应速度与直接使用 Gemini CLI 一致。通过常驻进程模式，后续请求的延迟将从 600-800ms 降低到 30-50ms，提升 **12-26倍**。

关键优势：
- ✅ **零冷启动**：首次启动后，后续请求几乎无延迟
- ✅ **多会话并发**：支持多个 Tab/Workspace 同时对话
- ✅ **资源高效**：进程复用，内存可控
- ✅ **向后兼容**：保留旧 API，平滑迁移
- ✅ **可监控**：详细的指标和日志

**准备开始编码！** 🚀
