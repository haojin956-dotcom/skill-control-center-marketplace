# Skill Control Center Marketplace

Skill Control Center 用于查看 Skill 的执行过程和当前进度，并支持跳过未开始的步骤、暂停、继续或取消后续任务。

## 让 Codex 帮你安装

将下面这段话发送给 Codex：

```text
请帮我安装这个 Codex 插件：https://github.com/haojin956-dotcom/skill-control-center-marketplace

请自动完成以下操作：
1. 将该仓库添加为 Codex plugin marketplace。
2. 安装其中的 skill-control-center 插件。
3. 使用 codex plugin list 验证插件已安装并启用。
4. 不修改或删除其他插件。
5. 完成后提醒我完全退出并重新打开 Codex。
```

## 手动安装

```bash
codex plugin marketplace add haojin956-dotcom/skill-control-center-marketplace --ref main
codex plugin add skill-control-center@skill-control-center-marketplace
```

安装完成后，请完全退出并重新打开 Codex。

## 环境要求

- Codex Desktop
- Node.js 20 或更高版本

插件源码位于 [`plugins/skill-control-center`](./plugins/skill-control-center)。
