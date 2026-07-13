/**
 * Happy desktop — main process.
 *
 * 1. Opens the Happy webapp (self-hosted URL) in a BrowserWindow.
 * 2. Starts an "exec approver" unix-socket server. The happy daemon (spawned
 *    with HAPPY_EXEC_APPROVER_SOCKET) asks us before executing any machine
 *    bash RPC; we show a native dialog (or auto-approve via whitelist).
 * 3. Spawns `happy daemon start-sync` so this Mac is registered as a machine
 *    on the account — making the app itself the "local executor".
 */

import { app, BrowserWindow, dialog } from 'electron'
import { spawn, ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const WEBAPP_URL = process.env.HAPPY_WEBAPP_URL || 'https://d2nkikyt4i91kk.cloudfront.net'
const HAPPY_BIN = process.env.HAPPY_CLI_PATH || 'happy'

let mainWindow: BrowserWindow | null = null
let daemonProcess: ChildProcess | null = null
let approverServer: net.Server | null = null

// ---------- whitelist ----------

interface Whitelist { prefixes: string[] }

function whitelistPath(): string {
    return path.join(app.getPath('userData'), 'exec-whitelist.json')
}

function loadWhitelist(): Whitelist {
    try {
        return JSON.parse(fs.readFileSync(whitelistPath(), 'utf-8')) as Whitelist
    } catch {
        return { prefixes: [] }
    }
}

function saveWhitelist(list: Whitelist): void {
    fs.mkdirSync(path.dirname(whitelistPath()), { recursive: true })
    fs.writeFileSync(whitelistPath(), JSON.stringify(list, null, 2))
}

const DANGEROUS_PATTERNS = [/\brm\b/, /\bsudo\b/, /\bmkfs\b/, /\bdd\b/, /\bshutdown\b/, /\breboot\b/, />\s*\/dev\//]

function isDangerous(command: string): boolean {
    return DANGEROUS_PATTERNS.some(re => re.test(command))
}

function isWhitelisted(command: string): boolean {
    if (isDangerous(command)) return false // dangerous commands always need manual approval
    return loadWhitelist().prefixes.some(prefix => command.startsWith(prefix))
}

// ---------- approval dialog ----------

async function askUser(request: { command: string; cwd?: string }): Promise<boolean> {
    if (isWhitelisted(request.command)) return true

    const detailLines = [
        `Command: ${request.command}`,
        request.cwd ? `Directory: ${request.cwd}` : null,
        isDangerous(request.command) ? '⚠️ This command matches a dangerous pattern.' : null,
    ].filter(Boolean)

    const buttons = isDangerous(request.command)
        ? ['Deny', 'Allow once']
        : ['Deny', 'Allow once', 'Always allow this command']

    const result = await dialog.showMessageBox(mainWindow ?? new BrowserWindow({ show: false }), {
        type: 'question',
        title: 'Remote command request',
        message: 'A remote Happy session wants to run a command on this machine',
        detail: detailLines.join('\n'),
        buttons,
        defaultId: 0,
        cancelId: 0,
    })

    if (result.response === 2) {
        const list = loadWhitelist()
        if (!list.prefixes.includes(request.command)) {
            list.prefixes.push(request.command)
            saveWhitelist(list)
        }
        return true
    }
    return result.response === 1
}

// ---------- approver socket server ----------

function approverSocketPath(): string {
    return path.join(os.tmpdir(), `happy-desktop-approver-${process.pid}.sock`)
}

function startApproverServer(socketPath: string): void {
    try { fs.unlinkSync(socketPath) } catch { /* not there */ }

    approverServer = net.createServer((socket) => {
        let buffer = ''
        socket.on('data', async (chunk) => {
            buffer += chunk.toString()
            const newline = buffer.indexOf('\n')
            if (newline === -1) return
            let approve = false
            let reason: string | undefined
            try {
                const request = JSON.parse(buffer.slice(0, newline)) as { command?: string; cwd?: string }
                if (typeof request.command === 'string') {
                    approve = await askUser({ command: request.command, cwd: request.cwd })
                    if (!approve) reason = 'Denied by user on target machine'
                } else {
                    reason = 'Malformed approval request'
                }
            } catch {
                reason = 'Malformed approval request'
            }
            socket.write(JSON.stringify({ approve, reason }) + '\n')
            socket.end()
        })
        socket.on('error', () => { /* peer went away; nothing to do */ })
    })
    approverServer.listen(socketPath)
}

// ---------- daemon ----------

function startDaemon(socketPath: string): void {
    daemonProcess = spawn(HAPPY_BIN, ['daemon', 'start-sync'], {
        env: { ...process.env, HAPPY_EXEC_APPROVER_SOCKET: socketPath },
        stdio: 'ignore',
        detached: false,
    })
    daemonProcess.on('error', (error) => {
        dialog.showErrorBox('Happy daemon failed to start',
            `${error.message}\n\nLocal execution is unavailable. Set HAPPY_CLI_PATH to your happy binary.`)
    })
}

// ---------- app lifecycle ----------

app.whenReady().then(() => {
    const socketPath = approverSocketPath()
    startApproverServer(socketPath)
    startDaemon(socketPath)

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        title: 'Happy',
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    mainWindow.loadURL(WEBAPP_URL)
    mainWindow.on('closed', () => { mainWindow = null })
})

app.on('window-all-closed', () => {
    app.quit()
})

app.on('quit', () => {
    daemonProcess?.kill()
    approverServer?.close()
    try { fs.unlinkSync(approverSocketPath()) } catch { /* already gone */ }
})
