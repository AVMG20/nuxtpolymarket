import { eq, and, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBuilderJobs, colonyState, colonyUpgrades } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { settleColony, getUpgradeLevels } from '#server/utils/colony'
import { getUpgradeTrack, trackLevelDurationMs, habitatLevelUpDurationMs, HABITAT_BUILDER_JOB_ID, MAX_TIER } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ trackId?: string }>(event).catch(() => ({} as { trackId?: string }))
  const userId = await requireUserId(event)

  const state = await settleColony(userId)
  // Ordered by startedAt so the unnamed-collect path below picks the same job
  // every time, and picks it in the order serializeBuilders lists them in.
  const jobs = await db.select().from(colonyBuilderJobs).where(eq(colonyBuilderJobs.userId, userId)).orderBy(colonyBuilderJobs.startedAt)
  const levels = await getUpgradeLevels(userId)

  function completesAtOf(job: typeof jobs[number]) {
    if (job.trackId === HABITAT_BUILDER_JOB_ID) {
      return job.startedAt.getTime() + habitatLevelUpDurationMs(state.habitatLevel)
    }
    return job.startedAt.getTime() + trackLevelDurationMs((levels[job.trackId] ?? 0) + 1)
  }

  // trackId is optional so a single-builder colony can keep calling this with
  // an empty body; with more than one builder the client always names the job.
  // Unnamed collects take the first FINISHED job, not the first job — with
  // three builders running, "collect" with no argument should never pick the
  // one that still has two days left on it.
  const job = body.trackId
    ? jobs.find(j => j.trackId === body.trackId)
    : jobs.find(j => Date.now() >= completesAtOf(j))
  if (!job) throw createError({ statusCode: 400, statusMessage: 'No builder has anything to collect' })

  if (job.trackId === HABITAT_BUILDER_JOB_ID) {
    if (state.habitatLevel >= MAX_TIER) throw createError({ statusCode: 400, statusMessage: 'Habitat is already at max level' })
    const completesAt = job.startedAt.getTime() + habitatLevelUpDurationMs(state.habitatLevel)
    if (Date.now() < completesAt) throw createError({ statusCode: 400, statusMessage: 'Habitat construction is not finished yet' })

    // Deleting the job is the claim: only the request that removes the row
    // goes on to grant the level, so a double-click cannot bank it twice.
    const habitatLevel = await db.transaction(async (tx) => {
      const [claimed] = await tx.delete(colonyBuilderJobs)
        .where(and(eq(colonyBuilderJobs.id, job.id), eq(colonyBuilderJobs.userId, userId)))
        .returning()
      if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already collected' })

      const [updated] = await tx.update(colonyState)
        .set({ habitatLevel: sql`${colonyState.habitatLevel} + 1` })
        .where(eq(colonyState.userId, userId))
        .returning({ habitatLevel: colonyState.habitatLevel })
      return updated!.habitatLevel
    })

    return { ok: true, habitatLevel }
  }

  const track = getUpgradeTrack(job.trackId)
  if (!track) throw createError({ statusCode: 500, statusMessage: 'Unknown track under construction' })

  const nextLevel = (levels[track.id] ?? 0) + 1
  const completesAt = job.startedAt.getTime() + trackLevelDurationMs(nextLevel)
  if (Date.now() < completesAt) throw createError({ statusCode: 400, statusMessage: 'Upgrade is not finished yet' })

  const level = await db.transaction(async (tx) => {
    const [claimed] = await tx.delete(colonyBuilderJobs)
      .where(and(eq(colonyBuilderJobs.id, job.id), eq(colonyBuilderJobs.userId, userId)))
      .returning()
    if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Already collected' })

    // `greatest` rather than a blind set: the level can only ever move up, so
    // a stale nextLevel read can never walk a track backwards.
    const [upgraded] = await tx.insert(colonyUpgrades)
      .values({ userId, trackId: track.id, level: nextLevel })
      .onConflictDoUpdate({
        // Column order matches the declared unique constraint.
        target: [colonyUpgrades.trackId, colonyUpgrades.userId],
        set: { level: sql`greatest(${colonyUpgrades.level}, ${nextLevel})` }
      })
      .returning({ level: colonyUpgrades.level })
    return upgraded!.level
  })

  return { ok: true, trackId: track.id, level }
})
