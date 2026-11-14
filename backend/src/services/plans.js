// Plan limits and usage metering.
//
// The numbers below are PLACEHOLDERS for the pricing decision, not a
// decision. They are only enforced when ENFORCE_PLAN_LIMITS=true, so a local
// install or an early tester is never locked out by them. Limits always
// apply to the project OWNER's plan, whoever performs the action.
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS = {
  free: { label: 'Free', projects: 3, storageBytes: 500 * MB, directionNotes: 5, membersPerProject: 1, shareLinksPerProject: 1 },
  pro: { label: 'Pro', projects: null, storageBytes: 20 * GB, directionNotes: 200, membersPerProject: 15, shareLinksPerProject: null },
};

export function limitsFor(plan) {
  return PLANS[plan] || PLANS.free;
}

export async function getUsage(userId) {
  const [projects, storage, direction] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM projects WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT COALESCE(SUM(i.file_size), 0)::bigint AS bytes
       FROM board_items i JOIN projects p ON p.id = i.project_id
       WHERE p.user_id = $1 AND i.storage_key IS NOT NULL`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM usage_events
       WHERE user_id = $1 AND kind = 'direction_note' AND created_at >= date_trunc('month', now())`,
      [userId]
    ),
  ]);
  return {
    projects: projects.rows[0].n,
    storageBytes: Number(storage.rows[0].bytes),
    directionNotes: direction.rows[0].n,
  };
}

async function ownerPlan(ownerId) {
  const result = await pool.query('SELECT plan FROM users WHERE id = $1', [ownerId]);
  return result.rows[0]?.plan || 'free';
}

function over(message) {
  return new HttpError(402, message, 'PLAN_LIMIT');
}

export async function assertCanCreateProject(userId) {
  if (!config.plans.enforce) return;
  const limits = limitsFor(await ownerPlan(userId));
  if (limits.projects === null) return;
  const usage = await getUsage(userId);
  if (usage.projects >= limits.projects) {
    throw over(`The ${limits.label} plan holds ${limits.projects} projects. Archive one or upgrade to add more.`);
  }
}

export async function assertCanStore(ownerId, extraBytes) {
  if (!config.plans.enforce) return;
  const limits = limitsFor(await ownerPlan(ownerId));
  const usage = await getUsage(ownerId);
  if (usage.storageBytes + extraBytes > limits.storageBytes) {
    throw over(`This would go over the ${limits.label} plan's storage (${Math.round(limits.storageBytes / MB)}MB).`);
  }
}

export async function assertCanRunDirection(ownerId) {
  if (!config.plans.enforce) return;
  const limits = limitsFor(await ownerPlan(ownerId));
  const usage = await getUsage(ownerId);
  if (usage.directionNotes >= limits.directionNotes) {
    throw over(`The ${limits.label} plan includes ${limits.directionNotes} direction notes a month, and they're used up.`);
  }
}

export async function assertCanAddMember(ownerId, projectId) {
  if (!config.plans.enforce) return;
  const limits = limitsFor(await ownerPlan(ownerId));
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1', [projectId]);
  if (count.rows[0].n >= limits.membersPerProject) {
    throw over(`The ${limits.label} plan allows ${limits.membersPerProject} collaborator(s) per project.`);
  }
}

export async function assertCanAddShareLink(ownerId, projectId) {
  if (!config.plans.enforce) return;
  const limits = limitsFor(await ownerPlan(ownerId));
  if (limits.shareLinksPerProject === null) return;
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM share_links WHERE project_id = $1', [projectId]);
  if (count.rows[0].n >= limits.shareLinksPerProject) {
    throw over(`The ${limits.label} plan allows ${limits.shareLinksPerProject} share link(s) per project.`);
  }
}

export async function recordUsage(userId, kind) {
  await pool.query('INSERT INTO usage_events (user_id, kind) VALUES ($1, $2)', [userId, kind]);
}
