# AutoCut Desktop Standardization Implementation Plan

日期：2026-05-04
状态：in progress

## Goal

将 `sdkwork-video-cut` 打磨为标准 pnpm workspace + package-local Tauri
桌面应用，同时保持 `packages/sdkwork-autocut-*` 中既有产品设计、视觉效果和
交互语义不变。

## Current Architecture Decision

桌面应用定义在 `packages/sdkwork-autocut-desktop`，对齐
`sdkwork-birdcoder/packages/sdkwork-birdcoder-desktop` 的架构模式。

根目录只负责 workspace 编排，不再定义：

- `src/`
- `src-tauri/`
- `index.html`
- `vite.config.ts`
- `public/`

## Implementation Tracks

- [x] 建立 `scripts/check-autocut-architecture.mjs` 治理检查。
- [x] 建立 `docs/architecture/16-autocut-frontend-module-standard.md` 前端模块标准。
- [x] 建立 `docs/architecture/17-autocut-database-contract-standard.md` 数据库契约标准。
- [x] 将 Tauri/Vite/HTML/React bootstrap 迁入 `packages/sdkwork-autocut-desktop`。
- [x] 根 `package.json` 改为代理 desktop package 命令。
- [x] 所有 AutoCut package 使用 package-local `tsconfig.json`。
- [x] 任务类型统一到 `AUTOCUT_TASK_TYPES`。
- [x] 任务状态统一到 `AUTOCUT_TASK_STATUS`。
- [x] 浏览器下载、Blob/object URL、storage、datetime、diagnostics、browser API、
      media fixtures 统一到 service helper。
- [x] 数据库治理遵循 `DATABASE_SPEC.md`，强制未来表定义包含 `id`、`uuid`，且
      `id` 为 long/int64 语义。
- [ ] 完成全量验证：architecture、typecheck、test、Rust check、Vite build、
      Tauri build。

## Verification Commands

```bash
pnpm check:autocut-architecture
pnpm typecheck
pnpm test
cargo check --manifest-path packages/sdkwork-autocut-desktop/src-tauri/Cargo.toml
pnpm build
pnpm tauri:build
```

## Delivery Rule

任何后续新增模块必须先进入标准文档和治理脚本，再写实现。当前应用是新应用，
不保留兼容债；发现旧根入口、旧 host/deploy/models 源树、手写 HTTP/server
入口或未声明依赖时，优先删除或迁移到 package 边界。
