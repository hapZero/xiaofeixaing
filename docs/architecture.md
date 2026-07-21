# 小飞象工程架构

## 运行边界

```text
Web → NestJS API → PostgreSQL
                 → Redis/BullMQ → Worker → Spark/ComfyUI
                 → S3 兼容对象存储
```

- Web 只调用小飞象 API，不直接访问 ComfyUI、Redis 或对象存储密钥。
- API 负责认证、权限、业务事务、任务创建和结果查询，不执行 GPU 长任务。
- Worker 负责解析能力绑定、调用 ComfyUI、追踪执行状态并保存生成结果。
- PostgreSQL 保存业务权威状态；Redis 只承载队列和短期协调状态；媒体文件进入对象存储。

## 代码依赖方向

- `contracts` 和 `domain` 不依赖框架。
- `database`、`queue`、`storage`、`comfyui-client` 是可替换适配器。
- `api` 和 `worker` 可以依赖共享包；共享包不得反向依赖应用层。
- React feature 通过前端 service 调用 API，不导入服务端适配器。

## 生成任务约束

- 每个任务必须携带稳定幂等键，重复提交不重复执行。
- 队列默认三次指数退避重试，最终失败必须形成可查询记录。
- 工作流按能力注册并版本化，创作者只看到“生成角色”“口型同步”等产品能力。
- 角色音色、场景声音场和资产引用保存为项目级 ID，分镜任务只传引用。
- API 和 Worker 均须支持优雅停机，避免发布时中断正在写入的任务。

## 当前过渡边界

在线原型仍使用 Cloudflare D1/R2 接口验证交互；商用数据链路以 PostgreSQL、Redis、BullMQ 和 S3 兼容存储为准。两套数据层不会混用为同一业务权威来源。
