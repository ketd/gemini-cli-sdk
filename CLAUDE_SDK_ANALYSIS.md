# Claude Agent SDK Python - 架构分析

## 概述

Claude Agent SDK Python 展示了一个**完全不同于我们原计划的架构**:

- **无 Daemon 模式**: SDK 每次都启动新的 CLI 进程
- **使用双向流式通信**: 通过 stdin/stdout 进行 JSONL (Newline-Delimited JSON) 通信
- **控制协议 (Control Protocol)**: SDK 与 CLI 之间有一套完整的请求/响应协议

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Python SDK (ClaudeSDKClient)               │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Query (Control Protocol)               │    │
│  │  • initialize() - 初始化握手                         │    │
│  │  • 控制请求/响应路由                                  │    │
│  │  • Hook callbacks                                  │    │
│  │  • 消息流管理                                         │    │
│  └──────────────┬─────────────────────────────────────┘    │
│                 │                                            │
│  ┌──────────────▼─────────────────────────────────────┐    │
│  │        SubprocessCLITransport                       │    │
│  │  • spawn CLI 进程 (每次调用)                         │    │
│  │  • stdin/stdout/stderr 管理                         │    │
│  │  • JSONL 流式解析                                   │    │
│  └──────────────┬─────────────────────────────────────┘    │
└─────────────────┼──────────────────────────────────────────┘
                  │ subprocess (stdin/stdout)
                  │ JSONL (Newline-Delimited JSON)
                  │
┌─────────────────▼──────────────────────────────────────────┐
│              Claude Code CLI Process                        │
│  • 接收 --input-format stream-json 模式                     │
│  • 输出 --output-format stream-json                        │
│  • 持久化运行（在流式模式下）                               │
│  • 支持控制协议 (Control Protocol)                         │
└─────────────────────────────────────────────────────────────┘
```

## 关键发现

### 1. **CLI 启动模式**

**代码**: `subprocess_cli.py:172-367` (`_build_command()`)

Claude CLI 支持两种输入模式:

```python
# 模式 1: 单次执行 (Non-streaming)
cmd = [cli_path, '--output-format', 'stream-json', '--print', '--', prompt]

# 模式 2: 流式双向通信 (Streaming)
cmd = [cli_path, '--output-format', 'stream-json', '--input-format', 'stream-json']
```

**关键差异**:
- `--print` 模式: CLI 执行单个 prompt 后退出
- `--input-format stream-json` 模式: CLI 持续运行,从 stdin 读取 JSONL 消息

### 2. **stdin/stdout 双向流式通信**

**代码**: `subprocess_cli.py:403-431` (`connect()`)

```python
self._process = await anyio.open_process(
    cmd,
    stdin=PIPE,
    stdout=PIPE,
    stderr=PIPE,
    cwd=self._cwd,
    env=process_env,
)

# 设置双向流
self._stdout_stream = TextReceiveStream(self._process.stdout)
self._stdin_stream = TextSendStream(self._process.stdin)
```

**通信格式**: JSONL (每行一个 JSON 对象)

发送到 CLI (stdin):
```json
{"type": "user", "message": {"role": "user", "content": "Hello"}, "session_id": "default"}
{"type": "control_request", "subtype": "initialize", "hooks": {...}}
{"type": "control_request", "subtype": "interrupt"}
```

从 CLI 接收 (stdout):
```json
{"type": "init", "session_id": "abc123", "model": "claude-sonnet-4-5"}
{"type": "message", "role": "assistant", "content": "Hello!"}
{"type": "tool_use", "name": "read_file", "input": {...}}
{"type": "result", "total_cost_usd": 0.015}
{"type": "control_response", "response": {...}}
```

### 3. **控制协议 (Control Protocol)**

**代码**: `query.py:53-673`

SDK 与 CLI 之间有一套完整的**双向控制协议**:

#### SDK → CLI 控制请求:

```typescript
// 初始化握手
{
  type: "control_request",
  request: {
    subtype: "initialize",
    hooks: {...},
    request_id: "req_1"
  }
}

// 中断当前操作
{
  type: "control_request",
  request: {
    subtype: "interrupt",
    request_id: "req_2"
  }
}

// 修改权限模式
{
  type: "control_request",
  request: {
    subtype: "set_permission_mode",
    mode: "acceptEdits",
    request_id: "req_3"
  }
}
```

#### CLI → SDK 控制请求:

```typescript
// 工具权限请求 (SDK 决定是否允许)
{
  type: "control_request",
  request: {
    subtype: "permission_request",
    tool_name: "write_file",
    parameters: {...},
    request_id: "cli_req_1"
  }
}

// Hook 回调请求
{
  type: "control_request",
  request: {
    subtype: "hook_callback",
    callback_id: "hook_0",
    event: "before_tool_call",
    data: {...},
    request_id: "cli_req_2"
  }
}
```

#### 控制响应:

```typescript
{
  type: "control_response",
  response: {
    request_id: "req_1",  // 对应请求的 ID
    subtype: "initialize",
    commands: [...],
    output_style: {...}
  }
}
```

**实现细节** (`query.py:116-158`):

```python
async def initialize(self) -> dict[str, Any] | None:
    # 构建 hooks 配置
    request = {
        "subtype": "initialize",
        "hooks": hooks_config if hooks_config else None,
    }

    # 发送控制请求并等待响应
    response = await self._send_control_request(
        request, timeout=self._initialize_timeout
    )
    self._initialized = True
    return response

async def _send_control_request(
    self, request: dict[str, Any], timeout: float = 5.0
) -> dict[str, Any]:
    request_id = f"req_{self._request_counter}"
    self._request_counter += 1

    # 创建等待事件
    event = anyio.Event()
    self.pending_control_responses[request_id] = event

    # 发送请求
    control_msg = {
        "type": "control_request",
        "request": {**request, "request_id": request_id},
    }
    await self.transport.write(json.dumps(control_msg) + "\n")

    # 等待响应
    with anyio.fail_after(timeout):
        await event.wait()

    # 获取结果
    result = self.pending_control_results.pop(request_id)
    if isinstance(result, Exception):
        raise result
    return result
```

### 4. **进程生命周期**

**关键观察**: Claude SDK **每次 `connect()` 都启动新进程**,没有 Daemon 模式!

**代码**: `client.py:87-169` (`connect()`)

```python
async def connect(self, prompt: str | AsyncIterable[dict[str, Any]] | None = None) -> None:
    # 每次 connect 都创建新的 Transport
    self._transport = SubprocessCLITransport(
        prompt=actual_prompt,
        options=options,
    )
    await self._transport.connect()  # 启动新进程

    # 创建 Query 管理控制协议
    self._query = Query(transport=self._transport, ...)
    await self._query.start()
    await self._query.initialize()  # 握手
```

**使用模式**:

```python
# 每个会话一个进程
async with ClaudeSDKClient(options) as client:
    await client.query("First message")
    async for msg in client.receive_response():
        print(msg)

    # 进程仍在运行,可以继续对话
    await client.query("Second message")
    async for msg in client.receive_response():
        print(msg)
# 退出上下文时,进程被终止
```

### 5. **消息路由**

**代码**: `query.py:167-215` (`_read_messages()`)

SDK 通过 `Query` 类路由不同类型的消息:

```python
async def _read_messages(self) -> None:
    async for message in self.transport.read_messages():
        msg_type = message.get("type")

        # 控制响应 → 路由到等待的请求
        if msg_type == "control_response":
            request_id = message.get("response", {}).get("request_id")
            event = self.pending_control_responses[request_id]
            self.pending_control_results[request_id] = message["response"]
            event.set()

        # 控制请求 (来自 CLI) → 异步处理
        elif msg_type == "control_request":
            self._tg.start_soon(self._handle_control_request, message)

        # 普通消息 → 转发给用户
        else:
            await self._message_send.send(message)
```

### 6. **JSONL 流式解析**

**代码**: `subprocess_cli.py:562-608` (`_read_messages_impl()`)

**关键实现**: 处理长 JSON 行可能被截断的情况

```python
async def _read_messages_impl(self) -> AsyncIterator[dict[str, Any]]:
    json_buffer = ""

    async for line in self._stdout_stream:
        line_str = line.strip()
        if not line_str:
            continue

        json_lines = line_str.split("\n")
        for json_line in json_lines:
            json_line = json_line.strip()
            if not json_line:
                continue

            # 累积部分 JSON,直到可以解析
            json_buffer += json_line

            # 检查缓冲区大小限制
            if len(json_buffer) > self._max_buffer_size:
                raise SDKJSONDecodeError("Buffer exceeded max size")

            try:
                data = json.loads(json_buffer)
                json_buffer = ""  # 解析成功,清空缓冲
                yield data
            except json.JSONDecodeError:
                # 还不是完整 JSON,继续累积
                continue
```

## 对 Gemini CLI Daemon Mode 的启示

### ✅ 应该采用的模式

1. **使用 stdin/stdout 双向流式通信**
   - 比 HTTP 更简单,无需端口管理
   - 与 Claude SDK 架构一致
   - 已有 `--prompt-interactive` 的基础

2. **JSONL 消息格式**
   - 简单可靠
   - 易于解析和调试
   - 支持流式输出

3. **控制协议设计**
   - 支持初始化握手
   - 支持会话管理命令
   - 支持中断/取消操作

### ❌ 不应该采用的模式

1. **不需要 HTTP Daemon Server**
   - 过度复杂
   - 需要端口管理
   - Claude SDK 证明 stdio 通信就足够了

2. **不需要多进程会话池**
   - Claude SDK 是每个客户端一个进程
   - 简单的 1:1 映射更可靠
   - 超时清理由 SDK 端管理

## 推荐的 Gemini CLI 重构方案 (V3)

### 架构简化

```
┌────────────────────────────────────────────────────────┐
│          GeminiAdapter (AoE Desktop Main)               │
│  ┌──────────────────────────────────────────────┐     │
│  │        GeminiStreamClient (SDK)               │     │
│  │  • spawn CLI 进程 (per session)               │     │
│  │  • stdin/stdout JSONL 通信                   │     │
│  │  • 消息路由                                   │     │
│  └───────────┬──────────────────────────────────┘     │
└─────────────┼───────────────────────────────────────────┘
              │ subprocess (stdin/stdout)
              │ JSONL 格式
              │
┌─────────────▼──────────────────────────────────────────┐
│        Gemini CLI Process (持久运行)                    │
│  • --prompt-interactive 模式                           │
│  • --output-format stream-json                        │
│  • 从 stdin 读取 JSONL 消息                           │
│  • 输出 JSONL 事件到 stdout                           │
└────────────────────────────────────────────────────────┘
```

### 实现步骤

#### Phase 1: 修改 Gemini CLI (已有基础!)

**好消息**: `--prompt-interactive` 模式已经支持持久化运行!

只需要添加:

1. **JSONL 输入支持** (新增)
   ```typescript
   // packages/cli/src/interactiveCli.ts

   // 当前: 使用 Ink UI 从 stdin 读取
   // 新增: 检测非 TTY 模式,切换到 JSONL 输入

   if (!process.stdin.isTTY) {
     // JSONL 模式: 从 stdin 读取 JSON 行
     process.stdin.on('data', (chunk) => {
       const lines = chunk.toString().split('\n');
       for (const line of lines) {
         if (line.trim()) {
           const message = JSON.parse(line);
           handleJsonMessage(message);
         }
       }
     });
   } else {
     // TTY 模式: 使用 Ink UI
     render(<InteractiveUI />);
   }
   ```

2. **会话 ID 支持** (新增)
   ```typescript
   interface JsonMessage {
     type: 'user' | 'system';
     content: string;
     session_id?: string;  // 可选
   }
   ```

#### Phase 2: 创建 GeminiStreamClient (SDK)

```typescript
// gemini-cli-sdk/src/streamClient.ts

export class GeminiStreamClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdinStream: Writable | null = null;
  private stdoutReader: BufferedLineReader | null = null;

  constructor(private options: GeminiStreamOptions) {
    super();
  }

  async start(): Promise<void> {
    // 启动 CLI 进程
    this.process = spawn('node', [
      this.options.pathToGeminiCLI,
      '--prompt-interactive',
      '--output-format', 'stream-json',
      '--model', this.options.model,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildEnv(),
    });

    this.stdinStream = this.process.stdin!;
    this.stdoutReader = new BufferedLineReader(this.process.stdout!);

    // 启动读取循环
    this.startReadLoop();

    // 等待首个 INIT 事件
    await this.waitForInit();
  }

  async sendMessage(prompt: string): Promise<void> {
    const message = {
      type: 'user',
      content: prompt,
      session_id: this.options.sessionId,
    };
    this.stdinStream!.write(JSON.stringify(message) + '\n');
  }

  private async startReadLoop(): Promise<void> {
    for await (const line of this.stdoutReader!) {
      if (!line.trim()) continue;

      const event = JSON.parse(line) as JsonStreamEvent;
      this.emit('event', event);
    }
  }

  async stop(): Promise<void> {
    if (this.stdinStream) {
      this.stdinStream.end();
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise(resolve => this.process!.once('exit', resolve));
    }
  }
}
```

#### Phase 3: 更新 GeminiAdapter

```typescript
// aoe-desktop/src/main/adapter/GeminiAdapter.ts

export class GeminiAdapter extends EventEmitter implements IAgentAdapter {
  private client: GeminiStreamClient | null = null;

  async start(): Promise<void> {
    this.client = new GeminiStreamClient({
      pathToGeminiCLI: this.getGeminiCLIPath(),
      apiKey: this.config.apiKey,
      sessionId: this.config.sessionId,
      model: this.config.model,
      cwd: this.config.workingDirectory,
    });

    // 监听事件
    this.client.on('event', (event) => {
      const protocolMsg = this.convertEvent(event);
      this.emit('message', protocolMsg);
    });

    await this.client.start();
    this.status = 'running';
  }

  async handleUserMessage(message: ProtocolMessage): Promise<void> {
    if (message.type === 'user_message') {
      await this.client!.sendMessage(message.content);
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.status = 'stopped';
  }
}
```

### 性能提升

**Before (当前架构)**:
- 每次请求: spawn → init → execute → exit
- 延迟: 600-800ms

**After (Stream Client)**:
- 首次请求: spawn → init (600-800ms)
- 后续请求: 发送 JSON → 立即执行 (30-50ms)
- **提升: 12-26x**

### 优势

1. **简单**: 无需 HTTP 服务器,无需端口管理
2. **可靠**: 1:1 进程映射,无会话混淆
3. **兼容**: 与 Claude SDK 架构一致
4. **易调试**: JSONL 格式易于日志和调试
5. **最小修改**: CLI 只需添加非 TTY 模式的 JSONL 输入

## 总结

Claude Agent SDK 给我们展示了一个**更简单、更可靠的架构**:

- ❌ 放弃 HTTP Daemon Server 方案
- ✅ 采用 stdin/stdout JSONL 通信
- ✅ 每个会话一个进程 (简单可靠)
- ✅ 利用 `--prompt-interactive` 的持久化特性
- ✅ 最小化 CLI 修改 (只需添加非 TTY JSONL 输入)

这个方案比原 DAEMON_MODE_REFACTOR.md 简单得多,且与业界标准 (Claude SDK) 一致!
