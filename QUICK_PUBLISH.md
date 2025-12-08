# 📦 快速发布指南

## 🎯 推荐方式：Trusted Publishers (OIDC)

### 为什么推荐？
- ✅ **无需管理 token**（npm 2025年新规：token 最多90天有效）
- ✅ **更安全**（自动生成临时凭证，防钓鱼）
- ✅ **零维护**（无需定期轮换）
- ✅ **自动 provenance**（包来源证明）

---

## 🚀 首次发布（3步完成）

### 步骤 1: 手动发布一次

```bash
cd /Volumes/ThunderBolt_1T/code/gemini-cli-sdk

# 登录 npm
npm login

# 构建和发布
pnpm build
npm publish --access public
```

### 步骤 2: 配置 Trusted Publisher

1. 访问 https://www.npmjs.com/package/@ketd/gemini-cli-sdk
2. 点击 "Settings" → "Publishing Access"
3. 点击 "Add Trusted Publisher" → 选择 "GitHub Actions"
4. 填写：
   ```
   Repository Owner: ketd
   Repository Name: gemini-cli-sdk
   Workflow Name: publish.yml
   ```
5. 点击 "Add"

### 步骤 3: 后续自动发布

```bash
# 更新版本
npm version patch  # 0.1.0 → 0.1.1

# 推送 tag
git push origin master --tags

# 创建 Release（自动触发发布）
gh release create v0.1.1 --title "v0.1.1" --notes "Bug fixes"
```

**完成！** GitHub Actions 会自动发布到 npm。

---

## 📚 详细文档

完整指南请查看：[PUBLISHING.md](./PUBLISHING.md)

包含：
- Trusted Publishers 详细配置
- 传统 Token 方式（备选）
- 版本管理最佳实践
- 常见问题解答
- 故障排除

---

## ⚡ 快速命令

```bash
# 运行测试
pnpm test

# 构建
pnpm build

# 更新版本
npm version patch  # bug 修复
npm version minor  # 新功能
npm version major  # 破坏性变更

# 手动发布（如需）
npm publish --access public

# 创建 Release
gh release create v0.1.0 --title "v0.1.0" --notes "Initial release"
```

---

**当前版本**: 0.1.0
**包名**: @ketd/gemini-cli-sdk
**仓库**: https://github.com/ketd/gemini-cli-sdk
