# The terminal bridge

`atur-bridge` (`apps/bridge`) is a small daemon that runs on the machine where your coding agents work. It lets the Atur web app and the phone app show your agents' terminal panes live, type into them, and push a notification when an agent finishes or needs you.

```
Atur Cloud (customers):
phone / browser -> Atur Worker (auth, audit) -> BridgeRelay Durable Object <== wss (the bridge dials out) == atur-bridge -> herdr, tmux or Muxy

Self-host / tunnel:
phone / browser -> Atur Worker (auth, audit) -> tunnel -> atur-bridge (127.0.0.1:7601) -> herdr, tmux or Muxy
                                                     atur-bridge -> POST /api/bridge/agent-events -> Worker -> push
```

The bridge binds `127.0.0.1` only. It drives one terminal multiplexer, called the backend:

- **tmux**: works with any agent running in a tmux pane (Claude Code, Codex, omp, anything else). No extra software.
- **herdr**: herdr (a terminal multiplexer for agents) detects agents and their state by itself.
- **Muxy**: [Muxy 2](https://muxy.app) (a desktop terminal multiplexer, macOS and Linux) detects agents and their state by itself; the bridge drives it through its `muxy` CLI.

## Connect a machine to Atur Cloud

Needs an Atur plan (Solo or Team) and tmux, herdr or Muxy on the machine. No tunnel, no open port, no Bun: the bridge is a single binary that dials out to `app.diatur.com`.

1. In [app.diatur.com](https://app.diatur.com), open the **Machines** page and create a machine. Copy its install command. The token (`atb_...`) is shown once.
2. Run it on the machine whose terminals you want to reach:

   ```bash
   curl -fsSL https://diatur.com/install-bridge.sh | sh -s -- atb_xxxxxxxx
   ```

3. Done. The machine turns **online** on the Machines page, and its tmux panes show up in the app. Every pane on the machine is listed and can be attached by you: for Cloud machines ownership of the machine is the only access check, and workspace bindings (which are paths on the owner's own machine) do not apply. Several machines can share one account: panes are prefixed with the machine, and each machine has its own token. Images pasted from the phone are limited to 10 MiB over the relay.

The installer:

- picks the binary for your OS and CPU (Linux or macOS, x64 or arm64) from the newest `bridge-v*` [GitHub Release](https://github.com/dzulfikar08/atur/releases), checks it against `SHA256SUMS` and installs `~/.local/bin/atur-bridge`;
- runs `atur-bridge connect <token>`, which saves `ATUR_CONNECT_TOKEN` in `~/.config/atur/bridge.env` (mode 600, other keys in the file are kept);
- writes the agent hook scripts to `~/.config/atur/hooks` (see [Agent state with tmux](#agent-state-with-tmux));
- installs and starts a service that restarts on failure: a systemd user unit `atur-bridge.service` on Linux (it runs `loginctl enable-linger` so it survives logout), a launchd agent `com.diatur.atur-bridge` on macOS (log: `~/Library/Logs/atur-bridge.log`).

Re-running it updates the binary and restarts the service; your settings stay. It refuses to run as root (the bridge must run as the user who owns the tmux server); set `ATUR_INSTALL_FORCE_ROOT=1` to override. `ATUR_INSTALL_DRY_RUN=1` prints what it would do and changes nothing. `ATUR_BRIDGE_VERSION=bridge-v0.1.0` pins a release.

The bridge keeps one outbound WebSocket to `wss://app.diatur.com/api/bridge/connect`, authenticated with the machine token, and the cloud sends pane listing, attach/observe sockets and pasted images through it. Agent push events travel over the same socket (nothing is POSTed). If the connection drops it reconnects with a 1 to 30 second backoff. A revoked or wrong token (close 4401) stops it with a clear log line; an account without a plan (4402) is retried every 10 minutes.

```bash
atur-bridge                  # run in the foreground (the service does this)
atur-bridge connect atb_...  # save or replace the machine token
atur-bridge hooks [dir]      # write the agent hook scripts (default ~/.config/atur/hooks)
atur-bridge --version
journalctl --user -u atur-bridge -f    # Linux logs; the line to look for is "relay: connected"
```

Revoke a machine on the Machines page and its token stops working at once. The loopback server (`127.0.0.1:7601`) is still protected by a token: when `BRIDGE_TOKEN` is unset the bridge generates a random one at startup, so nothing on the machine can talk to it without that secret.

### Building the binaries

`apps/bridge/scripts/build-binaries.sh` runs `bun build --compile` for `linux-x64`, `linux-arm64`, `darwin-x64` and `darwin-arm64` (cross-compiled from any machine, needs network the first time) and writes `apps/bridge/dist/atur-bridge-<os>-<arch>` plus `dist/SHA256SUMS`. Pass target names to build only some. The binary embeds the hook scripts (they are not separate files in a release): `atur-bridge hooks` writes them out.

To release: bump `version` in `apps/bridge/package.json`, then `git tag bridge-vX.Y.Z && git push origin bridge-vX.Y.Z`. `.github/workflows/release-bridge.yml` checks the tag against the version, runs the tests, builds the four binaries and attaches them with `SHA256SUMS` to a Release named after the tag.

## Self-host: run it yourself behind a tunnel

This is the path for your own Worker (`HERDR_BRIDGE_URL` / `HERDR_BRIDGE_TOKEN`, see [Reaching the bridge from the Worker](#reaching-the-bridge-from-the-worker)). It keeps working unchanged: without `ATUR_CONNECT_TOKEN` the bridge does not dial out, and it POSTs agent events to `ATUR_URL` as before.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer.
- tmux 3.1 or newer (for the tmux backend), herdr, or Muxy 2.2 or newer.
- Git, only for worktree-aware pane binding.

## Install and run

```bash
git clone https://github.com/dzulfikar08/atur.git
cd atur/apps/bridge
bun install
BRIDGE_TOKEN=$(openssl rand -hex 24) bun run src/main.ts
```

It prints `terminal backend: tmux` (or `herdr`, `muxy`) and `atur-bridge listening on 127.0.0.1:7601`. Check it:

```bash
curl -s -H "x-bridge-token: $BRIDGE_TOKEN" http://127.0.0.1:7601/panes
```

Start your agents inside tmux (`tmux new -s work`, then `claude` or `codex`) and they show up in that list.

On the self-host path, a pane only appears in the app when its working directory is inside a checkout bound to an Atur workspace (`set_workspace_link` / the workspace link settings, `local_path`). Git worktrees resolve to their main repository, so crew worktrees inherit the binding. Panes in other directories stay invisible.

### Environment

| Variable             | Default                      | Meaning                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGE_PORT`        | `7601`                       | Local port (always bound on `127.0.0.1`).                                                                                                                                                                                                                                    |
| `BRIDGE_TOKEN`       | random per run               | Shared secret. Clients must send it as `x-bridge-token`. Unset: a random one is generated at startup, so the loopback server is never open. For the tunnel setup also the key for push events: **no token, no notifications.** Must equal the Worker's `HERDR_BRIDGE_TOKEN`. |
| `ATUR_CONNECT_TOKEN` | empty                        | Machine token (`atb_...`) from the Machines page. Set: the bridge dials out to Atur Cloud (see above) and sends agent events over that socket. `atur-bridge connect <token>` writes it to `~/.config/atur/bridge.env`.                                                       |
| `ATUR_BRIDGE_ENV`    | `~/.config/atur/bridge.env`  | Settings file. On a foreground run the bridge reads it for every variable not already in the environment.                                                                                                                                                                    |
| `BRIDGE_BACKEND`     | auto                         | `herdr`, `tmux`, `muxy` or `auto`. Auto picks herdr when its socket exists, then Muxy when its server socket exists, otherwise tmux when the `tmux` binary is on `PATH`. Pin it in a service, so a herdr or Muxy that is slow to start never flips you to tmux.              |
| `HERDR_SOCKET`       | `~/.config/herdr/herdr.sock` | herdr socket path.                                                                                                                                                                                                                                                           |
| `TMUX_SOCKET`        | tmux default server          | Socket of the tmux server to drive. A value containing `/` is a path (`tmux -S`), a bare name is a socket name (`tmux -L`).                                                                                                                                                  |
| `MUXY_DIR`           | Muxy's data directory        | Muxy profile to drive, as for the `muxy` CLI. Default: `~/Library/Application Support/Muxy 2` on macOS, `$XDG_STATE_HOME/muxy` (or `~/.local/state/muxy`) on Linux. Its `server.sock` is what auto-detection looks for.                                                      |
| `MUXY_BIN`           | `muxy` on `PATH`             | The `muxy` CLI. Falls back to the binary inside `/Applications/Muxy.app` on macOS, where the app does not put it on `PATH`.                                                                                                                                                  |
| `ATUR_URL`           | `https://app.diatur.com`     | Atur server: the relay endpoint (`/api/bridge/connect`) and the target of agent events. Set it to your own server when self-hosting.                                                                                                                                         |
| `AGENT_POLL_MS`      | `2000`                       | How often the bridge looks at agent states for push events.                                                                                                                                                                                                                  |
| `ATUR_PASTE_DIR`     | `~/.cache/atur/pastes`       | Where images pasted from the phone are saved before their path goes into the prompt.                                                                                                                                                                                         |

Desktop sharing (`/screen`) has its own `SCREEN_*` options, see [DEPLOY.md](DEPLOY.md#6-screen-desktop-sharing).

### systemd user service

`~/.config/atur/bridge.env`:

```
BRIDGE_PORT=7601
BRIDGE_TOKEN=<the same value as HERDR_BRIDGE_TOKEN on the Worker>
BRIDGE_BACKEND=tmux
ATUR_URL=https://atur.example.com
```

`~/.config/systemd/user/atur-bridge.service`:

```ini
[Unit]
Description=atur-bridge: terminal gateway for Atur (127.0.0.1:7601)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=%h/atur/apps/bridge
EnvironmentFile=%h/.config/atur/bridge.env
ExecStart=%h/.bun/bin/bun run src/main.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now atur-bridge
loginctl enable-linger "$USER"   # keep it running after you log out
journalctl --user -u atur-bridge -f
```

Run the service as the same user that owns the tmux server, or point `TMUX_SOCKET` at that server's socket (`tmux display -p '#{socket_path}'`). tmux sockets are per user.

## Reaching the bridge from the Worker

The Worker is the front door: it authenticates the user, checks the pane belongs to one of their workspaces, then relays to the bridge. The bridge must therefore be reachable from Cloudflare, and a Cloudflare Tunnel does that without opening a port.

```bash
cloudflared tunnel login
cloudflared tunnel create atur-bridge
cloudflared tunnel route dns atur-bridge bridge.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: bridge.example.com
    service: http://127.0.0.1:7601
  - service: http_status:404
```

Run it as a user service next to the bridge (`ExecStart=cloudflared tunnel run <tunnel-id>`, `Requires=atur-bridge.service`), then give the Worker its two secrets (see `apps/app/wrangler.toml` and the screen section of [DEPLOY.md](DEPLOY.md)):

```bash
cd apps/app
bunx wrangler secret put HERDR_BRIDGE_URL     # https://bridge.example.com
bunx wrangler secret put HERDR_BRIDGE_TOKEN   # same value as BRIDGE_TOKEN
```

For local development, `HERDR_BRIDGE_URL=http://127.0.0.1:7601` in `apps/app/.dev.vars` needs no tunnel. The names say herdr for historical reasons; they apply to every backend.

The Worker holds one bridge URL, so one Worker talks to one bridge (one machine).

## herdr, tmux or Muxy

| Feature                          | herdr                                            | tmux                                                                                              | Muxy                                                                      |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Live pane mirror, typing, paste  | yes                                              | yes                                                                                               | yes                                                                       |
| Images pasted into prompts       | yes                                              | yes                                                                                               | yes                                                                       |
| Scrollback on the phone          | up to 1000 rows (herdr limit)                    | up to the pane's `history-limit` (2000 by default)                                                | whatever Muxy keeps (a byte budget), read 500 rows per CLI call           |
| Agent detection                  | automatic                                        | hooks in the agent, or the process name (`claude`, `codex`, `omp`, `opencode`, `gemini`, `aider`) | automatic (Muxy's providers: omp, Claude Code, Codex, OpenCode, …)        |
| Agent state (working, needs you) | automatic                                        | via hooks, see below. Without hooks the state is "unknown" and there are no pushes                | automatic                                                                 |
| Push: finished / needs you       | yes                                              | yes, once the hooks are installed                                                                 | yes                                                                       |
| Push text (last reply, question) | omp panes only                                   | none, the push carries the pane title                                                             | none: Muxy exposes no title or agent transcript path                      |
| Phone-sized panes                | an invisible herdr client attaches at phone size | the pane's window is resized to the phone grid (`window-size manual`) while the phone is open     | no: a session keeps the size of the Muxy window showing it                |
| Workspace / tab                  | herdr workspace / tab                            | tmux session / window                                                                             | Muxy project / session                                                    |
| Pane id                          | `wR:p2`                                          | `%3`                                                                                              | the session id, e.g. `15178128752692842423`                               |
| New workspace / split / close    | `workspace.create`, `pane.split`, `pane.close`   | `new-session -d`, `split-window`, `kill-pane`                                                     | `project add --reuse` + `session create`, `session create`, `session end` |

With tmux the resize is visible on the desktop: a terminal attached to that window shows it at phone size while the phone is open. The bridge puts the window back (and your own `window-size` setting, if you had one) 15 seconds after the last phone viewer leaves, or when the bridge stops.

With Muxy, tabs and splits belong to the desktop app, not the server, so the bridge sees each terminal (session) on its own. Keys reach the session as the bytes a terminal sends (`\r`, `\x1b[A`, ...), and multi-line text goes in as one bracketed paste: an agent or shell that has not turned bracketed paste on sees the paste markers. Paste markers inside pasted text are removed.

A pane's `cwd` is the directory its session started in: Muxy does not report where a session `cd`-ed to since, so a pane only matches a bound checkout (see [Install and run](#install-and-run)) if it started inside it.

Any `muxy` command starts a Muxy server when none runs, and that server's terminals inherit the environment of whoever started it. The bridge therefore only lets creating a workspace start one (as tmux does with `new-session`): before anything else it connects to the server socket, and while no server answers there (stopped, or crashed and left a stale socket file), `/panes` is empty and pane commands answer 404. The bridge also drops its own settings (`ATUR_*`, `BRIDGE_*`) from the environment it runs `muxy` with, so a server it starts never hands the machine token to your agents.

## Managing panes

Besides watching panes, the phone app can open a workspace, split a pane and close one. The bridge serves four more routes (all behind `x-bridge-token` like the rest; code in `apps/bridge/src/manage.ts`):

| Route               | Body                                         | Answer                                                    |
| ------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `GET /workspaces`   | none                                         | `{workspaces: [{id, label, cwd, pane_count}]}`            |
| `POST /workspaces`  | `{cwd, label?}`                              | `201 {workspace, pane}`: the workspace and its first pane |
| `POST /panes/split` | `{pane, direction: "right" \| "down", cwd?}` | `201 {pane}`: the new pane                                |
| `POST /panes/close` | `{pane}`                                     | `204`                                                     |

`pane` objects have the same shape as the rows of `GET /panes`. Errors are `{error}` with `400` (bad input), `404` (unknown pane), `409` (tmux: a session of that name exists) or `502` (the backend failed).

- **Input checks.** `cwd` must be an absolute path to an existing directory (it is `stat`ed; control characters and more than 4096 characters are refused). `label` is optional, at most 64 characters, no control characters. The body is JSON, at most 8 KiB.
- **Where the new pane starts.** A split starts in the source pane's current directory unless `cwd` is given (Muxy: the directory the source session started in). A workspace's first pane starts in `cwd`.
- **No focus change.** The new workspace or pane does not take focus on the desktop (herdr `focus: false`, tmux `-d`; Muxy sessions created from the CLI never take focus).
- **herdr.** `workspace.create`, `pane.split` and `pane.close` over the socket. Closing the last pane of a workspace closes the workspace (herdr's rule).
- **tmux.** A workspace is a detached session (`new-session -d -s <label> -c <cwd>`; the label defaults to the folder name, and tmux turns `.` and `:` into `_`). A split is `split-window -d -h` (right) or `-v` (down); close is `kill-pane`. Closing a session's last pane ends the session.
- **Muxy.** A workspace is a project (`muxy project add <cwd> --reuse`: a folder Muxy already knows opens in its existing project, and the label then stays the project's name) with a new session in it. A label starting with `--` is refused with `400` (the CLI would read it as an option). A split is a new session in the source pane's project, whatever the direction; the desktop app lists it under Existing Terminals rather than as a split. Close is `session end`, which keeps the session's saved output in Muxy.
- **Over the relay** these are ordinary `req` frames to the machine's bridge, so no relay protocol change was needed. A bridge that predates these routes answers its generic `404 {"error":"not found"}`; the Worker turns that into `501` "this bridge is too old to manage panes; update atur-bridge".
- There is no route to close a whole workspace: close its panes, or use `herdr workspace close`.

`GET /panes` now asks herdr for one unfiltered pane list. It used to send `workspace` (herdr's filter is `workspace_id`, and an unknown key is ignored), so every pane came back once per workspace under that workspace's label and the first label won. Workspace labels in the app were wrong before this fix; restart the bridge to get the fix.

## Agent state with tmux

tmux has no idea what an agent is doing, so the agent reports it. A hook sets two pane options, which the bridge reads on every poll:

| Pane option     | Values                                            |
| --------------- | ------------------------------------------------- |
| `@atur_status`  | `idle`, `working`, `blocked`, `done`              |
| `@atur_agent`   | agent name shown in the app, for example `claude` |
| `@atur_session` | optional: path of the agent's session file        |

The app shows `working`, `blocked` (**Needs you**) and `done`. A push goes out when a pane moves from `working` to `done` or `idle`, or enters `blocked`, and the state still holds three seconds later. The bridge ships the scripts in `apps/bridge/hooks/`:

- `tmux-status.sh <agent> <idle|working|blocked|done|off>` sets (or with `off` clears) the options on `$TMUX_PANE`. Does nothing outside tmux, never prints, never fails the agent.
- `claude-code-status.sh <state>` and `codex-status.sh <state>` are one-line wrappers that pass the agent name.

Use absolute paths in the configs below (replace `/home/you/atur/apps/bridge/hooks` with `~/.config/atur/hooks` expanded, if you installed the binary: `atur-bridge hooks` writes the scripts there, executable, and refreshes them on every run) and keep the scripts executable.

You can try it by hand inside a tmux pane:

```bash
/home/you/atur/apps/bridge/hooks/claude-code-status.sh working
tmux display -p '#{@atur_agent} #{@atur_status}'
```

### Claude Code

Add this to `~/.claude/settings.json` (all projects) or a project's `.claude/settings.json`. Events and matchers are from the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks). If you already have a `hooks` block, merge the keys.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh idle"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh working"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh blocked"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|elicitation_dialog|agent_needs_input",
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh blocked"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh working"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh done"
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh blocked"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/claude-code-status.sh off"
          }
        ]
      }
    ]
  }
}
```

How the events map:

| Event               | State     | Why                                                                                                     |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `SessionStart`      | `idle`    | Session opened or resumed.                                                                              |
| `UserPromptSubmit`  | `working` | A turn starts.                                                                                          |
| `PermissionRequest` | `blocked` | Fires the moment Claude asks to run a tool. The script prints nothing, so it neither allows nor denies. |
| `Notification`      | `blocked` | Catch-all for prompts that wait on you (`permission_prompt` only fires after about 6 s).                |
| `PostToolUse`       | `working` | The tool ran, so the approval was given: back to working.                                               |
| `Stop`              | `done`    | Claude finished responding.                                                                             |
| `StopFailure`       | `blocked` | The turn ended on an API error, which needs a look.                                                     |
| `SessionEnd`        | cleared   | The pane is a plain shell again.                                                                        |

Known gap: Claude Code does not run `Stop` when you interrupt a turn yourself, so the pane stays `working` until your next prompt.

### Codex

Codex has lifecycle hooks too (see the [Codex hooks docs](https://developers.openai.com/codex/hooks)). Put this in `~/.codex/hooks.json`, then open `/hooks` in Codex once to review and trust the new hooks: Codex skips hooks it has not trusted.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh idle" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh working"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh blocked"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh working"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh done" }
        ]
      }
    ],
    "Interrupt": [
      {
        "hooks": [
          { "type": "command", "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh idle" }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "/home/you/atur/apps/bridge/hooks/codex-status.sh off" }
        ]
      }
    ]
  }
}
```

The older `notify` setting in `config.toml` only reports finished turns, so it cannot show `working` or `blocked`. Use the hooks.

### Other agents

Any agent that can run a command on its own events can call `tmux-status.sh <name> <state>`. An agent without hooks still appears with its pane, mirror and input, but its state is "unknown" and it sends no pushes.

## Troubleshooting

- The machine stays offline on the Machines page: read the log (`journalctl --user -u atur-bridge -f`). `relay: offline, ...; retrying` is a network problem (the line is printed once, not per retry). `the machine token was rejected` means the token was revoked or mistyped: create a new one and run `atur-bridge connect <token>`, then `systemctl --user restart atur-bridge`. `needs an active plan` means the account has no Solo or Team plan.
- `replaced by another connection using this token`: two bridges are using the same machine token. Give each machine its own token.
- `no terminal backend found`: no herdr socket, no Muxy server socket and no `tmux` binary were found. Install tmux, start herdr or Muxy, or set `BRIDGE_BACKEND` (and `HERDR_SOCKET` or `MUXY_DIR`).
- `/panes` is empty with Muxy: Muxy is not running (the bridge never starts it just to list panes), or the bridge drives another Muxy profile than the app. The app's server runs with `--socket <dir>/server.sock` (`ps aux | grep muxy-server`); point `MUXY_DIR` at that `<dir>`.
- `/panes` is empty with tmux: the bridge talks to a different tmux server than your session. Compare `tmux display -p '#{socket_path}'` (run inside your session) with `TMUX_SOCKET`, and make sure both run as the same user.
- Creating, splitting or closing from the app fails with "too old to manage panes": the machine runs a bridge from before these routes. Update it (re-run the install command, or `git pull` and restart `atur-bridge.service`).
- A pane is not in the app: its working directory is not inside a bound workspace checkout (see above), or the Worker cannot reach the bridge (`curl` the tunnel hostname with the token).
- No pushes: `BRIDGE_TOKEN` is empty, differs from the Worker's `HERDR_BRIDGE_TOKEN`, or the agent has no hooks (state stays "unknown"). The bridge logs each event it sends (`agent-events: <pane> done -> 200`).
- Hooks do nothing: run the script by hand inside the pane and read the options back with `tmux display -p '#{@atur_status}'`. For Claude Code run `/hooks` to see what is loaded; for Codex, trust the hooks in `/hooks`.

## Tests

```bash
cd apps/bridge
bun test          # the tmux and Muxy integration tests start their own isolated servers, skipped when tmux / Muxy is not installed
bun run typecheck
```

`manage.test.ts` runs the pane management routes over a fake backend (validation, status codes, wire shapes); `backend-tmux.test.ts` creates a workspace, splits and closes on that tmux server and checks the name conflict. `backend-muxy.test.ts` runs against a Muxy server in a temporary `MUXY_DIR` (stopped with `muxy server stop --force` afterwards): nothing starts that server before a workspace is created or after it crashes, its terminals do not see the bridge's token, and it covers create, split, close, colours, key bytes, paste wrapping and paged scrollback. Muxy allows duplicate project names, so there is no conflict case.
