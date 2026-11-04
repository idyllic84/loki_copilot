# loki_copilot

面向 **GitHub Copilot CLI** 的 **Microsoft Entra (Loki LLM API) 原生扩展**。

基于 `@github/copilot-sdk/extension` 的 `joinSession()` 接口实现。在 Copilot CLI 会话中通过 Windows WAM Broker 自动获取并刷新企业 M365 Entra Token，实时拉取 Loki `GET /models` 并注册为 Copilot CLI 可选模型（支持 **Claude `/v1/messages`** 与 **OpenAI `/responses`**），同时提供环境切换、实时配额查询和 WebGrounding 搜索/网页抓取工具。

---

## 一、主要功能

- **Windows WAM SSO 自动鉴权**：通过 `bearerTokenProvider` 回调与 `wam-helper.mjs` 按需静默获取/刷新 M365 Entra Token，全程无控制台窗口弹出（`windowsHide: true`），完全独立于系统环境变量。
- **默认直连 Production 环境（`prod`）**：默认使用 `https://loki.delve.office.com/api/v1/llmapi`，会话启动及切换环境时实时拉取 `<endpoint>/models`，向 Copilot CLI 动态注册两个增量 BYOK Provider：
  - `loki-anthropic/<model_id>`（Claude 系列，走 `/v1/messages`）
  - `loki-openai/<model_id>`（GPT 系列，走 `/responses`）
- **交互式斜杠命令（Slash Commands）**：
  - `/loki-model [ep/model_id | model_id]`：无参数时直接弹出交互式模型选择框（上下键即可选模型）；也可传参一键切换环境与模型（如 `/loki-model df/claude-opus-5.5`）
  - `/loki-endpoint [prod | msit | df | <https://...>]`：查看或切换 Loki 环境（无参数时弹出选择框），切换后自动热同步模型
  - `/loki-login [account | picker]`：执行 WAM 登录并实时同步模型目录
  - `/loki-models [prod | msit | df]`：在会话时间线中列出实时模型目录、上下文窗口与单价
  - `/loki-usage [prod | msit | df]`：实时查询 `GET /quota` 云端 `ai_credits` 用量与配额周期
- **内置只读 Agent 工具（`skipPermission: true`）**：
  - `loki_web_search`：调用 `<endpoint>/tools/web/mcp` (`web`) 搜索网页标题、链接与日期
  - `loki_web_browse`：调用 `<endpoint>/tools/web/mcp` (`browse`) 抓取指定 URL 的网页正文
  - `loki_quota`：供 Agent 查询当前 Loki 云端配额与消费情况
  - `loki_models`：供 Agent 查看 Loki 实时模型目录
  - `loki_switch_model`：供 Agent 按用户指令切换当前会话的 Loki 模型与环境

---

## 二、安装与初始化

### 1. 环境要求

| 项目 | 说明 |
|---|---|
| 操作系统 | **Windows**（依赖 Windows WAM Broker 进行 SSO） |
| Node.js | `>= 22.0.0` |
| GitHub Copilot CLI | `>= 1.0.5`（支持 `@github/copilot-sdk/extension`） |
| M365 登录态 | 本机已登录企业 M365 账号 |

### 2. 下载与安装

```powershell
git clone https://github.com/idyllic84/loki_copilot.git
cd loki_copilot
npm install
npm run install:user   # 将独立运行副本安装到 ~/.copilot/extensions/loki（与开发目录隔离）
```

> `npm run install:user` 会将扩展运行所需文件独立复制到 `~/.copilot/extensions/loki`，不会将用户扩展目录直接链接到源码开发目录。

---

## 三、使用指南

启动 `copilot` 进入交互模式（如果已在会话中，可运行 `/extensions reload` 热加载扩展）：

### 1. 斜杠命令使用

```text
/extensions list                        # 查看 loki 扩展加载状态
/loki-login                             # WAM 静默 SSO 登录（或 /loki-login picker 弹出账号选择器）
/loki-endpoint df                       # 切换到 Dogfood (df) 环境并热更新模型列表
/loki-endpoint prod                     # 切换到 Production (prod) 环境并热更新模型列表
/loki-models                            # 查看当前环境的实时模型列表
/loki-usage                             # 查询 GET /quota 云端 AI credits 配额与消费
/loki-model df/claude-opus-5.5          # 切换到 df 环境并将当前会话模型设为 Claude Opus 5.5
/loki-model prod/gpt-61-sol             # 切换到 prod 环境并将当前会话模型设为 GPT-6.1 Sol
/model loki-anthropic/claude-opus-5.5   # 也可通过 Copilot CLI 内置的 /model 命令选择
```

### 2. 非交互模式（`-p`）与工具调用示例

```powershell
# 查询 Loki 模型列表与云端配额
copilot -p "调用 loki_models 和 loki_quota 工具查看当前可用模型和配额" --allow-all-tools -s

# 切换到 Loki 模型并执行任务
copilot -p "调用 loki_switch_model 切换到 df/claude-opus-5.5 并回答问题" --allow-all-tools -s
```

---

## 四、测试

```powershell
npm test
```
