# loki_copilot

面向 **GitHub Copilot CLI** 的 **Microsoft Entra（Loki LLM API）扩展**。

扩展通过 `@github/copilot-sdk/extension` 的 `joinSession()` 加入当前会话，使用 Windows WAM 获取企业 M365 Entra 令牌，实时发现 Loki 模型，并通过 SDK 注册模型提供方、自定义命令和工具。无需单独运行代理服务。

> 本项目不是微软或 GitHub 的官方产品。使用需要已有 Loki 访问权限；安装扩展不会授予服务权限。请求以你的企业身份发送，用量和数据处理受上游服务及组织政策约束。

## 一、主要功能

- **独立认证**：通过 Windows WAM 静默获取及刷新令牌；需要交互授权或切换账号时使用 `/loki-login`。辅助进程使用 `windowsHide: true` 避免控制台窗口，系统登录或账号选择界面仍可能出现。
- **默认生产环境**：未配置时固定使用 `prod`：`https://loki.delve.office.com/api/v1/llmapi`。显式切换后记住选择，后续启动使用已保存的环境。
- **实时模型发现**：从当前环境的 `GET /models` 获取模型，通过增量 BYOK 注册 `loki-anthropic/<模型 ID>` 和 `loki-openai/<模型 ID>`，分别使用 Anthropic Messages 和 OpenAI Responses 协议。可用模型以上游实时返回为准。
- **云端配额查询**：通过 `GET /quota` 展示当前周期用量和配额状态。
- **网页搜索与抓取**：提供独立的 `loki_web_search` 和 `loki_web_browse` 工具，不自动组合搜索与抓取。

### 配置与认证隔离

- 插件的 endpoint、账号和令牌缓存保存在 `~/.copilot/loki-state/config.json`，不要公开或提交该文件。
- 插件不读取 `COPILOT_LOKI_*`、`COPILOT_PROVIDER_*`、`LOKI_UPSTREAM` 或 `LOKI_TOKEN` 来决定自己的上游地址或认证，也不写入这些用户环境变量。
- 不要求切换 Copilot 的 GitHub 账号，不用 Copilot 内置的 Entra 登录代替插件 WAM 登录。
- 这不代表能隔离整个宿主：Copilot CLI 自身的环境、权限、组织策略及 SDK 版本仍可能影响扩展的加载和运行。
- 仅向可信 endpoint 发送请求；自定义地址会接收你的令牌和请求内容。

## 二、安装与更新

### 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows，支持 WAM Broker |
| Node.js | 22 或更高版本；建议使用当前 LTS |
| Copilot CLI | 需支持 Extension、增量 BYOK 和令牌回调；本地核对版本为 `1.0.106-8`，不保证所有较早版本支持相同接口 |
| 企业账号 | 已在本机登录，并具备 Loki 服务访问权限 |

### 首次安装

```powershell
git clone https://github.com/idyllic84/loki_copilot.git
cd loki_copilot
npm install
npm run install:user
```

安装脚本将运行副本复制到 `~/.copilot/extensions/loki`，与开发目录分离，不创建指向源码目录的链接。安装位置可通过 `COPILOT_HOME` 或 `LOKI_COPILOT_EXT_DIR` 调整；这些是安装路径选项，不参与服务认证或 endpoint 选择。

启动 `copilot` 后检查扩展加载状态。已有会话可尝试 `/extensions reload`，不支持该命令的版本请重启 CLI。

### 更新

在源码目录中执行：

```powershell
git pull --ff-only
npm install
npm test
npm run install:user
```

然后重新加载扩展或重启 Copilot CLI。只更新源码不会自动更新独立安装副本。

## 三、日常使用

### 最短使用流程

```text
/loki-login       # 首次授权或静默认证失败时使用；已有有效凭证时通常不需要
/loki-model       # 在支持交互表单的宿主中打开模型选择框
```

默认使用 prod，不需要先切换环境，也不需要切换 Copilot 登录账号。指定模型的示例：

```text
/loki-model claude-opus-5.5
/loki-model gpt-61-sol
```

示例模型可能随服务变动；使用 `/loki-models` 查询当前可用 ID。

### 命令一览

| 命令 | 作用 |
|---|---|
| `/loki-login` | 使用 WAM 登录，随后同步模型 |
| `/loki-login user@example.com` | 指定企业账号 |
| `/loki-login picker` | 打开 Windows 账号选择器 |
| `/loki-endpoint` | 在支持交互表单的宿主中选择环境，否则显示当前环境及用法 |
| `/loki-endpoint prod` | 切回默认生产环境 |
| `/loki-endpoint msit` 或 `/loki-endpoint df` | 显式切换至其他环境并保存 |
| `/loki-model` | 在支持交互表单的宿主中选择模型，否则显示当前模型 |
| `/loki-model df/claude-opus-5.5` | 显式切换环境及模型 |
| `/loki-models` | 查询当前环境的实时模型目录 |
| `/loki-usage` | 查询当前环境的云端配额 |

### 与内置 `/login`、`/model` 的关系

**模型提供方注册与登录菜单扩展是不同的接口。**

- **内置 `/login`**：本地核对的 SDK 没有向该菜单注册自定义认证提供方的 Extension 接口。`accounts.login` RPC 只能调用宿主已有的登录流程；宿主 SDK 的 `CopilotClientOptions.entra.tokenProvider` 也不是普通 Extension 的注册入口。因此本扩展保留 `/loki-login`，不覆盖内置 `/login`。
- **模型提供方**：SDK 支持 `joinSession({ providers, models })` 和会话级 provider RPC 注册模型，以及按请求调用 `bearerTokenProvider` 获取凭证。本项目使用这些接口，不使用环境变量桥接。
- **内置 `/model`**：注册后的模型使用如 `loki-anthropic/claude-opus-5.5` 的选择 ID。可尝试 `/model loki-anthropic/claude-opus-5.5`，但普通 Extension 在不同 CLI 版本的原生菜单中是否完整显示、刷新和可选，尚未完成交互式端到端验证。**不能仅凭 SDK 注册成功就承诺原生菜单体验完全可用**；目前保留 `/loki-model` 作为明确的选择入口。

安装不修改 Copilot 二进制、不接管账号系统，也不通过隐藏环境变量模拟上述能力。

### 工具

| 工具 | 功能 |
|---|---|
| `loki_web_search` | 搜索标题、URL 和日期；支持语言、地区和结果数量 |
| `loki_web_browse` | 抓取指定网页的文本内容，最多 20,000 字符；可能截断，不保证完整原文 |
| `loki_models` | 获取实时模型目录 |
| `loki_quota` | 获取云端配额 |
| `loki_switch_model` | 修改当前会话模型，也可显式切换环境；不是只读查询 |

当前这些工具设置了 `skipPermission: true`。搜索会发送查询，抓取会发送 URL，模型调用会发送会话内容；不要向外部服务提供未获授权的数据，网页内容也应视为不可信输入。

## 四、测试与验证范围

```powershell
npm test
```

单元测试使用模拟 HTTP 响应，覆盖模型转换、请求头、认证字段序列化、配额和网页工具客户端；不验证完整的 Copilot TUI 或真实模型推理链路。

本地曾验证模型目录、配额工具及模型切换工具返回成功，但**切换工具成功或模型自述不等同于后续推理请求已完整验证**。原生菜单、切换后的新一轮推理及长时间令牌续期仍需进一步端到端验证。

## 五、卸载

关闭 Copilot CLI，删除用户扩展目录 `~/.copilot/extensions/loki`。如需清除插件保存的凭证和 endpoint，再删除 `~/.copilot/loki-state`。不要删除整个 `~/.copilot` 目录。
