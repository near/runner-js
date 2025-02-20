import {type URL} from 'url';
import {Buffer} from 'buffer';
import {env} from 'process';
import type BN from 'bn.js';
import {type NEAR} from 'near-units';
import * as borsh from 'borsh';
import {
  DEFAULT_FUNCTION_CALL_GAS,
  type KeyPair,
  type PublicKey,
  type CodeResult,
  type AccountBalance,
  type Args,
  type AccountView,
  type Empty,
  type StateItem,
  type AccessKeyView,
  type AccessKeyList,
} from '../types';
import {type Transaction} from '../transaction';
import {ContractState} from '../contract-state';
import {JsonRpcProvider} from '../jsonrpc';
import {EMPTY_CONTRACT_HASH, NO_DEPOSIT, randomAccountId} from '../utils';
import {type TransactionResult, TransactionError} from '../transaction-result';
import {
  type AccessKeyData,
  type AccountBuilder,
  type AccountData,
  RecordBuilder,
  type Records,
} from '../record';
import {type NearAccount} from './near-account';
import {type NearAccountManager} from './near-account-manager';

export class Account implements NearAccount {
  constructor(
    private readonly _accountId: string,
    private readonly manager: NearAccountManager,
  ) {}

  async accountView(): Promise<AccountView> {
    return this.manager.accountView(this._accountId);
  }

  async exists(): Promise<boolean> {
    return this.provider.accountExists(this.accountId);
  }

  protected get provider(): JsonRpcProvider {
    return this.manager.provider;
  }

  get accountId(): string {
    return this._accountId;
  }

  async availableBalance(): Promise<NEAR> {
    return this.manager.availableBalance(this.accountId);
  }

  async balance(): Promise<AccountBalance> {
    return this.manager.balance(this.accountId);
  }

  batch(receiver: NearAccount | string): Transaction {
    return this.manager.batch(this, receiver);
  }

  async getKey(): Promise<KeyPair | null> {
    return this.manager.getKey(this.accountId);
  }

  async setKey(keyPair?: KeyPair): Promise<PublicKey> {
    const keyPairResult = await this.manager.setKey(this.accountId, keyPair);
    return keyPairResult.getPublicKey();
  }

  async createAccount(
    accountId: string,
    {
      keyPair,
      initialBalance,
    }: {keyPair?: KeyPair; initialBalance?: string; isSubAccount?: boolean} = {},
  ): Promise<NearAccount> {
    const tx = await this.internalCreateAccount(accountId, {
      keyPair,
      initialBalance,
      isSubAccount: false,
    });

    const result = await tx.transact();

    if (result.Failure) {
      throw new Error(`Failure during trasaction excecution, details: ${JSON.stringify(result)}`);
    }

    return this.getAccount(accountId);
  }

  async createSubAccount(
    accountId: string,
    {
      keyPair,
      initialBalance,
    }: {keyPair?: KeyPair; initialBalance?: string; isSubAccount?: boolean} = {},
  ): Promise<NearAccount> {
    const tx = await this.internalCreateAccount(accountId, {
      keyPair,
      initialBalance,
      isSubAccount: true,
    });

    const result = await tx.transact();

    if (result.Failure) {
      throw new Error(`Failure during trasaction excecution, details: ${JSON.stringify(result)}`);
    }

    return this.getSubAccount(accountId);
  }

  async importContract({
    testnetContract,
    mainnetContract,
    withData = false,
    blockId,
    keyPair,
    initialBalance,
  }: {
    testnetContract?: string;
    mainnetContract?: string;
    withData?: boolean;
    keyPair?: KeyPair;
    initialBalance?: string;
    blockId?: number | string;
  }): Promise<NearAccount> {
    if ((testnetContract && mainnetContract) ?? !(testnetContract ?? mainnetContract)) {
      throw new TypeError('Provide `mainnetContract` or `testnetContract` but not both.');
    }

    const network = mainnetContract ? 'mainnet' : 'testnet';
    const refContract = (mainnetContract ?? testnetContract)!;

    const rpc = JsonRpcProvider.fromNetwork(network);
    const blockQuery = blockId ? {block_id: blockId} : undefined;
    const account = this.getAccount(refContract) as Account;

    // Get account view of account on reference network
    const accountView = await rpc.viewAccount(refContract, blockQuery);
    accountView.amount = initialBalance ?? accountView.amount;
    const pubKey = await account.setKey(keyPair);
    const records = account.recordBuilder()
      .account(accountView)
      .accessKey(pubKey);

    if (accountView.code_hash !== EMPTY_CONTRACT_HASH) {
      const binary = await rpc.viewCodeRaw(refContract, blockQuery);
      records.contract(binary);
    }

    await account.patchStateRecords(records);

    if (!await this.provider.accountExists(refContract)) {
      await account.patchStateRecords(records);
      if (!await this.provider.accountExists(refContract)) {
        throw new Error(`Account ${refContract} does not exist after trying to patch into sandbox.`);
      }
    }

    if (withData) {
      const rawData = await rpc.viewStateRaw(account.accountId, '', blockQuery);
      const data = rawData.map(({key, value}) => ({
        Data: {
          account_id: account.accountId, data_key: key, value,
        },
      }));
      await account.patchStateRecords({records: data});
    }

    return account;
  }

  getSubAccount(accountId: string): NearAccount {
    const id = this.makeSubAccount(accountId);
    return this.getAccount(id);
  }

  getAccount(accountId: string): NearAccount {
    return new Account(accountId, this.manager);
  }

  async deploy(code: string | URL | Uint8Array | Buffer): Promise<TransactionResult> {
    const tx = await this.batch(this).deployContractFile(code);
    return tx.transact();
  }

  async devCreateAccount({
    initialBalance,
    keyPair,
  }: {
    initialBalance?: BN | string;
    keyPair?: KeyPair;
  } = {}): Promise<NearAccount> {
    const accountId = `${randomAccountId('dev-', 5, 5)}.${this.accountId}`;
    const tx = await this.internalCreateAccount(accountId, {
      keyPair,
      initialBalance,
    });

    const result = await tx.transact();

    if (result.Failure) {
      throw new Error(`Failure during account creation, details: ${JSON.stringify(result)}`);
    }

    return this.getAccount(accountId);
  }

  async devDeploy(
    wasm: string | URL | Uint8Array | Buffer,
    {
      attachedDeposit = NO_DEPOSIT,
      args = {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      gas = DEFAULT_FUNCTION_CALL_GAS,
      initialBalance,
      keyPair,
      method,
      isSubAccount,
    }: {
      args?: Record<string, unknown> | Uint8Array;
      attachedDeposit?: string | BN;
      gas?: string | BN;
      initialBalance?: BN | string;
      keyPair?: KeyPair;
      method?: string;
      isSubAccount?: boolean;
    } = {},
  ): Promise<NearAccount> {
    const accountId = `${randomAccountId('dev-', 5, 5)}.${this.accountId}`;
    let tx = await this.internalCreateAccount(accountId, {
      keyPair,
      initialBalance,
      isSubAccount,
    });
    tx = await tx.deployContractFile(wasm);
    if (method) {
      tx.functionCall(method, args, {gas, attachedDeposit});
    }

    const result = await tx.transact();

    if (result.Failure) {
      throw new Error(`Failure during trasaction excecution, details: ${JSON.stringify(result)}`);
    }

    return this.getAccount(accountId);
  }

  async callRaw(
    contractId: NearAccount | string,
    methodName: string,
    args: Record<string, unknown> | Uint8Array,
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      gas = DEFAULT_FUNCTION_CALL_GAS,
      attachedDeposit = NO_DEPOSIT,
      signWithKey = undefined,
    }: {
      gas?: string | BN;
      attachedDeposit?: string | BN;
      signWithKey?: KeyPair;
    } = {},
  ): Promise<TransactionResult> {
    return this.batch(contractId)
      .functionCall(methodName, args, {gas, attachedDeposit})
      .transact(signWithKey);
  }

  async call<T>(
    contractId: NearAccount | string,
    methodName: string,
    args: Record<string, unknown> | Uint8Array,
    {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      gas = DEFAULT_FUNCTION_CALL_GAS,
      attachedDeposit = NO_DEPOSIT,
      signWithKey = undefined,
    }: {
      gas?: string | BN;
      attachedDeposit?: string | BN;
      signWithKey?: KeyPair;
    } = {},
  ): Promise<T> {
    const txResult = await this.callRaw(contractId, methodName, args, {
      gas,
      attachedDeposit,
      signWithKey,
    });

    if (!env.NEAR_WORKSPACES_NO_LOGS && txResult.logs.length > 0) {
      const accountId = typeof contractId === 'string' ? contractId : contractId.accountId;
      console.log(`Contract logs from ${accountId}.${methodName}(${JSON.stringify(args)}) call:`, txResult.logs);
    }

    if (txResult.failed) {
      throw new TransactionError(txResult);
    }

    return txResult.parseResult<T>();
  }

  async viewRaw(method: string, args: Args = {}): Promise<CodeResult> {
    return this.provider.viewCall(this.accountId, method, args);
  }

  async view<T>(method: string, args: Args = {}): Promise<T> {
    const result = await this.viewRaw(method, args);

    if (!env.NEAR_WORKSPACES_NO_LOGS && result.logs.length > 0) {
      console.log(`Contract logs from ${this.accountId}.${method}(${JSON.stringify(args)}) view call:`, result.logs);
    }

    if (result.result) {
      const value = Buffer.from(result.result).toString();
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    }

    return null as unknown as T;
  }

  async viewCode(): Promise<Buffer> {
    return this.provider.viewCode(this.accountId);
  }

  async viewCodeRaw(): Promise<string> {
    return this.provider.viewCodeRaw(this.accountId);
  }

  async viewState(prefix: string | Uint8Array = ''): Promise<ContractState> {
    return new ContractState(
      await this.provider.viewState(this.accountId, prefix),
    );
  }

  async viewStateRaw(prefix: string | Uint8Array = ''): Promise<StateItem[]> {
    return this.provider.viewStateRaw(this.accountId, prefix);
  }

  async viewAccessKey(accountId: string, publicKey: PublicKey | string): Promise<AccessKeyView> {
    return this.provider.viewAccessKey(accountId, publicKey);
  }

  async viewAccessKeys(accountId: string): Promise<AccessKeyList> {
    return this.provider.viewAccessKeys(accountId);
  }

  async patchState(key: string, value_: any, borshSchema?: any): Promise<Empty> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.updateData(Buffer.from(key), Buffer.from(borshSchema ? borsh.serialize(borshSchema, value_) : value_));
  }

  async patchStateRecords(records: Records): Promise<Empty> {
    // FIX THIS: Shouldn't need two calls to update before next RPC view call.
    await this.provider.patchStateRecords(records);
    return this.provider.patchStateRecords(records);
  }

  async delete(beneficiaryId: string, keyPair?: KeyPair): Promise<TransactionResult> {
    const result = await this.batch(this)
      .deleteAccount(beneficiaryId)
      .transact(keyPair);
    if (result.succeeded && await this.getKey() !== null) {
      await this.manager.deleteKey(this.accountId);
    }

    return result;
  }

  makeSubAccount(accountId: string): string {
    return `${accountId}.${this.accountId}`;
  }

  subAccountOf(accountId: string): boolean {
    return accountId.endsWith(`.${this.accountId}`);
  }

  toJSON(): string {
    return this.accountId;
  }

  async updateAccount(accountData?: Partial<AccountData>): Promise<Empty> {
    return this.patchStateRecords(this.recordBuilder().account(accountData));
  }

  async updateAccessKey(key: string | PublicKey | KeyPair, access_key_data?: AccessKeyData): Promise<Empty> {
    return this.patchStateRecords(this.recordBuilder().accessKey(key, access_key_data));
  }

  async updateContract(binary: Buffer | string): Promise<Empty> {
    const accountView = await this.accountView();
    const rb = this.recordBuilder();
    rb.account(accountView);
    return this.patchStateRecords(rb.contract(binary));
  }

  async updateData(key: string | Buffer, value: string | Buffer): Promise<Empty> {
    const keyString = key instanceof Buffer ? key.toString('base64') : key;
    const valueString = value instanceof Buffer ? value.toString('base64') : value;
    return this.patchStateRecords(this.recordBuilder().data(keyString, valueString));
  }

  async transfer(accountId: string | NearAccount, amount: string | BN): Promise<TransactionResult> {
    return this.batch(accountId).transfer(amount).transact();
  }

  protected async internalCreateAccount(
    accountId: string,
    {
      keyPair,
      initialBalance,
      isSubAccount,
    }: {keyPair?: KeyPair; initialBalance?: string | BN; isSubAccount?: boolean} = {},
  ): Promise<Transaction> {
    const newAccountId = isSubAccount ? this.makeSubAccount(accountId) : accountId;
    const keyPairResult = await this.getOrCreateKey(newAccountId, keyPair);
    const pubKey = keyPairResult.getPublicKey();
    const amount = (initialBalance ?? this.manager.initialBalance).toString();
    return this.batch(newAccountId)
      .createAccount()
      .transfer(amount)
      .addKey(pubKey);
  }

  private async getOrCreateKey(accountId: string, keyPair?: KeyPair): Promise<KeyPair> {
    return (await this.manager.getKey(accountId)) ?? this.manager.setKey(accountId, keyPair);
  }

  private recordBuilder(): AccountBuilder {
    return RecordBuilder.fromAccount(this);
  }
}
