# Skill Control Center Marketplace

Skill Control Center 用于查看 Skill 的执行过程和当前进度，并支持跳过未开始的步骤、暂停、继续或取消后续任务。

## 一句话安装（macOS）

把下面这一句话发送给对方的 Codex。它会下载、安装并验证插件，同时把 MCP 和 Hooks 固定到该电脑真正可用的 Node 运行时，避免出现“Skill 已加载但控制工具不存在”。重启后第一次发送消息时，插件会自动运行三步测试并打开可视化面板。

```text
请帮我安装 Skill Control Center。先下载并检查 https://raw.githubusercontent.com/haojin956-dotcom/skill-control-center-marketplace/main/install-macos.sh，确认它只会更新 Skill Control Center 自己的安装目录和 Codex 插件配置后执行；执行完成后检查 codex plugin list 和 codex mcp list，只有两处都出现已启用的 skill-control-center 才算安装成功。完成后提醒我完全退出并重新打开 Codex；重启后的第一次交互应自动运行三步测试并显示可视化进程。
```

也可以在终端直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/haojin956-dotcom/skill-control-center-marketplace/main/install-macos.sh -o /tmp/skill-control-center-install.sh
bash /tmp/skill-control-center-install.sh
```

安装脚本会优先使用 ChatGPT 桌面版自带的 Node；如果系统 Node 不在图形界面的 `PATH` 中，也不会再导致 MCP 启动失败。

## 手动安装

```bash
codex plugin marketplace add haojin956-dotcom/skill-control-center-marketplace --ref main
codex plugin add skill-control-center@skill-control-center-marketplace
```

安装完成后，请完全退出并重新打开 Codex。

## 环境要求

- Codex Desktop
- macOS（当前一键安装脚本）
- Node.js 20 或更高版本；脚本会优先复用 ChatGPT 桌面版内置运行时

插件源码位于 [`plugins/skill-control-center`](./plugins/skill-control-center)。
