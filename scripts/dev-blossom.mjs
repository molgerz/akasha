#!/usr/bin/env node
/**
 * Tiny Blossom server for development (BUD-01/02/11) with the NIP-29 group
 * boundary the relay enforces applied to files too (CON-26).
 *
 * Nostr stores no files — images live on a Blossom server and are embedded in
 * the Markdown by their URL. This server is deliberately small and ONLY for
 * local development, but it no longer hands a blob to anyone who knows its
 * hash:
 *
 *   - an upload token (kind 24242) must bind the blob to a group with an `h`
 *     tag and to the content with an `x` tag;
 *   - a read (GET/HEAD) must carry a `t=get` token, and the token's key has to
 *     be a member of one of the groups the blob is filed under. Membership is
 *     asked of the relay as a *service identity*, because a private group's
 *     `39002` is not served to anonymous readers at all.
 *
 *   node scripts/dev-blossom.mjs [--port 3355] [--relay ws://localhost:8080]
 *                               [--insecure-reads]
 *
 * The service identity is `BLOSSOM_SERVICE_NSEC`, or `BLOSSOM_SEC` in
 * scripts/.dev-keys (put there and added to the group by
 * scripts/dev-group-seed.sh). Without it reads are refused — fail closed.
 * `--insecure-reads` is the explicit way to get the old open behaviour back.
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SimplePool, finalizeEvent, nip19 } from 'nostr-tools'
import { blobHashFromPath, checkAuthHeader, groupOf } from './blossom-acl.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const store = join(root, '.local', 'blossom')

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const flag = (name) => process.argv.includes(name)

const port = Number(arg('--port', '3355'))
const relayUrl = arg('--relay', process.env.BLOSSOM_RELAY_URL ?? 'ws://localhost:8080')
const insecureReads = flag('--insecure-reads') || process.env.BLOSSOM_INSECURE_READS === '1'

await mkdir(store, { recursive: true })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
  // Authorization is what a protected read sends; without it the browser's
  // preflight rejects the request before it is ever made.
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(body))
}

/** hex or bech32 (nsec) service key -> the 32 secret bytes nostr-tools wants. */
function parseSecret(raw) {
  const value = String(raw).trim()
  if (value.startsWith('nsec')) {
    const decoded = nip19.decode(value)
    if (decoded.type !== 'nsec') throw new Error('not an nsec key')
    return decoded.data
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
    return bytes
  }
  throw new Error('BLOSSOM_SERVICE_NSEC is neither hex nor an nsec')
}

async function loadServiceSecret() {
  const fromEnv = process.env.BLOSSOM_SERVICE_NSEC
  if (fromEnv) return parseSecret(fromEnv)
  try {
    const text = await readFile(join(root, 'scripts', '.dev-keys'), 'utf8')
    const line = text.split('\n').find((entry) => entry.startsWith('BLOSSOM_SEC='))
    if (line) return parseSecret(line.slice('BLOSSOM_SEC='.length))
  } catch {
    /* no key file — reads then fail closed */
  }
  return null
}

const serviceSecret = await loadServiceSecret()

// --- blob metadata ---------------------------------------------------------

const groupsPath = (hash) => join(store, hash + '.groups')

/** The groups a blob is filed under, from the upload that stored it. */
async function readGroups(hash) {
  try {
    const parsed = JSON.parse(await readFile(groupsPath(hash), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
  } catch {
    return []
  }
}

/** Union, not overwrite: the same bytes uploaded to two spaces belong to both. */
async function addGroup(hash, group) {
  const groups = await readGroups(hash)
  if (groups.includes(group)) return groups
  groups.push(group)
  await writeFile(groupsPath(hash), JSON.stringify(groups))
  return groups
}

async function blobExists(hash) {
  try {
    await access(join(store, hash))
    return true
  } catch {
    return false
  }
}

// --- membership oracle -----------------------------------------------------

/**
 * Asks the relay whether a key is in a group, as the service identity.
 *
 * NIP-42 first, deliberately: this relay answers an unauthenticated read of a
 * private group's state with silence rather than `auth-required`, so a
 * rejection-triggered AUTH never fires. That is the same reason `nak` is run
 * with `--fpa` here (AGENTS.md). Without a service key the server refuses
 * reads outright rather than guess.
 */
class Membership {
  constructor({ url, secret }) {
    this.url = url
    this.secret = secret
    this.pool = new SimplePool({ enableReconnect: false })
    this.authed = false
    this.cache = new Map()
  }

  async ensureAuthed() {
    const relay = await this.pool.ensureRelay(this.url, { connectionTimeout: 5000 })
    if (this.authed) return relay
    if (!this.secret) throw new Error('no Blossom service identity configured')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await relay.auth(async (template) => finalizeEvent(template, this.secret))
    this.authed = true
    return relay
  }

  query(filter) {
    return new Promise((resolve, reject) => {
      const events = []
      let closer = null
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        closer?.close()
        error ? reject(error) : resolve(events)
      }
      const timer = setTimeout(() => finish(null), 3000)
      this.ensureAuthed().then(() => {
        closer = this.pool.subscribeEose([this.url], filter, {
          onauth: async (template) => finalizeEvent(template, this.secret),
          onevent: (event) => events.push(event),
          onclose: () => finish(null),
          maxWait: 2500,
        })
      }, finish)
    })
  }

  async isMember(group, pubkey) {
    const cacheKey = group + '\u0000' + pubkey
    const cached = this.cache.get(cacheKey)
    if (cached && cached.until > Date.now()) return cached.value
    let value = false
    try {
      // 39002 lists every member as a p tag; the relay only serves it to a
      // member, which is exactly why the service identity has to be one.
      const events = await this.query({
        kinds: [39002],
        '#d': [group],
        '#p': [pubkey],
        limit: 1,
      })
      value = events.length > 0
    } catch (error) {
      console.error('membership check failed:', error instanceof Error ? error.message : error)
      value = false
    }
    // A yes is cached for longer than a no: memberships change, but a blob
    // read is a hot path and the relay's state does not move that fast.
    this.cache.set(cacheKey, { value, until: Date.now() + (value ? 30_000 : 5_000) })
    return value
  }

  async isAnyMember(groups, pubkey) {
    for (const group of groups) if (await this.isMember(group, pubkey)) return true
    return false
  }

  close() {
    this.pool.close([this.url])
  }
}

const membership = serviceSecret ? new Membership({ url: relayUrl, secret: serviceSecret }) : null

function readReason(req, hash) {
  const server = (req.headers.host ?? '').split(':')[0]
  const auth = checkAuthHeader(req.headers.authorization, { verb: 'get', hash, server })
  return auth
}

// --- HTTP ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (req.method === 'PUT' && url.pathname === '/upload') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    if (body.length === 0) return json(res, 400, { message: 'empty upload' })

    const hash = createHash('sha256').update(body).digest('hex')
    const server = (req.headers.host ?? '').split(':')[0]
    // requireHash: the upload token must bind to the content it uploads, so a
    // token captured from one upload cannot authorise another blob.
    const auth = checkAuthHeader(req.headers.authorization, {
      verb: 'upload',
      hash,
      requireHash: true,
      server,
    })
    if (!auth.ok) return json(res, 401, { message: auth.reason })

    const group = groupOf(auth.event)
    if (!group) return json(res, 400, { message: 'the upload token carries no h tag (group)' })

    const type = req.headers['content-type'] || 'application/octet-stream'
    await writeFile(join(store, hash), body)
    await writeFile(join(store, `${hash}.type`), String(type))
    const groups = await addGroup(hash, group)

    console.log(`upload ${hash.slice(0, 12)} ${body.length} B ${type} group=${group}`)
    return json(res, 200, {
      url: `http://localhost:${port}/${hash}`,
      sha256: hash,
      size: body.length,
      type,
      group,
      groups,
      uploaded: Math.floor(Date.now() / 1000),
    })
  }

  const hash = blobHashFromPath(url.pathname)
  if (hash && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!(await blobExists(hash))) return json(res, 404, { message: 'not found' })

    const groups = await readGroups(hash)
    if (!insecureReads) {
      if (!membership) {
        return json(res, 503, {
          message:
            'no Blossom service identity configured (BLOSSOM_SERVICE_NSEC); refusing to serve attachments',
        })
      }
      const auth = readReason(req, hash)
      if (!auth.ok) return json(res, 401, { message: auth.reason })
      if (groups.length === 0) return json(res, 403, { message: 'the blob is not filed under a group' })
      if (!(await membership.isAnyMember(groups, auth.event.pubkey))) {
        console.log(`denied ${hash.slice(0, 12)} for ${auth.event.pubkey.slice(0, 12)}`)
        return json(res, 403, { message: 'not a member of this attachment\'s group' })
      }
    }

    const body = await readFile(join(store, hash))
    let type = 'application/octet-stream'
    try {
      type = (await readFile(join(store, `${hash}.type`), 'utf8')).trim()
    } catch {
      /* type unknown */
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, ...CORS })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }

  json(res, 404, { message: 'Blossom development server: PUT /upload or GET /<sha256>' })
})

server.listen(port, () => {
  console.log(`Blossom development server on http://localhost:${port}`)
  console.log(`files end up in ${store}`)
  console.log(
    insecureReads
      ? 'READS ARE UNPROTECTED (--insecure-reads): anyone with the hash can fetch a blob'
      : membership
        ? `reads require a group membership, checked against ${relayUrl}`
        : 'reads are REFUSED: set BLOSSOM_SERVICE_NSEC (or add BLOSSOM_SEC to scripts/.dev-keys)',
  )
  console.log('add to .env.local:  VITE_BLOSSOM_SERVER=http://localhost:' + port)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    membership?.close()
    server.close(() => process.exit(0))
  })
}
