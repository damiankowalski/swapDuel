// Entry point: node server/main.ts (npm run server). Configuration from environment variables (server/config.ts).
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app.ts';
import { loadConfig } from './config.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

let config;
try {
  config = loadConfig(process.env, distDir);
} catch (err) {
  console.error(`Configuration error: ${(err as Error).message}`);
  process.exit(1);
}

const game = createGameServer(config);
try {
  await game.listen();
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${config.port} on ${config.host} is already in use: is another game server running? Stop it, or set PORT.`
      : `Could not start: ${(err as Error).message}`,
  );
  process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    game.close().then(() => process.exit(0));
  });
}
