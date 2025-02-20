import {type Buffer} from 'buffer';
import {type KeyPair, type NamedAccount, PublicKey} from '../types';
import {hashContract} from '../utils';
import {
  type AccessKeyData,
  type Account,
  type AccountData,
  type StateRecord,
} from './types';

export class RecordBuilder {
  static fromAccount(accountId: string | Account | NamedAccount): AccountBuilder {
    return new AccountBuilder(accountId);
  }

  readonly records: StateRecord[] = [];

  push(record: StateRecord): this {
    this.records.push(record);
    return this;
  }
}

const DEFAULT_ACCOUNT_DATA: AccountData = {
  // 10_000 NEAR
  amount: '10000000000000000000000000000',
  locked: '0',
  // No contract hash
  code_hash: '11111111111111111111111111111111',
  storage_usage: 0,
  version: 'V1',
};

const DEFAULT_ACCESS_KEY_PERMISSION: AccessKeyData
  = {nonce: 0, permission: 'FullAccess'};

function isAccount(something: Account | NamedAccount): something is Account {
  return 'Account' in something
  && typeof something.Account.account_id === 'string';
}

function isNamedAccount(something: Account | NamedAccount): something is NamedAccount {
  return 'accountId' in something
      && typeof something.accountId === 'string';
}

export class AccountBuilder extends RecordBuilder {
  readonly account_id: string;
  constructor(accountOrId: string | Account | NamedAccount) {
    super();
    if (typeof accountOrId === 'string') {
      this.account_id = accountOrId;
    } else if (isAccount(accountOrId)) {
      this.account_id = accountOrId.Account.account_id;
      this.push(accountOrId);
    } else if (isNamedAccount(accountOrId)) {
      this.account_id = accountOrId.accountId;
    } else {
      throw new TypeError(
        'Only `string` or `Record.Accounts` or `NamedAccount` are allowed.',
      );
    }
  }

  accessKey(key: string | PublicKey | KeyPair, access_key = DEFAULT_ACCESS_KEY_PERMISSION): this {
    const publicKey
      = typeof key === 'string' ? key
        : (key instanceof PublicKey ? key.toString()
          : key.getPublicKey().toString());
    return this.push({
      AccessKey: {
        account_id: this.account_id,
        public_key: publicKey,
        access_key,
      },
    });
  }

  account(accountData?: Partial<AccountData>): this {
    const account = {...DEFAULT_ACCOUNT_DATA, ...accountData};
    return this.push({
      Account: {
        account_id: this.account_id,
        account,
      },
    });
  }

  data(data_key: string, value: string): this {
    return this.push({
      Data: {account_id: this.account_id, data_key, value},
    });
  }

  contract(binary: Buffer | string): this {
    const code = typeof binary === 'string' ? binary : binary.toString('base64');
    const record = {
      Contract: {
        account_id: this.account_id,
        code,
      },
    };

    /**
     * Check conditions on ordering and hashes in records to throw error before sandbox does.
    */
    const accountRecord = this.records.find(r => 'Account' in r && r.Account.account_id === this.account_id) as Account;
    if (!accountRecord) {
      throw new Error(`Contract record with account_id: ${this.account_id} does not have a preceding Account record.`);
    }

    if (hashContract(record.Contract.code) !== accountRecord.Account.account.code_hash) {
      throw new Error(`The hash field of the Account record with account_id: ${this.account_id} does not equal the hash of the binary in the Contract record.`);
    }

    return this.push(record);
  }
}
