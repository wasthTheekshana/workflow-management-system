const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  updateMemberLevel,
  removeMember,
} = require('../../services/groupService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    res.status(200).json(await listGroups(req.user.tenantId));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createGroup(req.user.tenantId, req.body.name));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.status(200).json(await getGroupWithMembers(req.user.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    res.status(200).json(await renameGroup(req.user.tenantId, req.params.id, req.body.name));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteGroup(req.user.tenantId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const userId = req.body.user_id || req.body.userId;
    await addMember(req.user.tenantId, req.params.id, userId, req.body.level);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.put('/:id/members/:userId', async (req, res, next) => {
  try {
    await updateMemberLevel(req.user.tenantId, req.params.id, req.params.userId, req.body.level);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    await removeMember(req.user.tenantId, req.params.id, req.params.userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
