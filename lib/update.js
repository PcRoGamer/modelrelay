import { spawnSync } from 'node:child_process'
import { accessSync, existsSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAutostartStatus, startAutostart, stopAutostart } from './autostart.js'

const NPM_LATEST_URL = 'https://registry.npmjs.org/modelrelay/latest'
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

function parseVersionParts(version) {
  if (typeof version !== 'string' || !version.trim()) return null
  // Resiliently extract only numeric parts (x.y.z)
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isVersionNewer(latest, current) {
  const latestParts = parseVersionParts(latest)
  const currentParts = parseVersionParts(current)
  if (!latestParts || !currentParts) return false

  for (let i = 0; i < 3; i++) {
    const a = latestParts[i]
    const b = currentParts[i]
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

export async function fetchLatestNpmVersion() {
  try {
    const resp = await fetch(NPM_LATEST_URL, { method: 'GET' })
    if (!resp.ok) return null
    const payload = await resp.json()
    if (!payload || typeof payload.version !== 'string' || !payload.version.trim()) return null
    return payload.version.trim()
  } catch {
    return null
  }
}

export function isRunningFromSource() {
  return existsSync(join(PROJECT_ROOT, '.git'))
}

function canWriteToProjectRoot() {
  try {
    accessSync(PROJECT_ROOT, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function runNpmUpdate(target = 'latest') {
  if (isRunningFromSource()) {
    return {
      ok: false,
      message: 'Running from source (Git). Auto-update disabled. Please use "git pull" to update.',
    }
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  let args = ['install', '-g', `modelrelay@${target}`]
  let cwd = process.cwd()
  let updateType = 'global'

  const result = spawnSync(npmCommand, args, { stdio: 'pipe', encoding: 'utf8', cwd })

  if (result.error) {
    return {
      ok: false,
      message: `Failed to run npm update: ${result.error.message}`,
    }
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || 'npm update failed').trim()
    if (details.includes('EACCES') || details.includes('EPERM')) {
      return {
        ok: false,
        message: `Permission denied during ${updateType} update. Please run "npm install -g modelrelay" with sudo/Administrator privileges.`,
      }
    }
    return {
      ok: false,
      message: `npm ${updateType} update failed: ${details}`,
    }
  }

  return {
    ok: true,
    message: `Updated modelrelay to ${target === 'latest' ? 'latest version' : `v${target}`} (${updateType}).`,
  }
}

export function runUpdateCommand(target = 'latest', skipRestart = false) {
  const status = getAutostartStatus()
  // We only stop/start if it's already configured as a background service
  const shouldManageBackground = status.supported && status.configured
  const messages = []

  // Note: On Windows, stopAutostart() kills other instances but leaves the current one.
  // Our detached restart logic in server.js will handle the handover.
  if (shouldManageBackground) {
    const stopResult = stopAutostart()
    if (!stopResult.ok) return stopResult
    messages.push(stopResult.message)
  }

  const updateResult = runNpmUpdate(target)
  if (!updateResult.ok) return updateResult
  messages.push(updateResult.message)

  if (shouldManageBackground && !skipRestart) {
    const startResult = startAutostart()
    if (!startResult.ok) {
      return {
        ok: false,
        message: `${messages.join('\n')}\nUpdate succeeded, but failed to restart autostart target: ${startResult.message}`,
      }
    }
    messages.push(startResult.message)
  }

  return {
    ok: true,
    message: messages.join('\n'),
  }
}
