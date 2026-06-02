module.exports = {
  apps: [
    {
      name: process.env.PM2_APP || 'erp-system',
      script: 'npm',
      args: 'run start:prod',
      cwd: '/var/www/erp/current',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      error_file: '/var/www/erp/logs/pm2-error.log',
      out_file: '/var/www/erp/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
