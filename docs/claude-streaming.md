# Claude 原生流式图形对话

Claude 的交互式 TUI 与落盘 JSONL 并不提供实时正文增量。旧「对话记录」每三秒读取一次文件，只能展示已经保存的消息；发送后增加转圈不能改变这一点。

新版使用已安装 Claude CLI 自身的 `--print --input-format stream-json --output-format stream-json --include-partial-messages`，不增加 Agent SDK 依赖或独立模型账户。Claude 继续使用原有登录、项目配置、权限、Auto、工具和历史目录。旧 CLI 缺少增量参数时保留原来的终端与记录界面。

## 代码路径

- `server/claude-chat.ts`：管理每个原生会话独立的 CLI 子进程，处理文本增量、最终消息、工具结果、权限请求、提问及中断。只在内存中维护有上限的图形快照；最终文本用同一消息 ID 替换，避免重复。子进程输出与 HTTP/SSE 的旧快照隔离，保证后续增量能够生成差异补丁。
- `server/chat-api.ts`：Claude 与 Codex 共用现有图形 API、SSE 差异推送、附件归属检查和持久发送去重。读取页面不会启动模型或发送提示词。
- `client/CodexChatPane.tsx`：两种后端共用 Markdown、工具卡片、审批、对话目录、可调输入框、图片、语音、全屏及消息队列，头像与界面文案按实际后端显示。
- `server/index.ts`、`server/adapters.ts`：启动和界面交接。Claude TUI 与流式进程只允许一个持有同一上下文；只有原生确认空闲时才能切换，执行中或等待审批时返回明确提示。

## 使用与边界

更新后端后刷新页面，进入 Claude「图形对话」。已有原生终端会话会保留历史，并提供「切换到流式对话」按钮，等本轮完成后点击；也可以直接点击顶部图形对话入口完成空闲交接。切回终端会恢复同一原生会话，不复制一个独立上下文。

首次启动但还没有输入的 Claude print 会话可能没有生成原生历史文件。Dili 保存这段初始化信息，重新打开时继续使用预分配 ID；尚未发送的 Fork 同时保留来源 ID。接收输入后按正常原生历史恢复，避免空会话出现 “No conversation found”。

生成过程中可以继续编辑；Claude 图形界面的发送会进入可编辑队列，本轮完成后提交下一条，停止生成会暂停队列。Codex 仍使用其原生 `turn/steer` 补充当前任务。旧 Claude 草稿、图片和待核对的发送记录迁移到共享界面；旧排队消息先暂停，防止升级后意外执行。

Claude 支持本次工具允许/拒绝、`AskUserQuestion`、停止生成和图片内容块。没有提供的交互协议明确拒绝，不自动批准。图形历史保持原来的有界最近记录；完整历史仍可在原生终端查看，Claude 暂未提供与 Codex 相同的旧历史分页接口。

后端代码需要正常重启服务才能生效。若当前开发会话由 Dili 自身托管，不能在该会话内重启承载服务；应在独立系统终端中操作。前端构建继续使用保留旧哈希资源、原子更新入口的 `npm run build`。

## 验证

`npm test` 包含协议模拟服务的首段提前到达、SSE、最终去重、请求去重、审批、问题、会话隔离、切换保护及恢复测试。`npm run test:web -- tests/codex-chat.spec.ts tests/native-chat.spec.ts tests/conversation.spec.ts` 覆盖共享界面、动态 Markdown、队列、旧草稿及移动布局。

可选 `npm run test:smoke:claude-chat` 使用真实安装的 Claude CLI、临时配置和工作目录以及本机回环模拟模型接口，验证生成结束前的正文增量、最终去重、图片、上下文恢复、Fork、空会话重新打开、工具审批与中断。测试不调用付费模型，也不修改用户的原生配置。它验证 CLI 接口兼容性，不代表真实服务商的延迟与可用性。
