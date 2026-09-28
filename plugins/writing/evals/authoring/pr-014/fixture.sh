#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/docker/build-push-action.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p src
cat > package.json <<'JSON'
{
  "name": "docker-build-push",
  "description": "Build and push Docker images",
  "main": "lib/main.js",
  "scripts": {
    "build": "ncc build src/main.ts --source-map --minify --license licenses.txt",
    "lint": "eslint src/**/*.ts __tests__/**/*.ts",
    "format": "eslint --fix src/**/*.ts __tests__/**/*.ts",
    "test": "jest --coverage",
    "all": "yarn run build && yarn run format && yarn test"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/docker/build-push-action.git"
  },
  "license": "Apache-2.0",
  "dependencies": {
    "@actions/core": "^1.9.0",
    "@actions/exec": "^1.1.1",
    "@actions/github": "^5.0.3",
    "csv-parse": "^5.3.0",
    "handlebars": "^4.7.7",
    "semver": "^7.3.7",
    "tmp": "^0.2.1"
  }
}
JSON
cat > src/main.ts <<'TS'
import * as fs from 'fs';
import * as buildx from './buildx';
import * as context from './context';
import * as docker from './docker';
import * as stateHelper from './state-helper';
import * as core from '@actions/core';
import * as exec from '@actions/exec';

async function run(): Promise<void> {
  try {
    const defContext = context.defaultContext();
    const inputs: context.Inputs = await context.getInputs(defContext);

    // standalone if docker cli not available
    const standalone = !(await docker.isAvailable());

    core.startGroup(`Docker info`);
    if (standalone) {
      core.info(`Docker info skipped in standalone mode`);
    } else {
      await exec.exec('docker', ['version'], {
        failOnStdErr: false
      });
      await exec.exec('docker', ['info'], {
        failOnStdErr: false
      });
    }
    core.endGroup();

    if (!(await buildx.isAvailable(standalone))) {
      core.setFailed(`Docker buildx is required. See https://github.com/docker/setup-buildx-action to set up buildx.`);
      return;
    }
    stateHelper.setTmpDir(context.tmpDir());

    const buildxVersion = await buildx.getVersion(standalone);
    await core.group(`Buildx version`, async () => {
      const versionCmd = buildx.getCommand(['version'], standalone);
      await exec.exec(versionCmd.command, versionCmd.args, {
        failOnStdErr: false
      });
    });

    const args: string[] = await context.getArgs(inputs, defContext, buildxVersion);
    const buildCmd = buildx.getCommand(args, standalone);
    await exec
      .getExecOutput(buildCmd.command, buildCmd.args, {
        ignoreReturnCode: true
      })
      .then(res => {
        if (res.stderr.length > 0 && res.exitCode != 0) {
          throw new Error(`buildx failed with: ${res.stderr.match(/(.*)\s*$/)?.[0]?.trim() ?? 'unknown error'}`);
        }
      });

    const imageID = await buildx.getImageID();
    const metadata = await buildx.getMetadata();
    const digest = await buildx.getDigest(metadata);

    if (imageID) {
      await core.group(`ImageID`, async () => {
        core.info(imageID);
        context.setOutput('imageid', imageID);
      });
    }
    if (digest) {
      await core.group(`Digest`, async () => {
        core.info(digest);
        context.setOutput('digest', digest);
      });
    }
    if (metadata) {
      await core.group(`Metadata`, async () => {
        core.info(metadata);
        context.setOutput('metadata', metadata);
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function cleanup(): Promise<void> {
  if (stateHelper.tmpDir.length > 0) {
    core.startGroup(`Removing temp folder ${stateHelper.tmpDir}`);
    fs.rmdirSync(stateHelper.tmpDir, {recursive: true});
    core.endGroup();
  }
}

if (!stateHelper.IsPost) {
  run();
} else {
  cleanup();
}
TS
git add -A && git commit -qm "main: build and push docker images"
git switch -qc deprecated-fs-rmdir
sed -i.bak "s/fs.rmdirSync(stateHelper.tmpDir, {recursive: true});/fs.rmSync(stateHelper.tmpDir, {recursive: true});/" src/main.ts
rm src/main.ts.bak
git commit -qam "$(cat <<'MSG'
replace deprecated `fs.rmdir` with `fs.rm`

Signed-off-by: Ben Drucker <bvdrucker@gmail.com>
MSG
)"
