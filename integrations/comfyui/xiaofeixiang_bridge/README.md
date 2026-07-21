# 小飞象 ComfyUI 工作流桥接器

该扩展安装在 Spark 的 ComfyUI 中，负责：

- 在 ComfyUI 执行或手动同步工作流时，自动保存编辑版和 API 执行版。
- 通过版本哈希固定每次商用执行所使用的工作流版本。
- 捕获 `executing`、`progress`、`executed`、`execution_error` 等真实节点事件。
- 仅向持有桥接令牌的小飞象服务端开放工作流和执行信息。

## 安装

将整个 `xiaofeixiang_bridge` 目录复制到：

```text
ComfyUI/custom_nodes/xiaofeixiang_bridge
```

为 ComfyUI 进程设置一个随机令牌：

```bash
export XIAOFEIXIANG_BRIDGE_TOKEN="请替换为至少32位随机字符串"
```

重启 ComfyUI。健康检查地址：

```text
GET /xiaofeixiang/bridge/health
```

在 ComfyUI 中打开并执行一次已有工作流，或使用命令面板中的“同步当前工作流到小飞象”。之后小飞象即可直接读取 API 执行版，不再要求上传 JSON。

## 安全边界

- 浏览器侧只允许同源 ComfyUI 页面同步当前工作流。
- 工作流读取、版本读取和执行事件接口必须使用 Bearer Token。
- 桥接器不修改模型、节点和工作流参数，也不向浏览器暴露小飞象凭据。

