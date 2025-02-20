import process from 'process';
import {dirname, join} from 'path';
import {constants, type PathLike} from 'fs';
import {access} from 'fs/promises';
import * as fs from 'fs/promises';
import {promisify} from 'util';
import {URL} from 'url';
import {spawn as _asyncSpawn} from 'promisify-child-process';
import rimraf from 'rimraf';
import {type Binary} from 'near-sandbox';
import {getBinary} from 'near-sandbox/dist/getBinary';
import fs_extra from 'fs-extra';
import {type ChildProcessPromise} from './types';

export const rm = promisify(rimraf);
export const sandboxBinary: () => Promise<Binary> = async () => (getBinary());

export async function exists(d: PathLike): Promise<boolean> {
  let file: fs.FileHandle | undefined;
  try {
    file = await fs.open(d, 'r');
  } catch {
    return false;
  } finally {
    await file?.close();
  }

  return true;
}

export async function asyncSpawn(bin: string, ...args: string[]): ChildProcessPromise {
  debug(`spawning \`${bin} ${args.join(' ')}\``);
  return _asyncSpawn(bin, args, {encoding: 'utf8'});
}

export {spawn} from 'child_process';

export function debug(...args: unknown[]): void {
  if (process.env.NEAR_WORKSPACES_DEBUG) {
    console.error(...args);
  }
}

export function txDebug(tx: string): void {
  if (process.env.NEAR_WORKSPACES_TXDEBUG) {
    console.error(tx);
  }
}

export const copyDirection = promisify(fs_extra.copy);

export async function ensureBinary(): Promise<string> {
  const binary = await sandboxBinary();
  if (!await binary.exists()) {
    await binary.install();
  }

  return binary.binPath;
}

export function isPathLike(something: any): something is URL | string {
  return typeof something === 'string' || something instanceof URL;
}

/**
 * Attempts to construct an absolute path to a file given a path relative to a
 * package.json. Searches through `module.paths` (Node's resolution search
 * paths) as described in https://stackoverflow.com/a/18721515/249801, then
 * falls back to using process.cwd() if still not found. Throws an acceptable
 * user-facing error if no file found.
 */
export async function findFile(relativePath: string): Promise<string> {
  for (const modulePath of module.paths) {
    try {
      await access(modulePath, constants.F_OK); // eslint-disable-line no-await-in-loop
      const absolutePath = join(dirname(modulePath), relativePath);
      await access(absolutePath, constants.F_OK); // eslint-disable-line no-await-in-loop
      return absolutePath;
    } catch {}
  }

  const cwd = process.cwd();
  const absolutePath = join(cwd, relativePath);
  try {
    await access(absolutePath, constants.F_OK);
    return absolutePath;
  } catch {}

  throw new Error(`Could not find '${relativePath}' relative to any package.json file or your current working directory (${cwd})`);
}
