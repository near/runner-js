import {type ChildProcess} from 'child_process';
import _BN from 'bn.js';
import {type KeyPair} from 'near-api-js';
import {type Output} from 'promisify-child-process';
import {type NEAR} from 'near-units';
import {type KeyStore} from 'near-api-js/lib/key_stores';

export {ServerError} from 'near-api-js/lib/utils/rpc_errors';
export {KeyPair, Connection} from 'near-api-js';
export {PublicKey, KeyPairEd25519} from 'near-api-js/lib/utils';
export {
  Action,
  createAccount,
  deployContract,
  functionCall,
  transfer,
  stake,
  addKey,
  deleteKey,
  deleteAccount,
  fullAccessKey,
  AccessKey,
} from 'near-api-js/lib/transaction';

export {JsonRpcProvider as JSONRpc} from 'near-api-js/lib/providers/json-rpc-provider';
export {KeyStore} from 'near-api-js/lib/key_stores';
export * from 'near-api-js/lib/providers/provider';

export {DEFAULT_FUNCTION_CALL_GAS} from 'near-api-js/lib/constants';

export class BN extends _BN {
  toJSON(): string {
    return this.toString(10);
  }
}

export type Args = Record<string, any> | Uint8Array;

export interface NamedAccount {
  accountId: string;
}

export interface CallOptions {
  gas?: string | BN;
  attachedDeposit?: string | BN;
  signWithKey?: KeyPair;
}

export type ChildProcessPromise = Promise<ChildProcess & Promise<Output>>;

export interface AccountBalance {
  total: NEAR;
  stateStaked: NEAR;
  staked: NEAR;
  available: NEAR;
}

export type Network = 'testnet' | 'mainnet' | 'sandbox' | 'custom';

export interface ClientConfig {
  network: Network;
  rootAccountId?: string;
  testnetMasterAccountId?: string;
  rpcAddr: string;
  apiKey?: string;
  helperUrl?: string;
  explorerUrl?: string;
  initialBalance?: string;
  walletUrl?: string;
  archivalUrl?: string;
}

export interface Config extends ClientConfig {
  homeDir: string;
  port: number;
  rm: boolean;
  refDir: string | null;
  keyStore?: KeyStore;
}

export const TESTNET_RPC_ADDR = 'https://archival-rpc.testnet.near.org';
export const MAINNET_RPC_ADDR = 'https://archival-rpc.mainnet.near.org';

export interface StateItem {
  key: string;
  value: string;
  proof: string[];
}

export type Empty = {}; // eslint-disable-line @typescript-eslint/ban-types
