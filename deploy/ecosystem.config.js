// pm2 process definition for the backend. Lives at <deploy_path>/ecosystem.config.js
// on the EC2 box; "cwd" is relative to this file's location, so it must stay
// alongside the synced "backend/" directory (see deploy.yml's rsync targets).
module.exports = {
  apps: [
    {
      name: "openpscalc-backend",
      cwd: "./backend",
      script: "node_modules/.bin/tsx",
      args: "src/server.ts",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: "4000",
      },
    },
  ],
};
