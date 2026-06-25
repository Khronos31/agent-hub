# Agent Hub — 開発ガイド

## 概要

HAOS アドオン。AIエージェント（Claude Code / Codex / Antigravity / あかね）と人間が参加するグループチャットを提供する。

- **チャットログ**: `/config/agent-hub/agent_chat.jsonl`（JSONL、追記のみ）
- **エージェント設定**: `/config/agent-hub/agents.json`
- **Web UI**: Ingress（ポート 8098）でホスト

## ディレクトリ構成

```
agent_hub/
  config.yaml       # アドオンマニフェスト
  build.yaml        # アーキテクチャ別ベースイメージ
  Dockerfile
  run.sh            # エントリポイント（PATH・環境変数を設定して daemon.py を起動）
  requirements.txt
  daemon.py         # ポーリングエンジン + HTTP API サーバー（aiohttp）
  web/
    index.html      # チャット + 設定の SPA
    style.css
    app.js
```

## daemon.py の責務

1. **HTTP API サーバー**（ポート 8098）
   - `GET /api/messages?after_id=<uuid>` — メッセージ取得
   - `POST /api/messages` — メッセージ投稿（Bearer 認証）
   - `GET /api/agents` / `POST` / `PATCH /{id}` / `DELETE /{id}` — エージェント管理
   - `POST /api/agents/{id}/poll` — 手動ポーリングトリガー
   - `GET /` — index.html を配信（ユーザーAPIキーを JS に埋め込んで動的配信）

2. **ポーリングエンジン**（毎60秒）
   - 同梱エージェント（claude / codex / agy）を確率的に呼び出す
   - `running_agents` セットで多重呼び出しを防止
   - 確率係数: 時間帯 × 新着メッセージ（×5） × メンション（×20）

3. **メンション解析**
   - `POST /api/messages` 受信時に `@display_name` を agent ID に解決して `mentions` フィールドに保存

## 同梱エージェントの呼び出し

CLIは `/config/.tools/bin/` に永続化済み（`run.sh` で PATH に追加済み）。

| タイプ | コマンド | セッション |
|---|---|---|
| `claude` | `claude --print --continue --output-format json --json-schema ...` | `CLAUDE_CONFIG_DIR=<session_dir>` |
| `codex` | `codex exec resume --last --output-schema ... -o <file>` | `CODEX_HOME=<session_dir>` |
| `agy` | `agy --print --continue` | `HOME=<session_dir>` |

セッションディレクトリ: `/config/agent-hub/sessions/<agent_id>/`
エージェント削除時にディレクトリごと消去（記憶の消去 = 別人になる）。

## 実装上の注意

- `agent_chat.jsonl` の書き込みは `threading.Lock` でスレッドセーフに
- `agents.json` の更新は `tmp + os.replace` でアトミックに
- CLI のフルパスは不要（`run.sh` で `/config/.tools/bin` を PATH に追加済み）
- ポート 8098 は Embodied HA アドオン（8099）と被らないよう固定

## コミット規約

すべてのコミットメッセージの末尾に、作業したエージェントの `Co-Authored-By` トレーラーを付けること。

| エージェント | トレーラー |
|---|---|
| Codex | `Co-Authored-By: Codex <noreply@openai.com>` |
| Antigravity | `Co-Authored-By: Antigravity <noreply@google.com>` |
| Claude | `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` |

例:
```
feat: improve chat polling logic

Co-Authored-By: Codex <noreply@openai.com>
```

## 変更時のルール

- `daemon.py` 以外のファイル（`web/` / `config.yaml` 等）は担当者が分かれているので、必要な変更だけ行うこと
- バージョンは `config.yaml` の `version` フィールドを SemVer で管理
