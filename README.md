# 小飞象

面向单人创作者的 AI 短剧生产平台。前台组织剧本、资产、分镜、声音与成片，Spark 上的 ComfyUI 作为隐藏执行层。

## 工程结构

```text
app/                       Web 产品（React/TypeScript，本地产品入口）
apps/api/                  NestJS 业务 API
apps/worker/               BullMQ 生成任务 Worker
packages/config/           环境配置读取与校验
packages/contracts/        跨进程命令、事件与 API 契约
packages/domain/           纯领域模型与业务规则
packages/database/         PostgreSQL/Drizzle 数据层
packages/queue/            Redis/BullMQ 队列适配器
packages/storage/          S3 兼容对象存储适配器
packages/comfyui-client/   Spark/ComfyUI API 客户端
infra/docker/              本地 PostgreSQL、Redis、MinIO
infra/postgres/migrations/ PostgreSQL 迁移
docs/                      产品开发计划与架构说明
```

Web 暂时保留在仓库根目录；业务后端已经按 monorepo 工作区隔离。开发与验收以本地环境为准，正式部署方案在商用链路完成后确定。

## 本地启动

```bash
npm install
npm run infra:up
npm run db:migrate:platform
cp .env.platform.example .env.platform.local
```

在不同终端按示例环境变量启动：

```bash
npm run dev
DATABASE_URL=postgresql://xiaofeixiang:xiaofeixiang_local@localhost:5432/xiaofeixiang REDIS_URL=redis://localhost:6379 npm run dev:api
REDIS_URL=redis://localhost:6379 COMFYUI_URL=http://spark-host:8188 npm run dev:worker
```

## 质量检查

```bash
npm run typecheck:platform
npm run lint
npm test
```

详细边界见 [docs/architecture.md](docs/architecture.md)，开发顺序见 [docs/development-plan.md](docs/development-plan.md)。
