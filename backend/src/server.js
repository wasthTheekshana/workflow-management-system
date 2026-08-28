const app = require('./app');
const { validateEnv } = require('./config/env');
const { startNotificationWorker } = require('./workers/notificationWorker');

const config = validateEnv();

app.listen(config.port, () => {
  console.log(`Workflow engine API listening on port ${config.port}`);
});

startNotificationWorker();
