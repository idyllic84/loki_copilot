# loki_copilot

面向 **GitHub Copilot CLI** 的 **Microsoft Entra（Loki LLM API）扩展**。

使用企业 M365 身份通过 Windows WAM 获取令牌，实时发现 Loki 模型，并加入 Copilot **原生 `/model` 选单**。在选单里选择模型、用左右键调整 thinking/reasoning level，无需单独的模型选择命令或代理服务。

> 本项目不是微软或 GitHub 的官方产品。需要企业账号已有 Loki 访问权限；安装扩展不会授予权限。请求以你的身份发送，用量和数据处理受上游服务及组织政策约束。

## 一、主要功能

- **原生选模型与 thinking 档位**：输入 `/model`，搜索 `loki`，使用上下键选模型、左右键调整推理强度，再按 Enter。支持档位来自模型目录，不统一硬编码成固定列表。
- **实时模型发现**：启动、登录、刷新或切换环境时请求 `GET /models`，使用 SDK 的 `providers`、`models` 和会话级 provider API 注册，不向 `providers.json` 写入模型快照。
- **独立 WAM 认证**：按需静默获取及刷新令牌，不要求切换 Copilot 的 GitHub 账号，不依赖 `COPILOT_LOKI_*`、`COPILOT_PROVIDER_*`、`LOKI_TOKEN` 或 `LOKI_UPSTREAM`。
- **默认 prod**：未配置时使用 `https://loki.delve.office.com/api/v1/llmapi`。显式切换至 msit、df 或可信自定义地址后记住选择。
- **实时配额与网页工具**：查询 `GET /quota`，并提供相互独立的网页搜索、网页正文抓取工具。

## 二、安装与更新

### 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows，支持 WAM Broker |
| Node.js | 22 或更高版本；建议当前 LTS |
| Copilot CLI | 需支持 Extension 和实验性多 Provider SDK；原生选单测试版本为 **1.0.106-8** |
| 企业账号 | 已在本机登录，并具备 Loki 服务访问权限 |

### 首次安装

```powershell
git clone https://github.com/idyllic84/loki_copilot.git
cd loki_copilot
npm install
npm run install:user
```

安装脚本将运行副本复制到 `~/.copilot/extensions/loki`，与源码开发目录隔离。不修改 Copilot 二进制、不设置认证环境变量，也不写 `providers.json`。

启动 Copilot，按宿主提示允许加载你信任的 Loki 扩展。若已有会话，执行 `/extensions reload`；不支持该命令的版本请退出并重启。**仅更新源码不会更新已安装副本**。

### 更新已有安装

```powershell
git pull --ff-only
npm install
npm test
npm run install:user
```

然后重新加载扩展或重启 Copilot。

安装位置可通过 `COPILOT_HOME` 或 `LOKI_COPILOT_EXT_DIR` 调整；这些是安装路径选项，不参与服务认证或 endpoint 选择。不要同时保留同名的项目级旧扩展，它可能优先于用户级安装副本。

## 三、日常使用

### 使用原生 `/model`

1. 等待扩展提示动态模型已加载。首次授权或静默认证失败时，执行 `/loki-login`。
2. 输入 **`/model`** 打开 Copilot 原生模型选单。
3. 在搜索框输入 **`loki`**。模型名称带有 **`[Loki]`**，可能位于 `Recent models`、`New models` 或其他分组，不一定有单独的 Loki Provider 分组。
4. **上下键**选择模型，**左右键**调整 `Reasoning` 档位，按 **Enter** 确认。

例如，测试中 Claude Opus 5.5 的可选档位为 `Low / Medium / High / Extra High / Max`；实际值由上游目录决定。模型未声明推理档位时，不显示可调 reasoning 控件。

也可使用原生命令直接指定 ID：

```text
/model loki-anthropic/claude-opus-5.5
/model loki-openai/gpt-61-sol
```

模型 ID 会随服务变动，以原生选单中的 `[Loki]` 条目为准。需要重新拉取上游目录时执行 `/extensions reload`，或重新设置当前 endpoint。

**已删除 `/loki-model`、`/loki-models` 命令及 `loki_switch_model` 工具**，模型查看、选择与推理强度统一交给宿主原生选单。

### 扩展命令

| 命令 | 作用 |
|---|---|
| `/loki-login` | 使用 WAM 登录，随后同步模型 |
| `/loki-login user@example.com` | 指定企业账号 |
| `/loki-login picker` | 打开 Windows 账号选择器 |
| `/loki-endpoint` | 在支持交互表单的宿主中选择环境，否则显示当前环境及用法 |
| `/loki-endpoint prod` | 切回默认生产环境并刷新模型 |
| `/loki-endpoint msit` 或 `/loki-endpoint df` | 切换环境并保存选择 |
| `/loki-usage` | 查询当前环境的云端配额 |

切换环境后，如果当前 Loki 模型仍可用，会尝试保留模型和已选推理档位。若新环境不支持该模型或档位，请重新从 `/model` 选择。

### 工具

| 工具 | 功能 |
|---|---|
| `loki_web_search` | 搜索标题、URL 和日期；支持语言、地区和结果数量 |
| `loki_web_browse` | 抓取指定网页的文本内容，最多 20,000 字符；可能截断，不保证完整原文 |
| `loki_models` | 查询实时模型目录 |
| `loki_quota` | 查询云端配额 |

这些查询工具设置了 `skipPermission: true`。搜索会发送查询，抓取会发送 URL；网页内容应视为不可信输入。

## 四、配置、隐私与边界

- endpoint、账号和令牌缓存保存在 `~/.copilot/loki-state/config.json`，不要公开或提交该文件。辅助进程使用 `windowsHide: true` 避免控制台窗口；系统登录或账号选择界面仍可能出现。
- 自定义 endpoint 会接收你的令牌和请求内容，只配置可信地址。
- 插件不读写 Copilot 的 Provider 认证环境变量，但宿主自身的权限、组织策略、扩展启用状态及 SDK 版本仍可能影响运行。
- **内置 `/login` 暂无已确认的自定义认证提供方注册接口**，因此保留 `/loki-login`，不覆盖宿主登录菜单。
- **原生 `Context` 列的已知显示限制（CLI 1.0.106-8）**：即使公开 `session.model.list` 已返回正确的 `max_context_window_tokens`、`max_prompt_tokens`、`max_output_tokens`，BYOK 条目仍显示 `—`。本项目同时传递顶层和 `capabilities.limits` 两种官方定义的限制字段，但不伪造计费数据、上下文档位或模型名称来冒充列显示修复。显示为空不等于上下文被限制到小窗口，准确上限应以模型能力数据为准。
- 多 Provider SDK 接口仍属实验性。当前验证版本上的可用行为，不代表所有 Copilot 版本都兼容。

## 五、测试

### 离线单元测试

```powershell
npm test
```

使用模拟响应，覆盖动态模型增删、能力映射、上游推理档位、请求头、认证序列化和查询工具。原生 UI 测试默认跳过。

### 原生选单测试（需显式开启）

先安装扩展、准备有效 WAM 登录态，然后执行：

```powershell
$env:LOKI_COPILOT_TUI_TEST = "1"
npm run test:copilot
```

测试通过无可见控制台窗口的 ConPTY 打开真实 Copilot，搜索并选中 Loki 模型，验证 `Low → Medium → High → Extra High → Max`、确认 High、通过 `/loki-endpoint prod` 刷新动态目录后保留档位，并检查 `providers.json` 未改变。测试会把插件 endpoint 设为 prod；只对该次扩展启动确认权限，不保存全局授权。

可选地设置 `COPILOT_TEST_CLI` 指定 Copilot 可执行文件或官方 JavaScript 入口；设置 `LOKI_TEST_MODEL_LABEL` 选择其他模型名称。测试默认目标为 `Claude Opus 5.5 [Loki]`，目标需要支持上述五个档位。测试会创建正常的 Copilot 会话记录。

额外启用真实请求验证会产生少量服务用量：

```powershell
$env:LOKI_COPILOT_LIVE_TEST = "1"
npm run test:copilot
```

**已验证**：Copilot CLI 1.0.106-8、prod 环境下，Claude Opus 5.5 和 GPT-6.1 Sol 均通过原生选单选择、推理档位调整、目录热同步及后续真实请求测试。未将长时间令牌续期或所有模型/CLI 版本视为已验证。

## 六、官方接口依据

- [Copilot CLI 选择模型及推理档位](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/choose-a-model)
- [Copilot 官方模型能力字段](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference#providersjson)：参考 `capabilities.supports.reasoning_effort`、`adaptive_thinking`、`capabilities.limits` 的含义；本项目不写该配置文件。
- [Extension 接口](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md)
- [SDK 模型定义](https://github.com/github/copilot-sdk/blob/main/nodejs/src/types.ts)、[会话级 provider API](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/rpc.ts)

实现不依赖反编译、私有 NAPI 或修改宿主选单。

## 七、卸载

关闭 Copilot CLI，删除用户扩展目录 `~/.copilot/extensions/loki`。如需清除插件保存的凭证和 endpoint，再删除 `~/.copilot/loki-state`。不要删除整个 `~/.copilot` 目录。
