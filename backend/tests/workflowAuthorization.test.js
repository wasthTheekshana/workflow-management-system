const { canAct } = require('../src/utils/workflowAuthorization');

describe('canAct', () => {
  it('authorizes the assigned user on a user-type stage with no claim', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-1')).toBe(true);
  });

  it('rejects a different user on a user-type stage with no claim', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-2')).toBe(false);
  });

  it('rejects anyone on a role-type stage with no claim', () => {
    const stage = { assignee_type: 'role', assignee_role_id: 'role-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-1')).toBe(false);
  });

  it('authorizes the claimant regardless of stage assignee, once claimed', () => {
    const stage = { assignee_type: 'role', assignee_role_id: 'role-1' };
    expect(canAct(stage, { claimed_by: 'user-2' }, 'user-2')).toBe(true);
    expect(canAct(stage, { claimed_by: 'user-2' }, 'user-3')).toBe(false);
  });

  it('lets a claim override the originally assigned user on a user-type stage (admin reassignment)', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: 'user-9' }, 'user-9')).toBe(true);
    expect(canAct(stage, { claimed_by: 'user-9' }, 'user-1')).toBe(false);
  });
});
