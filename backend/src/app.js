const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { validateEnv } = require('./config/env');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const templateFilesRouter = require('./routes/admin/templateFiles');
const workflowTemplatesRouter = require('./routes/admin/workflowTemplates');
const documentTypesRouter = require('./routes/admin/documentTypes');
const instancesRouter = require('./routes/instances');
const adminInstancesRouter = require('./routes/admin/instances');
const adminUsersRouter = require('./routes/admin/users');
const adminRolesRouter = require('./routes/admin/roles');
const adminGroupsRouter = require('./routes/admin/groups');
const adminAnalyticsRouter = require('./routes/admin/analytics');
const documentTypesPublicRouter = require('./routes/documentTypes');
const filesRouter = require('./routes/files');
const filesCallbackRouter = require('./routes/filesCallback');
const usersRouter = require('./routes/users');
const groupsRouter = require('./routes/groups');
const notificationsRouter = require('./routes/notifications');
const errorHandler = require('./middleware/errorHandler');

const config = validateEnv();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
  }),
);
app.use(express.json());

const baselineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(baselineLimiter);

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/admin/template-files', templateFilesRouter);
app.use('/admin/workflow-templates', workflowTemplatesRouter);
app.use('/admin/document-types', documentTypesRouter);
app.use('/instances', instancesRouter);
app.use('/document-types', documentTypesPublicRouter);
app.use('/admin/instances', adminInstancesRouter);
app.use('/admin/users', adminUsersRouter);
app.use('/admin/roles', adminRolesRouter);
app.use('/admin/groups', adminGroupsRouter);
app.use('/admin/analytics', adminAnalyticsRouter);
app.use('/files', filesRouter);
app.use('/files/callback', filesCallbackRouter);
app.use('/users', usersRouter);
app.use('/groups', groupsRouter);
app.use('/notifications', notificationsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
