# 小飞象工程架构

## 运行边界

```text
Web → NestJS API → PostgreSQL
                 → Redis/BullMQ → Worker → Spark/ComfyUI
                 → S3 兼容对象存储
```

- Web 只调用小飞象 API，不直接访问 ComfyUI、Redis 或对象存储密钥。
- API 负责认证、权限、业务事务、任务创建和结果查询，不执行 GPU 长任务。
- Worker 负责解析能力绑定、调用 ComfyUI、追踪执行状态并保存生成结果；媒体 Worker 负责 FFmpeg 合成和导出。
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

## 短剧生产模型

```text
Project
  ├─ StoryBible（世界规则、时间线、人物关系、叙事方式）
  ├─ ProjectAssets（角色多形象、场景、道具、声音基准）
  └─ Episode
       ├─ Segment（同一场景中的可重做视频片段）
       │    └─ Shot（机位、动作、对白、引用资产、生成计划）
       └─ AudioTracks（对白、环境声、音效、BGM）
```

- 产品层只保存 `storyboard_frame`、`lip_sync`、`ambient_audio` 等语义能力，不保存 ComfyUI 节点号。
- 每个镜头先形成生成计划，片段计划把多个镜头、对白和声音轨组织成依赖图，再由 Worker 将生成能力解析到已启用的工作流版本。
- 对白按行绑定角色和固定音色；场景环境声以独立音轨跨镜头继承，不依赖视频模型随机生成的声音。
- 镜头结果保留版本和质量检查记录，重做镜头不覆盖此前可用结果。
- `segment_compose` 和整集导出是小飞象内部能力，不允许绑定为用户 ComfyUI 工作流。

## 当前过渡边界

在线原型仍使用 Cloudflare D1/R2 接口验证交互；商用数据链路以 PostgreSQL、Redis、BullMQ 和 S3 兼容存储为准。两套数据层不会混用为同一业务权威来源。
