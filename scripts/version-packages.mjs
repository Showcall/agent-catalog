import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const changesetDirectory = path.join(root, '.changeset');
const pendingChangesets = fs
  .readdirSync(changesetDirectory)
  .filter(file => file.endsWith('.md') && file !== 'README.md');

if (!pendingChangesets.length) {
  throw new Error('No pending changesets found');
}

execFileSync('yarn', ['changeset', 'version'], {
  cwd: root,
  stdio: 'inherit',
});

const packagePaths = [
  'plugins/plugin-agent-catalog/package.json',
  'plugins/plugin-agent-catalog-backend/package.json',
];
const versions = packagePaths.map(relativePath => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, relativePath), 'utf8'),
  );
  return packageJson.version;
});

if (new Set(versions).size !== 1) {
  throw new Error(
    'Published package versions diverged: ' + versions.join(', '),
  );
}

const version = versions[0];
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const unreleased = /^## \[Unreleased\]\n\n([\s\S]*?)(?=^## \[|$)/m.exec(
  changelog,
);

if (!unreleased) {
  throw new Error('CHANGELOG.md must contain an Unreleased section');
}

const body = unreleased[1].trim();
if (!body) {
  throw new Error('CHANGELOG.md Unreleased section is empty');
}

const today = new Date().toISOString().slice(0, 10);
const releaseSection =
  '## [' + version + '] - ' + today + '\n\n' + body + '\n\n';
const updated = changelog.replace(
  unreleased[0],
  '## [Unreleased]\n\n' + releaseSection,
);
fs.writeFileSync(changelogPath, updated);
