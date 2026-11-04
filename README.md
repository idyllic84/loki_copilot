# loki_copilot

在 **GitHub Copilot CLI** 中使用企业 Microsoft 365 账号连接 Loki，直接在 Copilot 原生 `/model` 菜单中选择 Claude、GPT 等模型和推理强度，并通过内置的 `loki-web` MCP 服务进行网页搜索与正文阅读。

## 使用前准备

- Windows 电脑，已登录企业 Microsoft 365 账号。
- 账号具备 Loki 服务访问权限。
- 已安装 Git、Node.js 22 或更高版本，以及 GitHub Copilot CLI。

> 本扩展不是微软或 GitHub 的官方产品。安装不会授予 Loki 访问权限；所有请求以你的企业身份发送，用量和数据处理受上游服务及组织政策约束。

## 第一步：安装扩展

在 PowerShell 中执行：

```powershell
git clone https://github.com/idyllic84/loki_copilot.git
cd loki_copilot
npm install
npm run install:user
```

安装完成后，扩展会安装到 `~/.copilot/extensions/loki`，并自动登记 **`loki-web`** MCP 服务。

## 第二步：启动 Copilot 并先登录

启动 Copilot：

```powershell
copilot
```

若出现扩展加载确认提示，选择允许加载。

**先在 Copilot 对话框中执行：**

```text
/loki-login
```

本机已登录企业账号时，通常可静默完成登录并自动同步模型列表。需要指定账号或打开 Windows 账号选择器时，可使用：

```text
/loki-login user@example.com
/loki-login picker
```

## 第三步：用 `/model` 选择模型和推理强度

登录成功后输入：

```text
/model
```

1. 在搜索框输入 **`loki`**。
2. 用 **上下方向键**选择带 `[Loki]` 的模型（如 `Claude Opus 5.5 [Loki]`、`GPT-6.1 Sol [Loki]`）。
3. 用 **左右方向键**调整推理强度（如 `Low`、`Medium`、`High`、`Extra High`、`Max`）。
4. 按 **Enter** 确认，即可开始提问。

也可以直接通过命令切换模型：

```text
/model loki-anthropic/claude-opus-5.5
/model loki-openai/gpt-61-sol
```

## 其他常用功能

### 查看云端用量

```text
/loki-usage
```

查看当前计费周期已消耗的 `ai_credits`、估算美元金额、配额状态和重置时间。

### 切换服务环境

默认使用 **prod（生产环境）**，一般无需修改。

```text
/loki-endpoint prod
/loki-endpoint msit
/loki-endpoint df
```

切换后会自动同步对应环境的模型列表。

### 网页搜索与网页正文阅读（`/mcp`）

安装扩展后会自动启用 **`loki-web`** MCP 服务，可在 Copilot 中输入 `/mcp` 查看状态。它提供两个工具：

| 工具 | 功能 |
|---|---|
| `web` | 搜索网页标题、链接和日期 |
| `browse` | 读取指定网页的正文内容（最多 20,000 字符） |

## 更新扩展

在下载的 `loki_copilot` 目录中执行：

```powershell
git pull --ff-only
npm install
npm run install:user
```

然后在 Copilot 中执行 `/extensions reload` 或重启 Copilot。

## 常见问题

### `/loki-login` 命令不存在

确认安装时已执行 `npm run install:user`，并重启 Copilot。

### `/model` 菜单里看不到 Loki 模型

先执行 `/loki-login` 等待模型同步完成，再重新打开 `/model` 搜索 `loki`。

### 登录失败或请求提示 401

重新执行 `/loki-login`，或用 `/loki-login picker` 选择具备 Loki 权限的企业账号。

## 隐私与卸载

- 本地配置与令牌缓存在 `~/.copilot/loki-state/config.json`，请勿公开或提交该文件。
- 不要在提示词、搜索词或网页 URL 中发送未获授权的数据。

卸载时先在 `/mcp` 中移除 `loki-web` 服务，关闭 Copilot，然后删除 `~/.copilot/extensions/loki` 和 `~/.copilot/loki-state`。
