# loki_copilot

在 **GitHub Copilot CLI** 中使用 Loki 提供的 Claude、GPT 等模型，通过企业 Microsoft 365 账号登录，并在 Copilot 原生 `/model` 菜单中选择模型和推理强度。

## 使用前准备

- Windows 电脑，已登录企业 Microsoft 365 账号。
- 账号已具备 Loki 服务访问权限。
- 已安装 Git、Node.js 22 或更高版本，以及能正常启动的 GitHub Copilot CLI。
- 当前已验证的 Copilot CLI 版本：**1.0.106-8**。建议使用最新版本。

> 本项目不是微软或 GitHub 的官方产品。安装扩展不会授予 Loki 访问权限；模型请求以你的企业身份发送，用量和数据处理受上游服务及组织政策约束。

## 第一步：安装扩展

在 PowerShell 中执行：

```powershell
git clone https://github.com/idyllic84/loki_copilot.git
cd loki_copilot
npm install
npm run install:user
```

安装完成后，扩展会放在 `~/.copilot/extensions/loki`，与下载的源码目录分开。

## 第二步：启动 Copilot 并登录 Loki

启动 Copilot：

```powershell
copilot
```

如果出现扩展加载或权限确认提示，请在确认信任本扩展后允许加载。

**先在 Copilot 对话框中执行：**

```text
/loki-login
```

按提示完成企业账号登录，看到登录成功及模型同步完成的提示后，再进行下一步。

多账号或需要重新选择账号时，可使用：

```text
/loki-login user@example.com
/loki-login picker
```

`picker` 会打开 Windows 账号选择器。Loki 登录独立于 Copilot 的 GitHub 登录，不需要切换你当前的 GitHub 账号。这里使用的是 **`/loki-login`**，不是 Copilot 自带的 `/login`。

## 第三步：用 `/model` 选择模型

登录成功后输入：

```text
/model
```

1. 在菜单的搜索框输入 **`loki`**。
2. 用 **上下方向键**选择带 `[Loki]` 的模型。
3. 用 **左右方向键**调整推理强度，例如 `Low`、`Medium`、`High`、`Extra High`、`Max`。
4. 按 **Enter** 确认，然后正常提问。

每个模型支持的推理档位可能不同，以菜单实际提供的选项为准。

模型条目示例：

```text
Claude Opus 5.5 [Loki] · ctx=1,000,000
GPT-6.1 Sol [Loki] · ctx=1,050,000
```

- **`ctx`** 是 Loki 返回的总上下文窗口 token 上限，不是当前剩余空间。
- 模型及窗口大小会随服务更新，以上仅为示例。没有返回窗口信息时显示 `ctx=unknown`。
- 某些 Copilot 版本的原生 `Context` 列仍显示 `—`，可以直接查看模型名称后的 `ctx`。
- 模型可能位于 `Recent models`、`New models` 或其他分组；直接搜索 `loki` 最方便。

也可以直接指定模型：

```text
/model loki-anthropic/claude-opus-5.5
/model loki-openai/gpt-61-sol
```

如需调整推理强度，再打开 `/model` 菜单使用左右键即可。

## 其他常用功能

### 查看云端用量

```text
/loki-usage
```

查看当前计费周期的 AI credits 消耗、配额状态和重置时间。

### 切换服务环境

默认使用 **prod（生产环境）**，一般无需修改。

```text
/loki-endpoint prod
/loki-endpoint msit
/loki-endpoint df
```

切换成功后重新打开 `/model`，查看该环境的模型。显式选择的环境会被记住，下次启动继续使用；要恢复默认环境，执行 `/loki-endpoint prod`。

### 网页搜索与阅读

扩展提供网页搜索和网页正文抓取工具。可以直接要求 Copilot 使用 `loki_web_search` 搜索，或使用 `loki_web_browse` 阅读指定网页。搜索与网页抓取是独立操作。

## 更新扩展

在之前下载的 `loki_copilot` 目录中执行：

```powershell
git pull --ff-only
npm install
npm run install:user
```

然后退出并重新启动 Copilot，重新执行 `/loki-login`，再使用 `/model` 选模型。

如果宿主支持，也可通过 `/extensions reload` 重新加载扩展。**只执行 `git pull` 不会更新已安装的运行副本。**

## 常见问题

### `/loki-login` 命令不存在

确认安装时执行了 `npm run install:user`，然后重启 Copilot。若项目目录里另有旧版同名 Loki 扩展，请避免同时加载两个副本。

### 登录成功，但菜单里没有 Loki 模型

等待模型同步完成后，关闭并重新打开 `/model`，在搜索框输入 `loki`。仍看不到时，重启 Copilot，再依次执行 `/loki-login` 和 `/model`。

### 登录失败或请求提示 401

重新执行 `/loki-login`。多账号场景可使用 `/loki-login picker` 选择正确的企业账号。若仍失败，请确认账号有对应环境的服务权限。

### 想刷新模型列表

重新执行 `/loki-login`，或重新加载扩展。无需手工维护模型清单，也不需要 `/loki-model` 或 `/loki-models` 命令。

## 隐私与卸载

- 账号、令牌缓存及环境选择保存在 `~/.copilot/loki-state/config.json`，不要公开或提交该文件。
- 不要在提示词、搜索查询或网页 URL 中发送未获授权的数据。
- 不需要设置 `COPILOT_LOKI_*`、`COPILOT_PROVIDER_*` 等认证环境变量，也不需要编辑 `providers.json`。
- 不要将 Loki 指向不可信的自定义服务地址，否则对方会收到令牌和请求内容。

卸载时先关闭 Copilot，再删除 `~/.copilot/extensions/loki`。如需同时清除插件保存的凭证和环境选择，再删除 `~/.copilot/loki-state`。不要删除整个 `~/.copilot` 目录。
