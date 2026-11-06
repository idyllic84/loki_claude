# loki_claude

在 **Claude Code** 中使用企业 Microsoft 365 账号连接 Loki：直接在 Claude Code 原生 `/model` 菜单中选择 Loki 上的 Claude 模型和推理强度，并通过插件自带的 `loki-web` MCP 服务进行网页搜索与正文阅读。

## 使用前准备

- Windows 电脑，已登录企业 Microsoft 365 账号。
- 账号具备 Loki 服务访问权限。
- 已安装 Node.js 22 或更高版本。
- 已安装 Claude Code 2.1.292 或更高版本（已验证 2.1.314）。

> 本插件不是微软或 Anthropic 的官方产品。安装不会授予 Loki 访问权限；所有请求以你的企业身份发送，用量和数据处理受上游服务及组织政策约束。

## 第一步：安装插件

在 PowerShell 中执行：

```powershell
claude plugin install loki --marketplace idyllic84/loki_claude
```

## 第二步：登录 Loki

**首次使用时，先在 PowerShell 中执行：**

```powershell
claude -p "/loki-login"
```

本机已登录企业账号时，通常可静默完成登录，并显示当前环境可用的模型。需要指定账号或打开 Windows 账号选择器时，可使用：

```powershell
claude -p "/loki-login user@example.com"
claude -p "/loki-login picker"
```

登录后，Claude Code 的所有会话都会通过 Loki 调用模型。之后在 Claude Code 会话中也可以直接输入 `/loki-login` 重新登录或切换账号。

## 第三步：启动 Claude Code，用 `/model` 选择模型

```powershell
claude
```

在会话中输入：

```text
/model
```

1. 用 **上下方向键**选择模型，例如 `Claude Opus 5.5`、`Claude Sonnet 5.5`、`Claude Haiku 5.5`（说明为 `Loki · 1M context`）。
2. 用 **左右方向键**调整推理强度（`Low`、`Medium`、`High`、`xHigh`、`Max`）。
3. 按 **Enter** 设为默认模型，或按 **s** 仅用于当前会话。

模型列表在每次启动会话时从 Loki 实时同步。Claude Code 只支持 Claude 模型，因此列表只包含 Loki 上的 Claude 模型。

## 其他常用功能

### 查看云端用量

```text
/loki-usage
```

查看当前计费周期已消耗的 `ai_credits`、估算美元金额、配额状态和重置时间。

### 切换服务环境

默认使用 **prod（生产环境）**，一般无需修改。

```text
/loki-endpoint
/loki-endpoint prod
/loki-endpoint msit
/loki-endpoint df
```

切换后会立即使用新环境，并同步该环境的模型列表。

### 网页搜索与网页正文阅读（`/mcp`）

插件自带 **`loki-web`** MCP 服务，可在 Claude Code 中输入 `/mcp` 查看（显示为 `plugin:loki:loki-web`）。它提供两个工具：

| 工具 | 功能 |
|---|---|
| `web` | 搜索网页标题、链接和日期 |
| `browse` | 读取指定网页的正文内容（最多 20,000 字符） |

可以直接对 Claude 说：

```text
用 loki-web 搜索 TypeScript 的最新发布说明。
```

## 更新插件

```powershell
claude plugin update loki@loki
```

然后重启 Claude Code。

## 常见问题

### 启动 `claude` 时出现 Claude 账号登录方式选择

说明尚未登录 Loki。按 Esc 退出后，先在 PowerShell 中执行 `claude -p "/loki-login"`，再启动 `claude`。

### `/loki-login` 命令不存在

执行 `claude plugin list` 确认 `loki@loki` 已安装并启用；在会话中执行 `/reload-plugins` 或重启 Claude Code。

### 请求提示 401 或登录失败

执行 `/loki-login picker`，选择具备 Loki 权限的企业账号。

## 隐私与卸载

- 登录状态与令牌缓存保存在 `~/.claude/loki-state/config.json`，请勿公开或提交该文件。
- 插件会在 `~/.claude/settings.json` 中写入 Loki 所需的 `apiKeyHelper`、`env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_CUSTOM_HEADERS`、`modelOverrides` 和 `modelPicker`，并关闭 Loki 不支持的 `/advisor` 及安全拦截后自动换模型功能；不写入令牌。执行 `/loki-logout` 会恢复为登录前的设置。
- 不要在提示词、搜索词或网页 URL 中发送未获授权的数据；不要将 `/loki-endpoint` 指向不可信的地址。

卸载：

```powershell
claude -p "/loki-logout"
claude plugin uninstall loki@loki
```
