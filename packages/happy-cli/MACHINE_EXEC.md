# happy machine-exec

Execute a shell command on **another machine of the same Happy account**, through
the relay server. This is the caller side of the machine-scoped `bash` RPC that
every `happy daemon` already exposes.

## Usage

```bash
# List machines on the account (id, host, online status)
happy machine-exec --list

# Run a command on a machine (match by id, or substring of host/display name)
happy machine-exec --machine macbook -- git status

# With working directory and timeout
happy machine-exec --machine macbook --cwd ~/dev/myproj --timeout 20000 -- npm test
```

Output is JSON on stdout:

```json
{ "success": true, "stdout": "...", "stderr": "", "exitCode": 0 }
```

Process exit code is `0` iff the remote command succeeded.

## How it works

- Machine list: `GET /v1/machines` (bearer token from `~/.happy` credentials);
  machine `metadata` is decrypted locally to show host names.
- Transport: socket.io connection to the server (`path: /v1/updates`,
  `clientType: user-scoped`), then `emitWithAck('rpc-call', { method:
  "<machineId>:bash", params: <encrypted> })`.
- Encryption: params/response are encrypted with the account's machine key
  (`credential.encryption.machineKey`, `dataKey` variant; falls back to the
  legacy secret). The relay server only ever sees ciphertext.
- The target daemon handles `bash` in
  `src/modules/common/registerCommonHandlers.ts` (30s default timeout).

## Limits & security notes

- **The relay caps RPC round-trips at ~30s** (`RPC_CALL_TIMEOUT_MS` server-side).
  `--timeout` is capped at 29s accordingly. Long-running commands should be
  started detached (e.g. `nohup ... &`) and polled.
- **The target daemon executes without interactive approval.** Access is gated
  by account credentials; anyone holding `~/.happy` credentials for the account
  can run commands on every online daemon of that account. Treat credentials
  accordingly. An approval/allowlist layer on the daemon side is planned for
  the desktop client.
- The target machine must have `happy daemon` running and online.

## Typical use: let a remote Claude Code drive a local machine

On the machine where Claude Code runs (e.g. a cloud dev box), Claude can call:

```bash
happy machine-exec --machine macbook -- <command>
```

…to execute commands on your laptop (which only needs to run the Happy desktop
client / `happy daemon`), with output flowing back automatically.
