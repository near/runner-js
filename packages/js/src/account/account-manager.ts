import * as path from 'path';
import * as process from 'process';
import * as nearAPI from 'near-api-js';
import {NEAR} from 'near-units';
import {asId, isTopLevelAccount, randomAccountId} from '../utils';
import {
  type Config,
  type KeyPair,
  BN,
  KeyPairEd25519,
  type FinalExecutionOutcome,
  type KeyStore,
  type AccountBalance,
  type NamedAccount,
  type PublicKey,
  type AccountView,
} from '../types';
import {debug, txDebug} from '../internal-utils';
import {Transaction} from '../transaction';
import {JsonRpcProvider} from '../jsonrpc';
import {TransactionResult} from '../transaction-result';
import {Account} from './account';
import {type NearAccount} from './near-account';
import {getKeyFromFile} from './utils';
import {type NearAccountManager} from './near-account-manager';

export abstract class AccountManager implements NearAccountManager {
  static create(
    config: Config,
  ): AccountManager {
    const {network} = config;
    switch (network) {
      case 'sandbox': {
        return new SandboxManager(config);
      }

      case 'testnet': {
        return new TestnetManager(config);
      }

      case 'custom': {
        return new CustomnetManager(config);
      }

      default: {
        throw new Error(`Bad network id: "${network as string}"; expected "testnet", "custom" or "sandbox"`);
      }
    }
  }

  accountsCreated: Set<string> = new Set<string>();
  private _root?: NearAccount;
  constructor(
    protected config: Config,
  ) {}

  async accountView(accountId: string): Promise<AccountView> {
    return this.provider.viewAccount(accountId);
  }

  getAccount(accountId: string): NearAccount {
    return new Account(accountId, this);
  }

  getParentAccount(accountId: string): NearAccount {
    const split = accountId.split('.');
    if (split.length === 1) {
      return this.getAccount(accountId);
    }

    return this.getAccount(split.slice(1).join('.'));
  }

  async deleteKey(
    accountId: string,
  ): Promise<void> {
    try {
      await this.keyStore.removeKey(this.networkId, accountId);
      debug(`deleted Key for ${accountId}`);
    } catch {
      debug(`Failed to delete key for ${accountId}`);
    }
  }

  async init(): Promise<AccountManager> {
    return this;
  }

  get root(): NearAccount {
    this._root ||= new Account(this.rootAccountId, this);

    return this._root;
  }

  get initialBalance(): string {
    return this.config.initialBalance ?? this.DEFAULT_INITIAL_BALANCE;
  }

  get doubleInitialBalance(): BN {
    return new BN(this.initialBalance).mul(new BN('2'));
  }

  get provider(): JsonRpcProvider {
    return JsonRpcProvider.from(this.config);
  }

  batch(sender: NearAccount | string, receiver: NearAccount | string): Transaction {
    return new ManagedTransaction(this, sender, receiver);
  }

  async getKey(accountId: string): Promise<KeyPair | null> {
    return this.keyStore.getKey(this.networkId, accountId);
  }

  async getPublicKey(accountId: string): Promise<PublicKey | null> {
    const keyPair = await this.getKey(accountId);
    return keyPair?.getPublicKey() ?? null;
  }

  /** Sets the provided key to store, otherwise creates a new one */
  async setKey(accountId: string, keyPair?: KeyPair): Promise<KeyPair> {
    const key = keyPair ?? KeyPairEd25519.fromRandom();
    await this.keyStore.setKey(this.networkId, accountId, key);
    debug(`Setting keys for ${accountId}`);
    return (await this.getKey(accountId))!;
  }

  async removeKey(accountId: string): Promise<void> {
    await this.keyStore.removeKey(this.networkId, accountId);
  }

  async deleteAccount(accountId: string, beneficiaryId: string, keyPair?: KeyPair): Promise<TransactionResult> {
    try {
      return await this.getAccount(accountId).delete(beneficiaryId, keyPair);
    } catch (error: unknown) {
      if (keyPair) {
        debug(`Failed to delete ${accountId} with different keyPair`);
        return this.deleteAccount(accountId, beneficiaryId);
      }

      throw error;
    }
  }

  async getRootKey(): Promise<KeyPair> {
    const keyPair = await this.getKey(this.rootAccountId);
    if (!keyPair) {
      return this.setKey(this.rootAccountId);
    }

    return keyPair;
  }

  async balance(account: string | NearAccount): Promise<AccountBalance> {
    return this.provider.accountBalance(asId(account));
  }

  async availableBalance(account: string | NearAccount): Promise<NEAR> {
    const balance = await this.balance(account);
    return balance.available;
  }

  async exists(accountId: string | NearAccount): Promise<boolean> {
    return this.provider.accountExists(asId(accountId));
  }

  async canCoverBalance(account: string | NearAccount, amount: BN): Promise<boolean> {
    return amount.lt(await this.availableBalance(account));
  }

  async executeTransaction(tx: Transaction, keyPair?: KeyPair): Promise<TransactionResult> {
    const account: nearAPI.Account = new nearAPI.Account(this.connection, tx.senderId);
    let oldKey: KeyPair | null = null;
    if (keyPair) {
      oldKey = await this.getKey(account.accountId);
      await this.setKey(account.accountId, keyPair);
    }

    try {
      const start = Date.now();
      const outcome: FinalExecutionOutcome = await account.signAndSendTransaction({receiverId: tx.receiverId, actions: tx.actions, returnError: true});
      const end = Date.now();
      if (oldKey) {
        await this.setKey(account.accountId, oldKey);
      } else if (keyPair) {
        // Sender account should only have account while execution transaction
        await this.deleteKey(tx.senderId);
      }

      const result = new TransactionResult(outcome, start, end, this.config);
      txDebug(result.summary());
      return result;
    } catch (error: unknown) {
      // Add back oldKey if temporary one was used
      if (oldKey) {
        await this.setKey(account.accountId, oldKey);
      }

      if (error instanceof Error) {
        const key = await this.getPublicKey(tx.receiverId);
        debug(`TX FAILED: receiver ${tx.receiverId} with key ${key?.toString() ?? 'MISSING'} ${JSON.stringify(tx.actions).slice(0, 1000)}`);
        debug(error);
      }

      throw error;
    }
  }

  addAccountCreated(account: string, _sender: string): void {
    this.accountsCreated.add(account);
  }

  async cleanup(): Promise<void> {} // eslint-disable-line @typescript-eslint/no-empty-function

  get rootAccountId(): string {
    return this.config.rootAccountId!;
  }

  protected set rootAccountId(value: string) {
    this.config.rootAccountId = value;
  }

  abstract get DEFAULT_INITIAL_BALANCE(): string;
  abstract createFrom(config: Config): Promise<NearAccountManager>;
  abstract get defaultKeyStore(): KeyStore;

  protected get keyStore(): KeyStore {
    return this.config.keyStore ?? this.defaultKeyStore;
  }

  protected get signer(): nearAPI.InMemorySigner {
    return new nearAPI.InMemorySigner(this.keyStore);
  }

  protected get networkId(): string {
    return this.config.network;
  }

  protected get connection(): nearAPI.Connection {
    return new nearAPI.Connection(this.networkId, this.provider, this.signer, `jsvm.${this.networkId}`);
  }
}

export class CustomnetManager extends AccountManager {
  get DEFAULT_INITIAL_BALANCE(): string {
    return NEAR.parse('10 N').toJSON();
  }

  get defaultKeyStore(): KeyStore {
    return new nearAPI.keyStores.InMemoryKeyStore();
  }

  get connection(): nearAPI.Connection {
    return new nearAPI.Connection(this.networkId, this.provider, this.signer, `jsvm.${this.networkId}`);
  }

  get networkId(): string {
    return this.config.network;
  }

  async init(): Promise<AccountManager> {
    return this;
  }

  async createFrom(config: Config): Promise<NearAccountManager> {
    return new CustomnetManager(config);
  }
}

export class TestnetManager extends AccountManager {
  static readonly KEYSTORE_PATH: string = path.join(process.cwd(), '.near-credentials', 'workspaces');
  private static numTestAccounts = 0;

  private _testnetRoot?: NearAccount;

  static get defaultKeyStore(): KeyStore {
    const keyStore = new nearAPI.keyStores.UnencryptedFileSystemKeyStore(
      this.KEYSTORE_PATH,
    );
    return keyStore;
  }

  get masterAccountId(): string {
    const passedAccountId = this.config.testnetMasterAccountId ?? process.env.TESTNET_MASTER_ACCOUNT_ID;
    if (!passedAccountId) {
      throw new Error(
        'Master account is not provided. You can set it in config while calling Worker.init(config); or with TESTNET_MASTER_ACCOUNT_ID env variable',
      );
    }

    return passedAccountId;
  }

  get fullRootAccountId(): string {
    return this.rootAccountId + '.' + this.masterAccountId;
  }

  get root(): NearAccount {
    this._testnetRoot ||= new Account(this.fullRootAccountId, this);

    return this._testnetRoot;
  }

  get DEFAULT_INITIAL_BALANCE(): string {
    return NEAR.parse('10 N').toJSON();
  }

  get defaultKeyStore(): KeyStore {
    return TestnetManager.defaultKeyStore;
  }

  get urlAccountCreator(): nearAPI.accountCreator.UrlAccountCreator {
    return new nearAPI.accountCreator.UrlAccountCreator(
      {} as nearAPI.Connection, // ignored
      this.config.helperUrl!,
    );
  }

  async init(): Promise<AccountManager> {
    this.rootAccountId ||= randomAccountId('r-', 5, 5);

    if (!(await this.exists(this.fullRootAccountId))) {
      await this.getAccount(this.masterAccountId).createSubAccount(this.rootAccountId);
    }

    return this;
  }

  async createTopLevelAccountWithHelper(accountId: string, keyPair: KeyPair): Promise<void> {
    await this.urlAccountCreator.createAccount(accountId, keyPair.getPublicKey());
  }

  async createAccount(accountId: string, keyPair?: KeyPair): Promise<NearAccount> {
    if (accountId.includes('.')) {
      await this.getParentAccount(accountId).createAccount(accountId, {keyPair});
      this.accountsCreated.delete(accountId);
    } else {
      await this.createTopLevelAccountWithHelper(accountId, keyPair ?? await this.getRootKey());
      debug(`Created account ${accountId} with account creator`);
    }

    return this.getAccount(accountId);
  }

  async addFundsFromNetwork(accountId: string = this.fullRootAccountId): Promise<void> {
    const temporaryId = randomAccountId();
    try {
      const key = await this.getRootKey();
      const account = await this.createAccount(temporaryId, key);
      await account.delete(accountId, key);
    } catch (error: unknown) {
      if (error instanceof Error) {
        await this.removeKey(temporaryId);
      }

      throw error;
    }
  }

  async addFunds(accountId: string, amount: BN): Promise<void> {
    const parent = this.getParentAccount(accountId);
    if (parent.accountId === accountId) {
      return this.addFundsFromNetwork(accountId);
    }

    if (!(await this.canCoverBalance(parent, amount))) {
      await this.addFunds(parent.accountId, amount);
    }

    await parent.transfer(accountId, amount);
  }

  async deleteAccounts(accounts: string[], beneficiaryId: string): Promise<void[]> {
    const keyPair = await this.getKey(this.rootAccountId) ?? undefined;
    return Promise.all(
      accounts.map(async accountId => {
        await this.deleteAccount(accountId, beneficiaryId, keyPair);
        await this.deleteKey(accountId);
      }),
    );
  }

  async createFrom(config: Config): Promise<AccountManager> {
    const currentRunAccount = TestnetManager.numTestAccounts;
    const prefix = currentRunAccount === 0 ? '' : currentRunAccount;
    TestnetManager.numTestAccounts += 1;
    const newConfig = {...config, rootAccount: `t${prefix}.${config.rootAccountId!}`};
    return (new TestnetManager(newConfig)).init();
  }

  async cleanup(): Promise<void> {
    return this.deleteAccounts([...this.accountsCreated.values()], this.rootAccountId) as unknown as void;
  }

  async needsFunds(accountId: string, amount: BN): Promise<boolean> {
    return !amount.isZero() && this.isRootOrTLAccount(accountId)
    && (!await this.canCoverBalance(accountId, amount));
  }

  isRootOrTLAccount(accountId: string): boolean {
    return this.rootAccountId === accountId || isTopLevelAccount(accountId);
  }
}

export class SandboxManager extends AccountManager {
  async init(): Promise<AccountManager> {
    if (!await this.getKey(this.rootAccountId)) {
      await this.setKey(this.rootAccountId, await getKeyFromFile(this.keyFilePath));
    }

    return this;
  }

  async createFrom(config: Config): Promise<NearAccountManager> {
    return new SandboxManager(config);
  }

  get DEFAULT_INITIAL_BALANCE(): string {
    return NEAR.parse('200 N').toJSON();
  }

  get defaultKeyStore(): KeyStore {
    const keyStore = new nearAPI.keyStores.UnencryptedFileSystemKeyStore(
      this.config.homeDir,
    );
    return keyStore;
  }

  get keyFilePath(): string {
    return path.join(this.config.homeDir, 'validator_key.json');
  }
}

export class ManagedTransaction extends Transaction {
  private delete = false;
  constructor(private readonly manager: AccountManager, sender: NamedAccount | string, receiver: NamedAccount | string) {
    super(sender, receiver);
  }

  createAccount(): this {
    this.manager.addAccountCreated(this.receiverId, this.senderId);
    return super.createAccount();
  }

  deleteAccount(beneficiaryId: string): this {
    this.delete = true;
    return super.deleteAccount(beneficiaryId);
  }

  /**
   *
   * @param keyPair Temporary key to sign transaction
   * @returns
   */
  async transact(keyPair?: KeyPair): Promise<TransactionResult> {
    const executionResult = await this.manager.executeTransaction(this, keyPair);
    if (executionResult.succeeded && this.delete) {
      await this.manager.deleteKey(this.receiverId);
    }

    return executionResult;
  }
}

