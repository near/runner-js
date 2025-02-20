import * as fs from 'fs/promises';
import {Buffer} from 'buffer';
import sha256 from 'js-sha256';
import base64url from 'base64url';
import {type CallSite} from 'callsites';
import {KeyPair, KeyPairEd25519} from '../types';

export function findCallerFile(): [string, number] {
  const sites: CallSite[] = callsites();
  const files: CallSite[] = sites.filter(s => s.getFileName());
  // Need better way to find file
  const index = files.length - 1;
  return [files[index].getFileName()!, files[index].getLineNumber()!];
}

export function callsites(): CallSite[] {
  const _prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const stack = new Error().stack!.slice(1); // eslint-disable-line unicorn/error-message
  Error.prepareStackTrace = _prepareStackTrace;
  return stack as unknown as CallSite[];
}

export interface KeyFilePrivate {
  private_key: string;
}

export interface KeyFileSecret {
  secret_key: string;
}

export type KeyFile = KeyFilePrivate | KeyFileSecret;

export async function getKeyFromFile(filePath: string, create = true): Promise<KeyPair> {
  try {
    const keyFile = require(filePath) as KeyFile; // eslint-disable-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    return KeyPair.fromString(
      // @ts-expect-error `x` does not exist on KeyFile
      String(keyFile.secret_key ?? keyFile.private_key),
    );
  } catch (error: unknown) {
    if (!create) {
      throw error;
    }

    const keyPair = KeyPairEd25519.fromRandom();
    await fs.writeFile(filePath, JSON.stringify({
      secret_key: keyPair.toString(),
    }));
    return keyPair;
  }
}

export function hashPathBase64(s: string): string {
  // Currently base64url is in newest version of node, but need to use polyfill for now
  const result = base64url.encode(Buffer.from(sha256.sha256.arrayBuffer(s)));
  return result;
}

export function sanitize(s: string): string {
  return s.toLowerCase().replace('__', '_0');
}
