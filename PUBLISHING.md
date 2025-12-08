# Publishing Guide

本文档说明如何发布 `@ketd/gemini-cli-sdk` 到 npm。

## 📋 发布前检查清单

- [ ] 所有测试通过 (`pnpm test`)
- [ ] 代码已格式化 (`pnpm format`)
- [ ] 代码已通过 lint (`pnpm lint`)
- [ ] 类型检查通过 (`pnpm typecheck`)
- [ ] 构建成功 (`pnpm build`)
- [ ] CHANGELOG.md 已更新
- [ ] package.json 版本号已更新

---

## 🚀 方式 1: 使用 Trusted Publishers (OIDC) - **推荐**

这是 npm 2025 年推荐的方式，无需管理 token！

### 优势

- ✅ 无需创建和管理 npm token
- ✅ 自动生成临时凭证
- ✅ 更安全（防钓鱼攻击）
- ✅ 自动生成 provenance attestation
- ✅ 无需定期轮换 token

### 首次配置步骤

#### 1. 首次手动发布（仅需一次）

第一次发布需要手动进行，以便在 npm 上创建包：

```bash
# 1. 登录 npm
npm login

# 2. 构建
pnpm build

# 3. 首次发布
npm publish --access public
```

#### 2. 在 npm 上配置 Trusted Publisher

1. 登录 https://www.npmjs.com/
2. 进入你的包页面：https://www.npmjs.com/package/@ketd/gemini-cli-sdk
3. 点击 "Settings" 标签
4. 找到 "Publishing Access" 部分
5. 点击 "Add Trusted Publisher"
6. 选择 "GitHub Actions"
7. 填写配置：
   ```
   Repository Owner: ketd
   Repository Name: gemini-cli-sdk
   Workflow Name: publish.yml
   Environment: (留空)
   ```
8. 点击 "Add"

#### 3. 后续发布（自动化）

配置完成后，每次发布只需：

```bash
# 1. 更新版本号
npm version patch  # 或 minor, major

# 2. 推送 tag
git push origin master --tags

# 3. 创建 GitHub Release
gh release create v0.1.1 \
  --title "v0.1.1" \
  --notes "Bug fixes and improvements"
```

GitHub Actions 会自动：
- ✅ 运行测试
- ✅ 构建项目
- ✅ 通过 OIDC 认证
- ✅ 发布到 npm
- ✅ 生成 provenance attestation

### 验证 Provenance

发布后，可以验证 provenance：

```bash
npm view @ketd/gemini-cli-sdk --json | jq .dist.attestations
```

---

## 🔐 方式 2: 使用 Granular Access Token（传统方式）

如果你不想使用 Trusted Publishers，可以使用传统的 token 方式。

### ⚠️ 2025 年新限制

- Token 最长有效期：**90 天**
- 推荐有效期：**30 天**
- 需要定期轮换

### 创建 Granular Access Token

1. **登录 npm**
   - 访问 https://www.npmjs.com/
   - 登录你的账号

2. **创建 Token**
   - 点击头像 → "Access Tokens"
   - 点击 "Generate New Token" → **"Granular Access Token"**

3. **配置 Token**
   ```
   Token Name: gemini-cli-sdk-ci
   Expiration: 30 days (推荐) 或 90 days (最大)
   Packages and scopes: 选择 @ketd/gemini-cli-sdk
   Permissions: Publish (read and write)
   IP allowlist: (可选) 限制 GitHub Actions IP
   ```

4. **保存 Token**
   - 复制 token（格式：`npm_xxxxxx...`）
   - ⚠️ Token 只显示一次，请立即保存

### 配置 GitHub Secret

```bash
cd /Volumes/ThunderBolt_1T/code/gemini-cli-sdk
gh secret set NPM_TOKEN
# 粘贴你的 token，按 Enter
```

或在 GitHub 网站上手动添加：
1. 访问 https://github.com/ketd/gemini-cli-sdk/settings/secrets/actions
2. 点击 "New repository secret"
3. Name: `NPM_TOKEN`
4. Secret: 粘贴你的 token
5. 点击 "Add secret"

### 更新工作流

编辑 `.github/workflows/publish.yml`，取消注释 token 方式：

```yaml
# 注释掉 Trusted Publishers 方式
# - name: Publish to npm (via Trusted Publishers)
#   run: pnpm publish --provenance --access public --no-git-checks

# 取消注释 Token 方式
- name: Publish to npm (via Token)
  run: pnpm publish --no-git-checks --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Token 轮换提醒

设置日历提醒，在 token 过期前轮换：
- 30 天 token：每月轮换
- 90 天 token：每季度轮换

---

## 📦 手动发布

如果需要手动发布（不推荐用于生产）：

```bash
# 1. 登录 npm
npm login

# 2. 确保所有检查通过
pnpm test
pnpm lint
pnpm typecheck

# 3. 构建
pnpm build

# 4. 发布
npm publish --access public

# 或使用 provenance（推荐）
npm publish --access public --provenance
```

---

## 🔍 发布后验证

### 1. 检查包是否发布成功

```bash
npm view @ketd/gemini-cli-sdk
```

### 2. 测试安装

```bash
# 创建测试目录
mkdir test-install && cd test-install
npm init -y

# 安装包
npm install @ketd/gemini-cli-sdk

# 测试导入
node -e "const sdk = require('@ketd/gemini-cli-sdk'); console.log(sdk)"
```

### 3. 检查 npm 网站

访问 https://www.npmjs.com/package/@ketd/gemini-cli-sdk

---

## 📊 版本管理

### 语义化版本

遵循 [Semantic Versioning](https://semver.org/)：

- **Patch** (0.1.0 → 0.1.1): 向后兼容的 bug 修复
  ```bash
  npm version patch
  ```

- **Minor** (0.1.0 → 0.2.0): 向后兼容的新功能
  ```bash
  npm version minor
  ```

- **Major** (0.1.0 → 1.0.0): 破坏性变更
  ```bash
  npm version major
  ```

### 预发布版本

```bash
# Alpha 版本
npm version prerelease --preid=alpha
# 0.1.0 → 0.1.1-alpha.0

# Beta 版本
npm version prerelease --preid=beta
# 0.1.0 → 0.1.1-beta.0

# RC 版本
npm version prerelease --preid=rc
# 0.1.0 → 0.1.1-rc.0
```

---

## 🐛 常见问题

### Q: 发布失败，提示 "You do not have permission to publish"

**A**: 检查：
1. 包名是否正确（`@ketd/gemini-cli-sdk`）
2. 你是否有权限发布到 `@ketd` scope
3. 如果是首次发布，确保包名未被占用

### Q: Trusted Publishers 配置后仍然失败

**A**: 检查：
1. 是否已经手动发布过一次
2. Trusted Publisher 配置是否正确
3. Workflow 文件名是否匹配（`publish.yml`）
4. `permissions.id-token: write` 是否已设置

### Q: Token 过期了怎么办？

**A**:
1. 创建新的 Granular Access Token
2. 更新 GitHub Secret (`NPM_TOKEN`)
3. 或者迁移到 Trusted Publishers（推荐）

### Q: 如何撤销已发布的版本？

**A**:
```bash
# 撤销特定版本（72小时内）
npm unpublish @ketd/gemini-cli-sdk@0.1.0

# 弃用版本（推荐）
npm deprecate @ketd/gemini-cli-sdk@0.1.0 "This version has critical bugs"
```

---

## 📚 相关资源

- [npm Trusted Publishers 文档](https://docs.npmjs.com/generating-provenance-statements)
- [npm Granular Access Tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [Semantic Versioning](https://semver.org/)

---

## 🎯 推荐流程

**对于新项目（推荐）**:
1. ✅ 使用 Trusted Publishers (OIDC)
2. ✅ 首次手动发布
3. ✅ 配置 Trusted Publisher
4. ✅ 后续通过 GitHub Release 自动发布

**对于现有项目**:
1. 继续使用 Granular Access Token
2. 设置 30 天有效期
3. 定期轮换 token
4. 逐步迁移到 Trusted Publishers

---

**最后更新**: 2025-12-08
**适用版本**: npm 10.x+, Node.js 18.x+
