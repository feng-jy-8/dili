## Dili 0.5.2 — 多机器 PWA

- 打开机器首页，点 + 输入机器链接，在目标机器验证密码后保存卡片；支持多机器、删除、打开联系人与返回。
- 电脑 Chrome/Edge、Android Chrome、iPhone Safari 使用同一套界面；提供 manifest、安装图标和离线机器列表。
- 密码留在目标机器认证流程，列表只保存名称和地址；API、聊天、附件不进入离线缓存。
- 保留 0.4 系列的群聊协作、分享、图片/语音入口及 Agent 会话适配修复。修复 CI 终端切换测试的进程启动竞争，并加入三平台 PWA 检查。

### 下载

- `dili-pwa-0.5.2-all-platforms.tar.gz`：独立静态 PWA，解压部署在 HTTPS 域名根目录，浏览器打开后安装。
- `dili-0.5.2-linux-x86_64.tar.gz`：机器端工作台，需要 Node.js 24+。
- `dili-relay-0.5.2-linux-x86_64.tar.gz`：中继服务包，仍需配置 TLS/Caddy/frps。
- `dili-workbench-0.5.2.tgz`：npm 格式安装包，未发布到 npm registry。
- `SHA256SUMS`：下载校验值。

### 当前限制

PWA 不是原生 APK/IPA/EXE；不同来源的机器可能由系统浏览器打开。机器列表仅保存在当前浏览器/安装实例，不跨设备同步。实际会话与语音需要机器在线及相应权限。自动化覆盖 Chromium 和 WebKit，不能替代 Android/iPhone 真机安装、后台恢复、麦克风与跨域跳转验收。完整说明见包内 INSTALL.md 或 docs/pwa.md。
