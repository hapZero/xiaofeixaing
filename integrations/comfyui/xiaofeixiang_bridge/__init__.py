"""Xiaofeixiang commercial bridge for ComfyUI.

Keeps editor/API workflow versions together and exposes authenticated execution
progress without making the ComfyUI server public to browser clients.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from aiohttp import web
from server import PromptServer

try:
    import folder_paths
except ImportError:  # pragma: no cover - only used outside ComfyUI
    folder_paths = None

BRIDGE_VERSION = "0.2.0"
WEB_DIRECTORY = "./web"
NODE_CLASS_MAPPINGS: dict[str, Any] = {}
NODE_DISPLAY_NAME_MAPPINGS: dict[str, str] = {}


def _storage_root() -> Path:
    configured = os.environ.get("XIAOFEIXIANG_BRIDGE_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if folder_paths and hasattr(folder_paths, "get_user_directory"):
        return Path(folder_paths.get_user_directory()) / "xiaofeixiang_bridge"
    return Path.cwd() / "user" / "default" / "xiaofeixiang_bridge"


ROOT = _storage_root()
WORKFLOWS = ROOT / "workflows"
REGISTRY = ROOT / "registry.json"
WORKFLOWS.mkdir(parents=True, exist_ok=True)


def _read_registry() -> dict[str, Any]:
    if not REGISTRY.exists():
        return {"schemaVersion": 1, "workflows": {}}
    try:
        data = json.loads(REGISTRY.read_text("utf-8"))
        return data if isinstance(data, dict) else {"schemaVersion": 1, "workflows": {}}
    except (OSError, json.JSONDecodeError):
        return {"schemaVersion": 1, "workflows": {}}


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), "utf-8")
    temporary.replace(path)


def _token(request: web.Request) -> str:
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def _authorized(request: web.Request) -> bool:
    expected = os.environ.get("XIAOFEIXIANG_BRIDGE_TOKEN", "").strip()
    provided = _token(request)
    return bool(expected) and bool(provided) and hmac.compare_digest(provided, expected)


def _same_origin_ui(request: web.Request) -> bool:
    source = request.headers.get("origin") or request.headers.get("referer")
    if not source:
        return False
    parsed = urlparse(source)
    return parsed.netloc == request.host and request.headers.get("x-xiaofeixiang-ui") == "1"


def _require_auth(request: web.Request) -> None:
    if not _authorized(request):
        raise web.HTTPUnauthorized(text="Xiaofeixiang bridge token required")


def _workflow_summary(entry: dict[str, Any]) -> dict[str, Any]:
    suggested_capabilities = entry.get("suggestedCapabilities") or _suggest_capabilities(entry["name"], entry.get("nodes", []))
    return {
        "id": entry["id"],
        "name": entry["name"],
        "latestVersion": entry["latestVersion"],
        "updatedAt": entry["updatedAt"],
        "nodeCount": entry["nodeCount"],
        "nodes": entry.get("nodes", []),
        "suggestedCapabilities": suggested_capabilities,
    }


def _suggest_capabilities(name: str, nodes: list[dict[str, Any]]) -> list[str]:
    lowered_name = name.lower()
    if "换角色" in name or "角色替换" in name:
        return []
    if "口型" in name:
        return ["lip_sync"]
    if "原生有声" in name or "音频参考" in name:
        return ["native_audio_video"]
    if "环境音" in name or "声音场" in name:
        return ["ambient_audio"]
    if "音色" in name or "配音" in name or "tts" in lowered_name:
        return ["voice_synthesis"]
    if "人物一致性" in name or "角色标准" in name or "人物标准" in name:
        return ["character_image"]
    if "场景标准" in name:
        return ["scene_image"]
    if "分镜" in name or ("多图" in name and "图片" in name):
        return ["storyboard_frame"]
    if "图生视频" in name or "首尾帧" in name or "多主体视频" in name:
        return ["image_to_video"]
    if "单集合成" in name or "视频合成" in name or "视频拼接" in name:
        return []
    if "剧本" in name or "资产拆解" in name or "脚本" in name:
        return []

    class_types = " ".join(str(node.get("classType", "")) for node in nodes).lower()
    if "savevideo" in class_types or "createvideo" in class_types or "videocombine" in class_types:
        if "loadaudio" in class_types and "loadvideo" in class_types:
            return ["lip_sync"]
        return ["image_to_video"]
    if "saveaudio" in class_types:
        return ["voice_synthesis", "ambient_audio"]
    if "saveimage" in class_types or "previewimage" in class_types:
        return ["character_image", "scene_image", "storyboard_frame"]
    return []


def _node_manifest(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = []
    for node_id, raw in workflow.items():
        if not isinstance(raw, dict):
            continue
        class_type = str(raw.get("class_type", "Unknown"))
        meta = raw.get("_meta") if isinstance(raw.get("_meta"), dict) else {}
        title = str(meta.get("title") or class_type)
        lowered = class_type.lower()
        weight = 2
        if "sampler" in lowered:
            weight = 50
        elif "decode" in lowered:
            weight = 12
        elif "loader" in lowered or "load" in lowered:
            weight = 8
        elif "text" in lowered or "prompt" in lowered:
            weight = 8
        elif "save" in lowered or "combine" in lowered:
            weight = 5
        manifest.append({"id": str(node_id), "classType": class_type, "title": title, "weight": weight})
    return manifest


class ExecutionTracker:
    def __init__(self) -> None:
        self.sequence = 0
        self.executions: dict[str, dict[str, Any]] = {}
        self.events: deque[dict[str, Any]] = deque(maxlen=10_000)
        self.subscribers: set[web.WebSocketResponse] = set()

    def register(self, prompt_id: str, workflow: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
        nodes = _node_manifest(workflow)
        execution = {
            "promptId": prompt_id,
            "status": "queued",
            "currentNodeId": None,
            "currentNodeTitle": None,
            "nodeValue": None,
            "nodeMax": None,
            "overallProgress": 0,
            "completedNodeIds": [],
            "cachedNodeIds": [],
            "nodes": nodes,
            "metadata": metadata,
            "updatedAt": int(time.time() * 1000),
        }
        self.executions[prompt_id] = execution
        # A very small workflow can start before Xiaofeixiang receives the
        # prompt_id and registers it. Replay buffered native events so progress
        # and completion are never lost in that race.
        for event in tuple(self.events):
            if event.get("promptId") == prompt_id:
                self._apply(execution, event["type"], event["data"])
        self._record("registered", {"prompt_id": prompt_id})
        return execution

    def _progress(self, execution: dict[str, Any]) -> int:
        nodes = execution.get("nodes", [])
        total = sum(max(1, int(node.get("weight", 1))) for node in nodes) or 1
        completed = set(execution.get("completedNodeIds", [])) | set(execution.get("cachedNodeIds", []))
        value = sum(max(1, int(node.get("weight", 1))) for node in nodes if node["id"] in completed)
        current_id = execution.get("currentNodeId")
        current = next((node for node in nodes if node["id"] == current_id), None)
        node_max = execution.get("nodeMax")
        node_value = execution.get("nodeValue")
        if current and isinstance(node_max, (int, float)) and node_max > 0 and isinstance(node_value, (int, float)):
            value += max(1, int(current.get("weight", 1))) * min(1, max(0, node_value / node_max))
        return min(100, max(0, round(value / total * 100)))

    def _record(self, event_type: str, data: dict[str, Any]) -> None:
        prompt_id = str(data.get("prompt_id") or data.get("promptId") or "")
        self.sequence += 1
        event = {
            "sequence": self.sequence,
            "type": event_type,
            "promptId": prompt_id or None,
            "occurredAt": int(time.time() * 1000),
            "data": data,
        }
        self.events.append(event)
        if prompt_id and prompt_id in self.executions:
            self._apply(self.executions[prompt_id], event_type, data)
            event["snapshot"] = self.public_snapshot(prompt_id)
        for socket in tuple(self.subscribers):
            if socket.closed:
                self.subscribers.discard(socket)
                continue
            asyncio.create_task(socket.send_json(event))

    def _apply(self, execution: dict[str, Any], event_type: str, data: dict[str, Any]) -> None:
        node_id = data.get("node")
        if event_type in {"execution_start", "executing", "progress"}:
            execution["status"] = "running"
        if event_type == "execution_cached":
            execution["cachedNodeIds"] = [str(item) for item in data.get("nodes", [])]
        if event_type == "executing":
            previous = execution.get("currentNodeId")
            if previous and previous != str(node_id):
                completed = set(execution.get("completedNodeIds", []))
                completed.add(previous)
                execution["completedNodeIds"] = sorted(completed)
            execution["currentNodeId"] = str(node_id) if node_id is not None else None
            node = next((item for item in execution.get("nodes", []) if item["id"] == str(node_id)), None)
            execution["currentNodeTitle"] = node.get("title") if node else None
            execution["nodeValue"] = None
            execution["nodeMax"] = None
        if event_type == "progress":
            execution["currentNodeId"] = str(node_id) if node_id is not None else execution.get("currentNodeId")
            execution["nodeValue"] = data.get("value")
            execution["nodeMax"] = data.get("max")
        if event_type == "executed" and node_id is not None:
            completed = set(execution.get("completedNodeIds", []))
            completed.add(str(node_id))
            execution["completedNodeIds"] = sorted(completed)
        if event_type in {"execution_success", "execution_complete"} or (event_type == "executing" and node_id is None):
            execution["status"] = "succeeded"
            execution["completedNodeIds"] = sorted(item["id"] for item in execution.get("nodes", []))
            execution["currentNodeId"] = None
            execution["currentNodeTitle"] = None
            execution["nodeValue"] = None
            execution["nodeMax"] = None
            execution["overallProgress"] = 100
        elif event_type in {"execution_error", "execution_interrupted"}:
            execution["status"] = "failed"
            execution["error"] = data
        else:
            execution["overallProgress"] = max(int(execution.get("overallProgress", 0)), self._progress(execution))
        execution["updatedAt"] = int(time.time() * 1000)

    def capture(self, event_type: Any, data: Any) -> None:
        if isinstance(data, dict):
            self._record(str(event_type), data)

    def public_snapshot(self, prompt_id: str) -> dict[str, Any] | None:
        execution = self.executions.get(prompt_id)
        if not execution:
            return None
        return {key: value for key, value in execution.items() if key != "nodes"} | {
            "totalNodes": len(execution.get("nodes", [])),
            "completedNodes": len(set(execution.get("completedNodeIds", [])) | set(execution.get("cachedNodeIds", []))),
        }

    def since(self, prompt_id: str, sequence: int) -> list[dict[str, Any]]:
        return [event for event in self.events if event["sequence"] > sequence and event.get("promptId") == prompt_id]


tracker = ExecutionTracker()
workflow_preparations: dict[str, dict[str, Any]] = {}
workflow_preparation_queue: deque[str] = deque()


def _public_preparation(preparation: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in preparation.items() if key != "claimedAt"}


def _valid_library_name(name: str) -> bool:
    return bool(name) and name.endswith(".json") and "/" not in name and "\\" not in name and ".." not in name


def _cleanup_preparations(now: int) -> None:
    expired = [preparation_id for preparation_id, preparation in workflow_preparations.items() if now - int(preparation.get("updatedAt", now)) > 10 * 60 * 1000]
    for preparation_id in expired:
        workflow_preparations.pop(preparation_id, None)


def _install_event_capture() -> None:
    server = PromptServer.instance
    if getattr(server, "_xiaofeixiang_bridge_installed", False):
        return
    if hasattr(server, "send_sync"):
        original_send_sync = server.send_sync

        def send_sync_with_capture(event: Any, data: Any, sid: str | None = None) -> Any:
            tracker.capture(event, data)
            return original_send_sync(event, data, sid)

        server.send_sync = send_sync_with_capture
    elif hasattr(server, "send"):
        original_send = server.send

        async def send_with_capture(event: Any, data: Any, sid: str | None = None) -> Any:
            tracker.capture(event, data)
            return await original_send(event, data, sid)

        server.send = send_with_capture
    server._xiaofeixiang_bridge_installed = True


routes = PromptServer.instance.routes


@routes.get("/xiaofeixiang/bridge/health")
async def health(_: web.Request) -> web.Response:
    return web.json_response({"installed": True, "version": BRIDGE_VERSION, "authenticationRequired": True})


@routes.get("/xiaofeixiang/bridge/workflows")
async def list_workflows(request: web.Request) -> web.Response:
    _require_auth(request)
    registry = _read_registry()
    values = [_workflow_summary(entry) for entry in registry.get("workflows", {}).values()]
    values.sort(key=lambda item: item["updatedAt"], reverse=True)
    return web.json_response({"workflows": values})


@routes.post("/xiaofeixiang/bridge/preparations")
async def request_workflow_preparation(request: web.Request) -> web.Response:
    _require_auth(request)
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not _valid_library_name(name):
        raise web.HTTPBadRequest(text="A valid ComfyUI workflow filename is required")
    now = int(time.time() * 1000)
    _cleanup_preparations(now)
    preparation_id = hashlib.sha256(f"{name}:{now}:{os.urandom(8).hex()}".encode("utf-8")).hexdigest()[:24]
    preparation = {
        "id": preparation_id,
        "name": name,
        "status": "queued",
        "createdAt": now,
        "updatedAt": now,
        "workflowId": None,
        "version": None,
        "error": None,
    }
    workflow_preparations[preparation_id] = preparation
    workflow_preparation_queue.append(preparation_id)
    return web.json_response({"preparation": _public_preparation(preparation)}, status=202)


@routes.get("/xiaofeixiang/bridge/preparations/next")
async def next_workflow_preparation(request: web.Request) -> web.Response:
    if not _same_origin_ui(request):
        raise web.HTTPUnauthorized(text="Preparation polling is only available to the ComfyUI interface")
    now = int(time.time() * 1000)
    _cleanup_preparations(now)
    for preparation_id, preparation in workflow_preparations.items():
        if preparation.get("status") == "preparing" and now - int(preparation.get("claimedAt", now)) > 60_000:
            preparation.update({"status": "queued", "updatedAt": now})
            workflow_preparation_queue.append(preparation_id)
    while workflow_preparation_queue:
        preparation_id = workflow_preparation_queue.popleft()
        preparation = workflow_preparations.get(preparation_id)
        if not preparation or preparation.get("status") != "queued":
            continue
        preparation.update({"status": "preparing", "claimedAt": now, "updatedAt": now})
        return web.json_response({"preparation": _public_preparation(preparation)})
    return web.Response(status=204)


@routes.get("/xiaofeixiang/bridge/preparations/{preparation_id}")
async def get_workflow_preparation(request: web.Request) -> web.Response:
    _require_auth(request)
    preparation = workflow_preparations.get(request.match_info["preparation_id"])
    if not preparation:
        raise web.HTTPNotFound(text="Workflow preparation not found")
    return web.json_response({"preparation": _public_preparation(preparation)})


@routes.post("/xiaofeixiang/bridge/preparations/{preparation_id}")
async def complete_workflow_preparation(request: web.Request) -> web.Response:
    if not _same_origin_ui(request):
        raise web.HTTPUnauthorized(text="Preparation completion is only available to the ComfyUI interface")
    preparation = workflow_preparations.get(request.match_info["preparation_id"])
    if not preparation:
        raise web.HTTPNotFound(text="Workflow preparation not found")
    body = await request.json()
    status = str(body.get("status") or "failed")
    if status not in {"succeeded", "failed"}:
        raise web.HTTPBadRequest(text="Preparation status must be succeeded or failed")
    preparation.update({
        "status": status,
        "workflowId": str(body.get("workflowId") or "") or None,
        "version": str(body.get("version") or "") or None,
        "error": str(body.get("error") or "")[:500] or None,
        "updatedAt": int(time.time() * 1000),
    })
    return web.json_response({"preparation": _public_preparation(preparation)})


@routes.get("/xiaofeixiang/bridge/workflows/{workflow_id}")
async def get_workflow(request: web.Request) -> web.Response:
    _require_auth(request)
    registry = _read_registry()
    entry = registry.get("workflows", {}).get(request.match_info["workflow_id"])
    if not entry:
        raise web.HTTPNotFound(text="Workflow not found")
    version = request.query.get("version") or entry["latestVersion"]
    version_dir = WORKFLOWS / entry["id"] / version
    api_path = version_dir / "api.json"
    if not api_path.exists():
        raise web.HTTPNotFound(text="Workflow version not found")
    return web.json_response({"workflow": _workflow_summary(entry), "version": version, "api": json.loads(api_path.read_text("utf-8"))})


@routes.post("/xiaofeixiang/bridge/workflows/sync")
async def sync_workflow(request: web.Request) -> web.Response:
    if not (_authorized(request) or _same_origin_ui(request)):
        raise web.HTTPUnauthorized(text="Bridge sync is only available to ComfyUI or Xiaofeixiang")
    body = await request.json()
    name = str(body.get("name") or "Untitled Workflow").strip().lstrip("*").strip()[:160]
    api_workflow = body.get("api")
    editor_workflow = body.get("editor")
    if not isinstance(api_workflow, dict) or not api_workflow:
        raise web.HTTPBadRequest(text="API workflow is required")
    workflow_id = hashlib.sha256(name.encode("utf-8")).hexdigest()[:20]
    encoded = json.dumps(api_workflow, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    version = hashlib.sha256(encoded).hexdigest()[:16]
    version_dir = WORKFLOWS / workflow_id / version
    _atomic_json(version_dir / "api.json", api_workflow)
    if isinstance(editor_workflow, dict):
        _atomic_json(version_dir / "editor.json", editor_workflow)
    registry = _read_registry()
    entry = registry.setdefault("workflows", {}).get(workflow_id, {})
    versions = list(dict.fromkeys([version, *entry.get("versions", [])]))[:50]
    now = int(time.time() * 1000)
    entry.update({
        "id": workflow_id,
        "name": name,
        "latestVersion": version,
        "versions": versions,
        "updatedAt": now,
        "nodeCount": len(api_workflow),
        "nodes": _node_manifest(api_workflow),
    })
    entry["suggestedCapabilities"] = _suggest_capabilities(name, entry["nodes"])
    registry["workflows"][workflow_id] = entry
    _atomic_json(REGISTRY, registry)
    return web.json_response({"workflow": _workflow_summary(entry), "version": version})


@routes.post("/xiaofeixiang/bridge/executions/register")
async def register_execution(request: web.Request) -> web.Response:
    _require_auth(request)
    body = await request.json()
    prompt_id = str(body.get("promptId") or "")
    workflow = body.get("workflow")
    if not prompt_id or not isinstance(workflow, dict):
        raise web.HTTPBadRequest(text="promptId and workflow are required")
    snapshot = tracker.register(prompt_id, workflow, body.get("metadata") if isinstance(body.get("metadata"), dict) else {})
    return web.json_response({"execution": tracker.public_snapshot(prompt_id), "registered": bool(snapshot)})


@routes.get("/xiaofeixiang/bridge/executions/{prompt_id}")
async def execution_snapshot(request: web.Request) -> web.Response:
    _require_auth(request)
    prompt_id = request.match_info["prompt_id"]
    snapshot = tracker.public_snapshot(prompt_id)
    if not snapshot:
        raise web.HTTPNotFound(text="Execution not registered")
    since = int(request.query.get("since", "0") or 0)
    return web.json_response({"execution": snapshot, "events": tracker.since(prompt_id, since)})


@routes.get("/xiaofeixiang/bridge/events")
async def execution_events(request: web.Request) -> web.WebSocketResponse:
    _require_auth(request)
    socket = web.WebSocketResponse(heartbeat=25)
    await socket.prepare(request)
    tracker.subscribers.add(socket)
    await socket.send_json({"type": "bridge_ready", "version": BRIDGE_VERSION})
    try:
        async for _ in socket:
            pass
    finally:
        tracker.subscribers.discard(socket)
    return socket


_install_event_capture()
