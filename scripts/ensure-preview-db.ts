#!/usr/bin/env bun
// Gives each pull request preview its own database on the shared preview
// Postgres and prints the URL to it, for docker-entrypoint.sh to export.
//
// One database for every preview does not work: drizzle's migrator applies a
// migration only when its folder timestamp is newer than the newest timestamp
// already recorded (pg-core/dialect.js), so once a preview with a later
// migration has run, an older one is skipped for good — no error, no schema.

import pg from 'pg'

const TTL_DAYS = Number(process.env.PREVIEW_DATABASE_TTL_DAYS ?? 7)
const REGISTRY_DATABASE = 'polynux_previews'
const NAME_PATTERN = /^polynux_pr_\d+$/

// Coolify exposes no pull request id of its own, so it has to come out of
// whichever of its predefined variables the preview happens to carry.
function previewId(): string | null {
    if (process.env.COOLIFY_PR_ID) return process.env.COOLIFY_PR_ID

    for (const value of [process.env.COOLIFY_CONTAINER_NAME, process.env.HOSTNAME]) {
        const tagged = value?.match(/pr[-_]?(\d+)/i)
        if (tagged) return tagged[1]!
    }

    // Preview domains built from the {{pr_id}} template lead with the id.
    const host = (process.env.COOLIFY_FQDN ?? process.env.COOLIFY_URL ?? '').replace(/^https?:\/\//, '')
    const label = host.split('.')[0] ?? ''
    return /^\d+$/.test(label) ? label : null
}

const base = process.env.PREVIEW_DATABASE_BASE_URL!
const id = previewId()

if (!id) {
    console.error('ensure-preview-db: no pull request id in COOLIFY_PR_ID, COOLIFY_CONTAINER_NAME, HOSTNAME or COOLIFY_FQDN.')
    console.error(`ensure-preview-db: saw ${JSON.stringify({
        COOLIFY_PR_ID: process.env.COOLIFY_PR_ID,
        COOLIFY_CONTAINER_NAME: process.env.COOLIFY_CONTAINER_NAME,
        COOLIFY_FQDN: process.env.COOLIFY_FQDN,
        HOSTNAME: process.env.HOSTNAME
    })}`)
    process.exit(1)
}

const name = `polynux_pr_${id}`

async function createDatabase(client: pg.Client, target: string, template?: string) {
    try {
        await client.query(template
            ? `CREATE DATABASE "${target}" TEMPLATE "${template}"`
            : `CREATE DATABASE "${target}"`)
    } catch (error) {
        // 42P04 is this preview redeploying onto the database it already has.
        if ((error as { code?: string }).code !== '42P04') throw error
    }
}

// Everything past this point runs from a database of its own. Two reasons, and
// both bite on a stock Coolify Postgres, where the base URL names `postgres`:
// bookkeeping would otherwise land in the database holding the app's tables,
// and Postgres refuses to copy a database that any other session is connected
// to — including this script's own connection, when it is the template.
const bootstrap = new pg.Client({ connectionString: base })
await bootstrap.connect()
await createDatabase(bootstrap, REGISTRY_DATABASE)
await bootstrap.end()

const registryUrl = new URL(base)
registryUrl.pathname = `/${REGISTRY_DATABASE}`
const registry = new pg.Client({ connectionString: registryUrl.toString() })
await registry.connect()

await registry.query(`
    CREATE TABLE IF NOT EXISTS preview_databases (
        name text PRIMARY KEY,
        last_seen timestamptz NOT NULL DEFAULT now()
    )
`)

await createDatabase(registry, name, process.env.PREVIEW_DATABASE_TEMPLATE)

await registry.query(
    `INSERT INTO preview_databases (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET last_seen = now()`,
    [name]
)

// Closing a pull request tears the preview down through Coolify, which has no
// way to reach into Postgres — so the databases are collected here instead, on
// the next preview boot. A still-open pull request that goes quiet for longer
// than the window loses its data and gets an empty database on its next deploy.
const stale = await registry.query<{ name: string }>(
    `DELETE FROM preview_databases
     WHERE name <> $1 AND last_seen < now() - ($2 || ' days')::interval
     RETURNING name`,
    [name, TTL_DAYS]
)
for (const row of stale.rows) {
    if (!NAME_PATTERN.test(row.name)) continue
    await registry.query(`DROP DATABASE IF EXISTS "${row.name}" WITH (FORCE)`)
    console.error(`ensure-preview-db: dropped ${row.name}`)
}

await registry.end()

const url = new URL(base)
url.pathname = `/${name}`
console.log(url.toString())
