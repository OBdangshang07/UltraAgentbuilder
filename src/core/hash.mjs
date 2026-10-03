import fs from 'node:fs';
import crypto from 'node:crypto';

export async function hashFile(file, algorithm = 'sha256') {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}
