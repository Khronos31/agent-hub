#!/usr/bin/env python3
"""agent-hub daemon — ポーリングエンジン + HTTP API サーバー。

複数のAIエージェント（claude / codex / agy）と外部エージェント（あかね等）、
人間が参加するグループチャットを提供する。

API方言について:
  Web UI（Antigravity作 app.js）と外部エージェント（あかね）で期待するAPI形式が異なる。
  - Web UI（Ingress経由・Bearerなし）: `./api/config` と UI形式メッセージ {sender, content, isUser, time}
  - 外部エージェント（Bearer hub-キー）: canonical形式 {id, timestamp, sender_id, display_name, message, mentions}
  本daemonは内部をcanonical形式で保存し、リクエストの認証有無で出し分ける。
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import secrets
import shutil
import string
import subprocess
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from aiohttp import web

# --- パス・定数 ---------------------------------------------------------------

DATA_DIR = Path("/config/agent-hub")
SESSIONS_DIR = DATA_DIR / "sessions"
CHAT_LOG = DATA_DIR / "agent_chat.jsonl"
AGENTS_FILE = DATA_DIR / "agents.json"
SCHEMA_FILE = DATA_DIR / "hub_schema.json"
WEB_DIR = Path(__file__).parent / "web"

JST = timezone(timedelta(hours=9))

# 同梱エージェントCLI（コンテナ内ではPATHに /config/.tools/bin が無いためフルパス指定）
CLI = {
    "claude": "/config/.tools/bin/claude",
    "codex": "/config/.tools/bin/codex",
    "agy": "/config/.tools/bin/agy",
}

# 認証情報の置き場（セッションdir作成時にここからシードする）
SHARED_HOME = {
    "claude": "/config/.tools/claude-home",
    "codex": "/config/.tools/codex-home",
    "agy": "/config/.tools/antigravity-home",
}

# セッションdirへコピーする認証ファイル（ベストエフォート。無ければスキップ）
AUTH_SEED = {
    "claude": [".credentials.json", "settings.json"],
    "codex": ["auth.json"],
    "agy": [".gemini"],
}

# タイプ別デフォルトモデル（無闇に高価なモデルを使わない）
DEFAULT_MODEL = {
    "claude": "haiku",
    "codex": "gpt-4o-mini",
    "agy": "gemini-2.0-flash",
}

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {"message": {"type": ["string", "null"]}},
    "required": ["message"],
}

CALL_TIMEOUT = 120

# --- 状態 --------------------------------------------------------------------

_chat_lock = threading.Lock()
_agents_lock = threading.RLock()
running_agents: set[str] = set()


def log(msg: str) -> None:
    print(f"[agent-hub] {msg}", flush=True)


def now_iso() -> str:
    return datetime.now(JST).isoformat(timespec="seconds")


def gen_key() -> str:
    alphabet = string.ascii_letters + string.digits
    return "hub-" + "".join(secrets.choice(alphabet) for _ in range(32))


def resident_name() -> str:
    return os.environ.get("RESIDENT_NAME", "ユーザー")


# --- agents.json -------------------------------------------------------------

def _write_agents(data: dict) -> None:
    tmp = AGENTS_FILE.with_name(AGENTS_FILE.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, AGENTS_FILE)


def load_agents() -> dict:
    with _agents_lock:
        if AGENTS_FILE.exists():
            try:
                return json.loads(AGENTS_FILE.read_text(encoding="utf-8"))
            except Exception as exc:
                log(f"agents.json parse error: {exc}")
        data = {
            "user": {"id": "user", "display_name": resident_name(), "api_key": gen_key()},
            "agents": [],
            "human_display_name": resident_name(),
        }
        _write_agents(data)
        return data


def save_agents(data: dict) -> None:
    with _agents_lock:
        _write_agents(data)


def _update_agent_fields(agent_id: str, fields: dict) -> None:
    with _agents_lock:
        data = load_agents()
        for agent in data["agents"]:
            if agent["id"] == agent_id:
                agent.update(fields)
                break
        save_agents(data)


# --- メッセージ --------------------------------------------------------------

def append_message(msg: dict) -> None:
    with _chat_lock:
        with open(CHAT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")


def read_messages(after_id: str | None = None, limit: int = 200) -> list[dict]:
    if not CHAT_LOG.exists():
        return []
    msgs: list[dict] = []
    with _chat_lock:
        with open(CHAT_LOG, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    msgs.append(json.loads(line))
                except Exception:
                    pass
    if after_id:
        idx = next((i for i, m in enumerate(msgs) if m.get("id") == after_id), None)
        if idx is not None:
            return msgs[idx + 1:]
        return msgs  # after_id が見つからない（ログローテ等）→ 全件返す
    return msgs[-limit:]


def get_messages_since(ts: str, exclude: str | None = None, cap: int = 30) -> list[dict]:
    """last_polled_at（ts）より後のメッセージ。ts が空なら直近 cap 件。"""
    msgs = read_messages(limit=10 ** 9)
    if ts:
        msgs = [m for m in msgs if m.get("timestamp", "") > ts]
    else:
        msgs = msgs[-cap:]
    if exclude:
        msgs = [m for m in msgs if m.get("sender_id") != exclude]
    return msgs


def parse_mentions(text: str, agents: list[dict]) -> list[str]:
    """`@display_name` を agent ID に解決する。長い名前優先で部分一致衝突を避ける。"""
    found: list[str] = []
    for agent in sorted(agents, key=lambda a: len(a.get("display_name", "")), reverse=True):
        name = agent.get("display_name", "")
        if not name:
            continue
        pattern = re.compile(r"@" + re.escape(name) + r"(?!\w)", re.IGNORECASE)
        if pattern.search(text) and agent["id"] not in found:
            found.append(agent["id"])
    return found


def resolve_sender(api_key: str | None, data: dict) -> dict | None:
    if not api_key:
        return None
    if api_key == data["user"].get("api_key"):
        return {"sender_id": "human", "display_name": data["user"].get("display_name", resident_name())}
    for agent in data["agents"]:
        if agent.get("api_key") == api_key:
            return {"sender_id": agent["id"], "display_name": agent.get("display_name", agent["id"])}
    return None


def bearer_key(request: web.Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


# --- UI形式 ⇔ canonical形式 変換 --------------------------------------------

def to_ui_msg(m: dict) -> dict:
    ts = m.get("timestamp", "")
    hhmm = ""
    try:
        hhmm = datetime.fromisoformat(ts).strftime("%H:%M")
    except Exception:
        pass
    return {
        "sender": m.get("display_name") or m.get("sender_id", ""),
        "content": m.get("message", ""),
        "isUser": m.get("sender_id") == "human",
        "time": hhmm,
    }


def to_ui_agent(a: dict) -> dict:
    if a.get("kind") == "external":
        return {"id": a["id"], "type": "external", "name": a.get("display_name", ""), "apiKey": a.get("api_key", "")}
    ah = a.get("active_hours", {})
    return {
        "id": a["id"],
        "type": a.get("type"),
        "name": a.get("display_name", ""),
        "interval": int(a.get("poll_interval_seconds", 3600) // 60),
        "start": ah.get("start", 10),
        "end": ah.get("end", 22),
        "prompt": a.get("system_prompt", ""),
    }


def from_ui_agent(ui: dict, prev: dict | None) -> dict:
    prev = prev or {}
    if ui.get("type") == "external":
        return {
            "id": ui.get("id") or _new_id(ui.get("name"), set()),
            "display_name": ui.get("name", "外部エージェント"),
            "kind": "external",
            "api_key": ui.get("apiKey") or prev.get("api_key") or gen_key(),
            "enabled": prev.get("enabled", True),
            "last_seen_at": prev.get("last_seen_at", ""),
            "last_posted_at": prev.get("last_posted_at", ""),
        }
    agent_type = ui.get("type")
    agent_id = ui.get("id") or agent_type
    return {
        "id": agent_id,
        "display_name": ui.get("name") or agent_type,
        "kind": "builtin",
        "type": agent_type,
        "model": prev.get("model", ""),
        "enabled": prev.get("enabled", True),
        "poll_interval_seconds": int(ui.get("interval", 60)) * 60,
        "active_hours": {"start": int(ui.get("start", 10)), "end": int(ui.get("end", 22))},
        "system_prompt": ui.get("prompt", ""),
        "last_polled_at": prev.get("last_polled_at", ""),
        "last_posted_at": prev.get("last_posted_at", ""),
        "session_dir": str(SESSIONS_DIR / agent_id),
    }


def _new_id(base: str | None, existing: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (base or "").lower()).strip("-")
    if not slug:
        slug = "agent-" + secrets.token_hex(3)
    candidate = slug
    i = 2
    while candidate in existing:
        candidate = f"{slug}-{i}"
        i += 1
    return candidate


# --- セッション管理 ----------------------------------------------------------

def ensure_session(agent: dict) -> Path:
    session_dir = Path(agent.get("session_dir") or (SESSIONS_DIR / agent["id"]))
    if session_dir.exists():
        return session_dir
    session_dir.mkdir(parents=True, exist_ok=True)
    agent_type = agent.get("type")
    shared = Path(SHARED_HOME.get(agent_type, ""))
    for name in AUTH_SEED.get(agent_type, []):
        src = shared / name
        dst = session_dir / name
        try:
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            elif src.exists():
                shutil.copy2(src, dst)
        except Exception as exc:
            log(f"auth seed failed for {agent['id']} ({src}): {exc}")
    log(f"session created: {agent['id']} -> {session_dir}")
    return session_dir


def delete_session(agent_id: str) -> None:
    session_dir = SESSIONS_DIR / agent_id
    try:
        if session_dir.exists():
            shutil.rmtree(session_dir)
            log(f"session deleted: {agent_id}")
    except Exception as exc:
        log(f"session delete failed {agent_id}: {exc}")


# --- エージェント呼び出し ----------------------------------------------------

def model_for(agent: dict) -> str | None:
    model = (agent.get("model") or "").strip()
    return model or DEFAULT_MODEL.get(agent.get("type"))


def build_prompt(agent: dict, data: dict, new_messages: list[dict]) -> str:
    now = datetime.now(JST)
    weekday = ["月", "火", "水", "木", "金", "土", "日"][now.weekday()]
    members = [data["user"].get("display_name", resident_name())] + [a.get("display_name", a["id"]) for a in data["agents"]]
    header = (
        f"現在時刻: {now.strftime('%Y-%m-%d %H:%M')}（{weekday}曜日）\n\n"
        f"グループチャットのメンバー: {', '.join(members)}\n"
        f"あなたは {agent.get('display_name', agent['id'])} です。\n\n"
    )
    if new_messages:
        lines = []
        for m in new_messages:
            ts = m.get("timestamp", "")
            try:
                ts = datetime.fromisoformat(ts).strftime("%Y-%m-%d %H:%M")
            except Exception:
                pass
            lines.append(f"[{ts}] {m.get('display_name', m.get('sender_id', '?'))}: {m.get('message', '')}")
        body = "前回以降のメッセージ:\n\n" + "\n".join(lines)
    else:
        body = "（前回以降、新着メッセージはありません）"
    tail = (
        "\n\n何か言いたいことがあれば {\"message\": \"...\"} を返してください。\n"
        "なければ {\"message\": null} を返してください。"
    )
    return header + body + tail


def run_capture(cmd: list[str], env: dict, timeout: int) -> tuple[int, str, str]:
    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)
        return result.returncode, result.stdout or "", result.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as exc:
        return 1, "", str(exc)


def extract_message(raw) -> dict | None:
    """様々な出力から {"message": ...} を抽出する。"""
    if raw is None:
        return None
    if isinstance(raw, dict):
        if "message" in raw:
            return {"message": raw["message"]}
        if "result" in raw:  # claude --output-format json のエンベロープ
            return extract_message(raw["result"])
        raw = json.dumps(raw, ensure_ascii=False)
    text = str(raw).strip()
    if not text:
        return None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            if "message" in obj:
                return {"message": obj["message"]}
            if "result" in obj:
                return extract_message(obj["result"])
    except Exception:
        pass
    match = re.search(r'\{[^{}]*"message"\s*:\s*(?:"(?:[^"\\]|\\.)*"|null)[^{}]*\}', text)
    if match:
        try:
            obj = json.loads(match.group(0))
            return {"message": obj.get("message")}
        except Exception:
            pass
    return None


def call_claude(agent: dict, session_dir: Path, sys_prompt: str, prompt: str) -> dict | None:
    cmd = [CLI["claude"], "--print", "--continue", "--output-format", "json",
           "--json-schema", json.dumps(OUTPUT_SCHEMA)]
    model = model_for(agent)
    if model:
        cmd += ["--model", model]
    if sys_prompt:
        cmd += ["--system-prompt", sys_prompt]
    cmd += [prompt]
    env = os.environ.copy()
    env["CLAUDE_CONFIG_DIR"] = str(session_dir)
    rc, out, err = run_capture(cmd, env, CALL_TIMEOUT)
    if rc != 0:
        log(f"claude {agent['id']} rc={rc}: {err[:200]}")
    return extract_message(out)


def call_codex(agent: dict, session_dir: Path, sys_prompt: str, prompt: str) -> dict | None:
    out_file = f"/tmp/codex_out_{agent['id']}.json"
    try:
        if os.path.exists(out_file):
            os.remove(out_file)
    except Exception:
        pass
    full_prompt = (f"あなたへの指示: {sys_prompt}\n\n" if sys_prompt else "") + prompt
    common = ["--output-schema", str(SCHEMA_FILE), "-o", out_file]
    model = model_for(agent)
    if model:
        common += ["-m", model]
    env = os.environ.copy()
    env["CODEX_HOME"] = str(session_dir)

    # セッションありなら resume --last、失敗したら exec にフォールバック
    cmd = [CLI["codex"], "exec", "resume", "--last"] + common + [full_prompt]
    rc, _, err = run_capture(cmd, env, CALL_TIMEOUT)
    if rc != 0 or not os.path.exists(out_file):
        cmd = [CLI["codex"], "exec"] + common + [full_prompt]
        rc, _, err = run_capture(cmd, env, CALL_TIMEOUT)
        if rc != 0:
            log(f"codex {agent['id']} rc={rc}: {err[:200]}")

    if os.path.exists(out_file):
        try:
            content = Path(out_file).read_text(encoding="utf-8")
        finally:
            try:
                os.remove(out_file)
            except Exception:
                pass
        return extract_message(content)
    return None


def call_agy(agent: dict, session_dir: Path, sys_prompt: str, prompt: str) -> dict | None:
    full_prompt = (f"あなたへの指示: {sys_prompt}\n\n" if sys_prompt else "") + prompt
    full_prompt += (
        "\n\nJSONのみを返してください。前置き・後置き不要。\n"
        "形式: {\"message\": \"返したい内容\"} または {\"message\": null}"
    )
    cmd = [CLI["agy"], "--print", "--continue"]
    model = model_for(agent)
    if model:
        cmd += ["--model", model]
    cmd += [full_prompt]
    env = os.environ.copy()
    env["HOME"] = str(session_dir)
    rc, out, err = run_capture(cmd, env, CALL_TIMEOUT)
    if rc != 0:
        log(f"agy {agent['id']} rc={rc}: {err[:200]}")
    return extract_message(out)


CALLERS = {"claude": call_claude, "codex": call_codex, "agy": call_agy}


def call_agent(agent: dict) -> None:
    data = load_agents()
    new_messages = get_messages_since(agent.get("last_polled_at", ""), exclude=agent["id"])
    prompt = build_prompt(agent, data, new_messages)
    session_dir = ensure_session(agent)
    sys_prompt = (agent.get("system_prompt") or "").strip()
    caller = CALLERS.get(agent.get("type"))

    result = None
    if caller:
        try:
            result = caller(agent, session_dir, sys_prompt, prompt)
        except Exception as exc:
            log(f"call_agent {agent['id']} error: {exc}")
    else:
        log(f"unknown agent type: {agent.get('type')}")

    _update_agent_fields(agent["id"], {"last_polled_at": now_iso()})

    if result and result.get("message"):
        text = str(result["message"]).strip()
        if text:
            mentions = parse_mentions(text, load_agents()["agents"])
            msg = {
                "id": str(uuid.uuid4()),
                "timestamp": now_iso(),
                "sender_id": agent["id"],
                "display_name": agent.get("display_name", agent["id"]),
                "message": text,
                "mentions": mentions,
            }
            append_message(msg)
            _update_agent_fields(agent["id"], {"last_posted_at": now_iso()})
            log(f"{agent['id']} posted: {text[:60]}")


def call_agent_wrapper(agent: dict) -> None:
    try:
        call_agent(agent)
    finally:
        running_agents.discard(agent["id"])


def spawn_agent(agent: dict) -> None:
    running_agents.add(agent["id"])
    thread = threading.Thread(target=call_agent_wrapper, args=(agent,), daemon=True)
    thread.start()


# --- ポーリングエンジン ------------------------------------------------------

def tick() -> None:
    data = load_agents()
    current_hour = datetime.now(JST).hour
    for agent in data["agents"]:
        if agent.get("kind") != "builtin" or not agent.get("enabled", True):
            continue
        if agent["id"] in running_agents:
            continue

        interval = max(60, int(agent.get("poll_interval_seconds", 3600)))
        base_prob = 1.0 / (interval / 60)

        ah = agent.get("active_hours", {})
        start = ah.get("start", 0)
        end = ah.get("end", 24)
        time_factor = 1.0 if start <= current_hour < end else 0.05

        new_messages = get_messages_since(agent.get("last_polled_at", ""), exclude=agent["id"])
        mentioned = any(agent["id"] in m.get("mentions", []) for m in new_messages)
        if mentioned:
            message_factor = 20.0
        elif new_messages:
            message_factor = 5.0
        else:
            message_factor = 1.0

        prob = min(1.0, base_prob * time_factor * message_factor)
        if random.random() < prob:
            log(f"polling {agent['id']} (prob={prob:.3f}, new={len(new_messages)}, mention={mentioned})")
            spawn_agent(agent)


async def scheduler_loop() -> None:
    while True:
        try:
            tick()
        except Exception as exc:
            log(f"scheduler error: {exc}")
        await asyncio.sleep(60)


# --- HTTP API ----------------------------------------------------------------

async def get_config(request: web.Request) -> web.Response:
    data = load_agents()
    return web.json_response({
        "apiKey": data["user"].get("api_key", ""),
        "agents": [to_ui_agent(a) for a in data["agents"]],
    })


async def post_config(request: web.Request) -> web.Response:
    body = await request.json()
    with _agents_lock:
        data = load_agents()
        existing = {a["id"]: a for a in data["agents"]}
        ids_in_use: set[str] = set()
        new_agents: list[dict] = []
        for ui in body.get("agents", []):
            canon = from_ui_agent(ui, existing.get(ui.get("id")))
            ids_in_use.add(canon["id"])
            new_agents.append(canon)

        # 削除された同梱エージェントのセッションを破棄
        for old_id, old in existing.items():
            if old_id not in ids_in_use and old.get("kind") == "builtin":
                delete_session(old_id)

        data["agents"] = new_agents
        save_agents(data)
        for agent in new_agents:
            if agent.get("kind") == "builtin":
                ensure_session(agent)
    return web.json_response({"success": True})


async def get_messages(request: web.Request) -> web.Response:
    data = load_agents()
    api_key = bearer_key(request)
    after_id = request.query.get("after_id")
    msgs = read_messages(after_id=after_id)

    sender = resolve_sender(api_key, data)
    if sender:
        if sender["sender_id"] != "human":
            _update_agent_fields(sender["sender_id"], {"last_seen_at": now_iso()})
        return web.json_response(msgs)  # canonical形式（あかね等）
    return web.json_response([to_ui_msg(m) for m in msgs])  # UI形式


async def post_message(request: web.Request) -> web.Response:
    data = load_agents()
    api_key = bearer_key(request)
    body = await request.json()

    if api_key:
        sender = resolve_sender(api_key, data)
        if not sender:
            return web.json_response({"error": "invalid api key"}, status=401)
        text = str(body.get("message") or "").strip()
    else:
        # Ingress経由のWeb UIからの人間の発言（{sender, content, isUser, time}）
        sender = {"sender_id": "human", "display_name": data["user"].get("display_name", resident_name())}
        text = str(body.get("content") or body.get("message") or "").strip()

    if not text:
        return web.json_response({"error": "empty message"}, status=400)

    mentions = parse_mentions(text, data["agents"])
    msg = {
        "id": str(uuid.uuid4()),
        "timestamp": now_iso(),
        "sender_id": sender["sender_id"],
        "display_name": sender["display_name"],
        "message": text,
        "mentions": mentions,
    }
    append_message(msg)
    if sender["sender_id"] != "human":
        _update_agent_fields(sender["sender_id"], {"last_posted_at": now_iso()})
    return web.json_response({"id": msg["id"], "timestamp": msg["timestamp"], "mentions": mentions})


async def get_agents(request: web.Request) -> web.Response:
    data = load_agents()
    return web.json_response(data["agents"])


async def add_agent(request: web.Request) -> web.Response:
    body = await request.json()
    with _agents_lock:
        data = load_agents()
        existing_ids = {a["id"] for a in data["agents"]}
        kind = body.get("kind", "external")
        if kind == "external":
            agent_id = _new_id(body.get("display_name"), existing_ids)
            api_key = gen_key()
            agent = {
                "id": agent_id,
                "display_name": body.get("display_name", "外部エージェント"),
                "kind": "external",
                "api_key": api_key,
                "enabled": True,
                "last_seen_at": "",
                "last_posted_at": "",
            }
            data["agents"].append(agent)
            save_agents(data)
            return web.json_response({"id": agent_id, "display_name": agent["display_name"], "api_key": api_key})

        agent_type = body.get("type")
        agent_id = body.get("id") or agent_type
        agent = {
            "id": agent_id,
            "display_name": body.get("display_name", agent_type),
            "kind": "builtin",
            "type": agent_type,
            "model": body.get("model", ""),
            "enabled": True,
            "poll_interval_seconds": int(body.get("poll_interval_seconds", 3600)),
            "active_hours": body.get("active_hours", {"start": 10, "end": 22}),
            "system_prompt": body.get("system_prompt", ""),
            "last_polled_at": "",
            "last_posted_at": "",
            "session_dir": str(SESSIONS_DIR / agent_id),
        }
        data["agents"] = [a for a in data["agents"] if a["id"] != agent_id] + [agent]
        save_agents(data)
        ensure_session(agent)
        return web.json_response({"id": agent_id, "display_name": agent["display_name"]})


async def patch_agent(request: web.Request) -> web.Response:
    agent_id = request.match_info["id"]
    body = await request.json()
    allowed = {"enabled", "poll_interval_seconds", "active_hours", "system_prompt", "display_name", "model"}
    with _agents_lock:
        data = load_agents()
        agent = next((a for a in data["agents"] if a["id"] == agent_id), None)
        if not agent:
            return web.json_response({"error": "not found"}, status=404)
        for key, value in body.items():
            if key in allowed:
                agent[key] = value
        save_agents(data)
    return web.json_response({"success": True})


async def delete_agent(request: web.Request) -> web.Response:
    agent_id = request.match_info["id"]
    with _agents_lock:
        data = load_agents()
        agent = next((a for a in data["agents"] if a["id"] == agent_id), None)
        if not agent:
            return web.json_response({"error": "not found"}, status=404)
        data["agents"] = [a for a in data["agents"] if a["id"] != agent_id]
        save_agents(data)
        if agent.get("kind") == "builtin":
            delete_session(agent_id)
    return web.json_response({"success": True})


async def manual_poll(request: web.Request) -> web.Response:
    agent_id = request.match_info["id"]
    data = load_agents()
    agent = next((a for a in data["agents"] if a["id"] == agent_id and a.get("kind") == "builtin"), None)
    if not agent:
        return web.json_response({"error": "not found"}, status=404)
    if agent_id in running_agents:
        return web.json_response({"status": "already running"})
    spawn_agent(agent)
    return web.json_response({"status": "started"})


async def index(request: web.Request) -> web.Response:
    return web.FileResponse(WEB_DIR / "index.html")


# --- 起動 --------------------------------------------------------------------

async def on_startup(app: web.Application) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    SCHEMA_FILE.write_text(json.dumps(OUTPUT_SCHEMA), encoding="utf-8")
    data = load_agents()
    for agent in data["agents"]:
        if agent.get("kind") == "builtin":
            ensure_session(agent)
    app["scheduler"] = asyncio.create_task(scheduler_loop())
    log(f"started (user={data['user'].get('display_name')}, agents={len(data['agents'])})")


def main() -> None:
    app = web.Application()
    app.add_routes([
        web.get("/api/config", get_config),
        web.post("/api/config", post_config),
        web.get("/api/messages", get_messages),
        web.post("/api/messages", post_message),
        web.get("/api/agents", get_agents),
        web.post("/api/agents", add_agent),
        web.patch("/api/agents/{id}", patch_agent),
        web.delete("/api/agents/{id}", delete_agent),
        web.post("/api/agents/{id}/poll", manual_poll),
        web.get("/", index),
    ])
    app.router.add_static("/", WEB_DIR, show_index=False)
    app.on_startup.append(on_startup)
    web.run_app(app, host="0.0.0.0", port=8098, print=None)


if __name__ == "__main__":
    main()
