const path = require('path');

const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..');
const appCwd = process.env.APP_CWD || path.join(appRoot, 'current');
const logDir = process.env.PM2_LOG_DIR || path.join(appRoot, 'logs');
const appPort = process.env.PORT || '3000';

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP || 'erp-system',
      script: 'npm',
      args: 'run start:prod',
      cwd: appCwd,
      env: {
        NODE_ENV: 'production',
        PORT: appPort,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: appPort,
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      error_file: path.join(logDir, 'pm2-error.log'),
      out_file: path.join(logDir, 'pm2-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
