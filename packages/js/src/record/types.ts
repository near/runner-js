import {type FunctionCallPermissionView} from '../types';

export interface KeyData {
  public_key: string; // "ed25519:546XB2oHhj7PzUKHiH9Xve3Ze5q1JiW2WTh6abXFED3c",
  access_key: AccessKeyData;
}

export interface AccessKeyData {
  nonce: number; // 0,
  permission: 'FullAccess' | FunctionCallPermissionView;
}

export interface AccessKey {
  AccessKey: {
    account_id: string; // "near",
  } & KeyData;
}

export interface AccountData {
  amount: string; // "1000000000000000000000000000000000",
  locked: string; // "0",
  code_hash: string; // "11111111111111111111111111111111",
  storage_usage: number; // 0
  version: 'V1';
}

export interface Account {
  Account: {
    account_id: string;
    account: AccountData;
  };
}

export interface Contract {
  Contract: {
    account_id: string;
    /** Base64 Encoded */
    code: string;
  };
}

// Need to fill out all record types
export interface Data {
  Data: {account_id: string; data_key: string; value: string};
}

export type StateRecord = Data | Account | AccessKey | Contract;

export interface Records {
  records: StateRecord[];
}

/**
 * Unimplemented types

    /// Postponed Action Receipt.
    PostponedReceipt(Box<Receipt>),
    /// Received data from DataReceipt encoded in base64 for the given account_id and data_id.
    ReceivedData {
        account_id: AccountId,
        data_id: CryptoHash,
        #[serde(with = "option_base64_format")]
        data: Option<Vec<u8>>,
    },
    /// Delayed Receipt.
    /// The receipt was delayed because the shard was overwhelmed.
    DelayedReceipt(Box<Receipt>),
 */
