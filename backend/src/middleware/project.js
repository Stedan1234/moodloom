import { pool } from '../db/pool.js';
import { idParam } from '../lib/validate.js';
import { HttpError } from '../lib/errors.js';

const RANK = { viewer: 1, editor: 2, owner: 3 };

/**
 * Loads the project named in the URL and the caller's role on it, and
 * refuses the request unless that role is at least `minRole`.
 *
 * This is the single place access to a project is decided. A project the
 * caller has no role on is a 404, indistinguishable from one that doesn't
 * exist, so ids can't be probed. Having a role but not a high enough one is
 * a 403 with a reason.
 *
 * Attaches req.project (the row) and req.projectRole.
 */
export function projectAccess(minRole = 'viewer') {
  return async function projectAccessMiddleware(req, res, next) {
    const id = idParam(req.params.projectId);
    if (!id) throw new HttpError(404, 'Project not found');

    const result = await pool.query(
      `SELECT p.id, p.user_id, p.name, p.brief, p.stage, p.ai_enabled, p.created_at, p.updated_at,
              CASE WHEN p.user_id = $2 THEN 'owner' ELSE m.role END AS role
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
       WHERE p.id = $1`,
      [id, req.userId]
    );
    const project = result.rows[0];
    if (!project || !project.role) throw new HttpError(404, 'Project not found');
    if (RANK[project.role] < RANK[minRole]) {
      throw new HttpError(
        403,
        minRole === 'owner' ? 'Only the project owner can do that.' : 'You have view-only access to this project.',
        'FORBIDDEN_ROLE'
      );
    }
    req.project = project;
    req.projectRole = project.role;
    next();
  };
}

export async function touchProject(projectId) {
  await pool.query('UPDATE projects SET updated_at = now() WHERE id = $1', [projectId]);
}
