import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';

if (manifest.version !== pkg.version) throw new Error('manifest.json and package.json versions differ.');
if (tag && tag !== manifest.version) throw new Error(`Tag ${tag} must equal version ${manifest.version}.`);
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error('versions.json is missing the current compatibility entry.');
if (existsSync('data.json')) throw new Error('Runtime data.json must never be committed or released.');

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!existsSync(file)) throw new Error(`Missing release asset: ${file}`);
}
