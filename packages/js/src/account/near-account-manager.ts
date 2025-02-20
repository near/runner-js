import {type KeyPair} from 'near-api-js';
import {type NEAR} from 'near-units';
import {type TransactionResult} from '../transaction-result';
import {type JsonRpcProvider} from '../jsonrpc';
import {type Transaction} from '../transaction';
import {type Config, type AccountBalance, type AccountView} from '../types';
import {type NearAccount} from './near-account';

export interface NearAccountManager {
  readonly provider: JsonRpcProvider;
  readonly initialBalance: string;
  readonly root: NearAccount;
  accountView(accountId: string): Promise<AccountView>;
  availableBalance(account: string | NearAccount): Promise<NEAR>;
  balance(accountId: string | NearAccount): Promise<AccountBalance>;
  executeTransaction(tx: Transaction, keyPair?: KeyPair): Promise<TransactionResult>;
  addAccountCreated(account: string, sender: string): void;
  getAccount(accountId: string): NearAccount;
  getKey(accountId: string): Promise<KeyPair | null>;
  deleteAccount(accountId: string, beneficiaryId: string, keyPair?: KeyPair): Promise<TransactionResult>;
  deleteKey(accountId: string): Promise<void>;
  cleanup(): Promise<void>;
  /** Creates a KeyPair if one is not provided */
  setKey(accountId: string, keyPair?: KeyPair): Promise<KeyPair>;
  batch(sender: NearAccount | string, receiver: NearAccount | string): Transaction;
  createFrom(config: Config): Promise<NearAccountManager>;
  init(): Promise<NearAccountManager>;
}
