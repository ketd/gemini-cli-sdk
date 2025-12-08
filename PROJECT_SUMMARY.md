# Gemini CLI SDK - Project Summary

## 项目概述

**@google/gemini-cli-sdk** 是一个 TypeScript SDK，用于通过子进程方式调用 Google Gemini CLI。该项目参考了 `@anthropic-ai/claude-agent-sdk` 的架构设计，提供了简洁、类型安全的 API。

## 核心特性

### 1. 架构设计

- **进程隔离**: Gemini CLI 作为独立的 Node.js 子进程运行
- **stdio 通信**: 使用 JSON-Lines 格式通过 stdin/stdout 通信
- **事件流式**: 通过 AsyncGenerator 实现实时事件流
- **类型安全**: 完整的 TypeScript 类型定义

### 2. API 层次

#### 低级 API: `query()`
```typescript
import { query } from '@google/gemini-cli-sdk';

for await (const event of query('Hello', options)) {
  console.log(event);
}
```

#### 高级 API: `GeminiClient`
```typescript
import { GeminiClient } from '@google/gemini-cli-sdk';

const client = new GeminiClient(options);
const result = await client.query('Hello');
```

### 3. 功能支持

- ✅ 流式响应 (Streaming)
- ✅ 工具调用 (Tool Calling) - CLI 自动处理
- ✅ 会话管理 (Session Management)
- ✅ 批准模式 (Approval Modes)
- ✅ 超时控制 (Timeout)
- ✅ 自定义工作目录 (Custom CWD)
- ✅ 环境变量配置 (Environment Variables)

## 项目结构

```
gemini-cli-sdk/
├── src/
│   ├── index.ts          # 主入口，导出所有 API
│   ├── types.ts          # TypeScript 类型定义
│   ├── query.ts          # 低级 query 函数
│   ├── client.ts         # 高级 GeminiClient 类
│   └── utils.ts          # 工具函数
├── tests/
│   ├── types.test.ts     # 类型测试
│   └── utils.test.ts     # 工具函数测试
├── examples/
│   ├── basic.ts          # 基础用法示例
│   ├── streaming.ts      # 流式响应示例
│   ├── tools.ts          # 工具调用示例
│   └── events.ts         # 事件监听示例
├── .github/workflows/
│   ├── ci.yml            # CI 工作流
│   └── publish.yml       # 发布工作流
├── dist/                 # 构建输出
│   ├── index.js          # ESM 格式
│   ├── index.cjs         # CommonJS 格式
│   └── index.d.ts        # 类型声明
├── package.json
├── tsconfig.json
├── tsup.config.ts        # 构建配置
├── vitest.config.ts      # 测试配置
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

## 技术栈

- **语言**: TypeScript 5.3+
- **构建工具**: tsup (基于 esbuild)
- **测试框架**: Vitest
- **代码质量**: ESLint + Prettier
- **包管理器**: pnpm
- **CI/CD**: GitHub Actions

## 开发流程

### 1. 安装依赖
```bash
pnpm install
```

### 2. 开发
```bash
pnpm dev  # Watch 模式
```

### 3. 测试
```bash
pnpm test           # 运行测试
pnpm test:watch     # Watch 模式
pnpm test:coverage  # 覆盖率报告
```

### 4. 构建
```bash
pnpm build
```

### 5. 发布
```bash
pnpm publish
```

## 与 Claude Code SDK 对比

| 特性 | Gemini CLI SDK | Claude Code SDK |
|-----|---------------|-----------------|
| **架构** | 子进程 spawn | 子进程 spawn |
| **通信** | JSON-Lines | JSON-Lines |
| **工具调用** | CLI 自动处理 | SDK 处理 |
| **会话管理** | CLI 内置 | SDK 管理 |
| **API Key** | `GOOGLE_API_KEY` | `ANTHROPIC_API_KEY` |
| **输出格式** | `--output-format stream-json` | 默认 JSON-Lines |

## 集成到 AoE Desktop

### 1. 安装 SDK
```bash
pnpm add @google/gemini-cli-sdk
```

### 2. 创建 Adapter
```typescript
// src/main/adapter/gemini/GeminiAdapter.ts
import { GeminiClient } from '@google/gemini-cli-sdk';

export class GeminiAdapter implements IAgentAdapter {
  private client: GeminiClient;

  constructor(config: GeminiAdapterConfig) {
    this.client = new GeminiClient({
      pathToGeminiCLI: this.getGeminiCLIPath(),
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  async *sendMessage(message: AgentMessage): AsyncGenerator<AgentResponse> {
    for await (const event of this.client.stream(message.content)) {
      yield this.convertEventToResponse(event);
    }
  }
}
```

### 3. 注册 Adapter
```typescript
// src/main/adapter/AdapterManager.ts
import { GeminiAdapter } from './gemini/GeminiAdapter';

adapterManager.register('gemini', new GeminiAdapter(config));
```

## 测试覆盖率

当前测试覆盖率：
- **总测试数**: 18 个
- **通过率**: 100%
- **覆盖的模块**:
  - ✅ types.ts (6 tests)
  - ✅ utils.ts (12 tests)

待添加测试：
- [ ] query.ts (集成测试)
- [ ] client.ts (集成测试)

## 性能指标

- **构建时间**: ~300ms
- **测试时间**: ~160ms
- **包大小**:
  - ESM: ~10.79 KB
  - CJS: ~11.76 KB
  - Types: ~9.98 KB

## 依赖关系

### 生产依赖
- 无 (零依赖)

### 开发依赖
- TypeScript 5.3+
- tsup 8.0+
- vitest 1.0+
- ESLint 8.54+
- Prettier 3.1+

### Peer 依赖
- `@google/gemini-cli` (可选)

## 发布流程

### 1. 更新版本
```bash
npm version patch|minor|major
```

### 2. 更新 CHANGELOG
编辑 `CHANGELOG.md`，添加新版本的变更记录。

### 3. 提交并推送
```bash
git add .
git commit -m "chore: release v0.1.0"
git push origin main
```

### 4. 创建 Release
在 GitHub 上创建 Release，GitHub Actions 会自动发布到 npm。

## 未来计划

### v0.2.0
- [ ] 添加集成测试
- [ ] 支持自定义系统提示词
- [ ] 支持多轮对话历史
- [ ] 添加重试机制

### v0.3.0
- [ ] 支持流式取消
- [ ] 添加进度回调
- [ ] 支持自定义工具
- [ ] 添加性能监控

### v1.0.0
- [ ] 完整的文档站点
- [ ] 更多示例项目
- [ ] 性能优化
- [ ] 稳定 API

## 贡献指南

请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

MIT License - 详见 [LICENSE](./LICENSE)。

## 相关资源

- [Gemini CLI 官方仓库](https://github.com/google-gemini/gemini-cli)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [AoE Desktop](https://github.com/yourusername/aoe-desktop)

## 联系方式

- **Issues**: [GitHub Issues](https://github.com/yourusername/gemini-cli-sdk/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/gemini-cli-sdk/discussions)

---

**最后更新**: 2025-12-08
**版本**: 0.1.0
**状态**: ✅ 开发完成，待发布
