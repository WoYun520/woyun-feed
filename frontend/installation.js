import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

export function installationId(frontendDir) {
  return createHash('sha256').update(realpathSync(frontendDir)).digest('hex').slice(0, 24);
}
