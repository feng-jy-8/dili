# 安装与运行 Dili

当前正式验收目标为 Linux x86_64；WSL2 x86_64 沿用 Linux 运行方式。需要 Node.js 24+。Windows 原生和 macOS 暂未完成本版本发行验收。

## npm 安装

包名暂定 `dili-workbench`，命令名为 `dili`。本版本尚未发布到 npm；正式发布后可执行：

```sh
npm install -g dili-workbench
dili
```

发布前可以使用本地生成的包，安装效果相同：

```sh
npm ci
npm pack
npm install -g ./dili-workbench-0.4.0-dev.0.tgz
dili
```

网页随包预构建；全局安装后的启动不需要 Vite、TypeScript 编译器或下载网页资源。Node.js 的原生终端依赖需要匹配本机平台。

```sh
dili --help
dili --version
dili --port 4327 --data-dir ~/.local/share/dili-test
dili doctor
```

默认浏览器地址为 `http://localhost:4317`。前台运行时 Ctrl+C 会停止 Dili 及其托管进程，保留原生历史、联系人、笔记和配置。程序安装目录与数据目录分离，兼容数据目录仍为 `~/.local/share/sessiondeck`。升级不应在仍有运行会话时覆盖服务依赖；安排停止服务后升级。

## 源码运行

`./start.sh` 沿用现有源码安装与构建流程；也可运行 `npm ci && npm run build && npm start`。npm 包和源码启动使用同一数据格式；不能同时使用同一数据目录。

## Agent

Claude Code、Codex、DeepSeek Harness 独立安装，使用原生登录和配置。Dili 只管理本机具体会话，不代替 Agent 的账号、付费和权限体系。在「连接与能力」可以点击安装、账号登录，在底部交互终端完成操作。安装需要网络和 npm 全局目录写权限；失败时在终端查看错误，不会自动提权。已有后端仍可以使用自己的官方安装方法。安装／登录后刷新检测；可在其他终端直接运行同名命令。

Claude 和 Codex 的「配置 API」将设置写到其用户原生配置路径（尊重 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`），保存前备份已有文件，文件权限为 0600。密钥留空保留已有凭据，地址／模型留空恢复默认；新启动的会话读取。Codex API Key 通过原生登录命令的 stdin 保存，自定义地址需兼容 Responses API。TOML 会规范化格式，注释保存在备份中。已有 OAuth 和 API 认证的优先级遵循原生 Agent，请用原生登录状态检查。

DeepSeek Harness 点击「原生配置引导」启动 `dsh web`，按终端提示打开本机地址，在其设置中配置提供商、API Key 和模型。它的 Web 配置由 Harness 自己维护；安装引导会同时安装 `@deepseek-ai/dsh` 和 Dili 原生终端所需的 `@deepseek-harness-tui/dsh-tui`。远程页面只查看引导，安装和配置操作必须在本机完成。

## 自动启动

`dili service status` 检查用户服务；`dili service enable`／`disable` 只改变下次登录后的自动启动，不停止或重启当前实例。网页也提供同样设置。新服务使用当前工作目录、端口、数据目录和 PATH；保留已有兼容服务的自定义设置，拒绝覆盖其他安装或数据目录的服务。只启用下次自动启动：若需要现在接管前台进程，先安排停止前台，再在其他终端运行 `systemctl --user start dili`，避免中断本工具托管的会话。服务单元为 `dili.service`；旧版的 `sessiondeck.service` 在启用时迁移，只停用旧单元，不停止其实例。已有源码服务升级到 npm 安装，应在原安装禁用旧服务并确认会话已停止，再迁移服务文件。

无需登录持续运行另需用户明确执行 `loginctl enable-linger`。用户服务绑定 Node 和 npm 包的绝对路径；更换 Node/npm 安装位置后，需要在停机窗口更新服务路径。

WSL 内服务只会在发行版启动后运行。若需 Windows 开机后启动发行版，请自行配置 Windows 任务计划；Dili 不把启用 WSL 内 systemd 等同于 Windows 开机启动。
