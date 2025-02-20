// eslint-disable unicorn/no-object-as-default-parameter
import {Buffer} from 'buffer';
import process from 'process';
import {NEAR} from 'near-units';
import {stringifyJsonOrBytes} from 'near-api-js/lib/transaction';
import {type Records} from './record';
import {
  JSONRpc,
  type ContractCodeView,
  type AccountView,
  type NearProtocolConfig,
  type AccountBalance,
  type CodeResult,
  type ViewStateResult,
  type BlockId,
  type Finality,
  type StateItem,
  TESTNET_RPC_ADDR,
  type Empty,
  MAINNET_RPC_ADDR,
  type PublicKey,
  type Network,
  type AccessKeyView,
  type AccessKeyList,
} from './types';

const OPTIMISTIC: {finality: 'optimistic'} = {finality: 'optimistic'};
/**
 * Extends the main provider class in near-api-js, adding more methods for
 * interacting with an endpoint.
 */
export class JsonRpcProvider extends JSONRpc {
  /**
   * Create a JsonRpcProvider from config or rpcAddr
   * @param config rpc endpoint URL or a configuration that includes one.
   * @returns JsonRpcProvider
   */
  static from(config: string | {rpcAddr: string}): JsonRpcProvider {
    const url = typeof config === 'string' ? config : config.rpcAddr;
    if (!this.providers.has(url)) {
      this.providers.set(url, new JsonRpcProvider({url}));
    }

    return this.providers.get(url)!;
  }

  static fromNetwork(network: Network): JsonRpcProvider {
    switch (network) {
      case 'mainnet': {
        return process.env.NEAR_CLI_MAINNET_RPC_SERVER_URL
          ? JsonRpcProvider.from(process.env.NEAR_CLI_MAINNET_RPC_SERVER_URL)
          : MainnetRpc;
      }

      case 'testnet': {
        return process.env.NEAR_CLI_TESTNET_RPC_SERVER_URL
          ? JsonRpcProvider.from(process.env.NEAR_CLI_TESTNET_RPC_SERVER_URL)
          : TestnetRpc;
      }

      default: {
        throw new TypeError('Invalid network only mainnet or testnet');
      }
    }
  }

  private static readonly providers: Map<string, JsonRpcProvider> = new Map<string, JsonRpcProvider>();

  /**
   * Download the binary of a given contract.
   * @param accountId contract account
   * @returns Buffer of Wasm binary
   */
  async viewCode(accountId: string, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<Buffer> {
    return Buffer.from(await this.viewCodeRaw(accountId, blockQuery), 'base64');
  }

  /**
   * Download the binary of a given contract.
   * @param accountId contract account
   * @returns Base64 string of Wasm binary
   */
  async viewCodeRaw(accountId: string, blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<string> {
    const {code_base64: codeBase64}: ContractCodeView = await this.query({
      request_type: 'view_code',
      account_id: accountId,
      ...blockQuery,
    });
    return codeBase64;
  }

  async viewAccount(accountId: string, blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<AccountView> {
    return this.query<AccountView>({
      request_type: 'view_account',
      account_id: accountId,
      ...blockQuery,
    });
  }

  async accountExists(accountId: string, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<boolean> {
    try {
      await this.viewAccount(accountId, blockQuery);
      return true;
    } catch {
      return false;
    }
  }

  async viewAccessKey(accountId: string, publicKey: PublicKey | string, blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<AccessKeyView> {
    return this.query({
      request_type: 'view_access_key',
      account_id: accountId,
      public_key: typeof publicKey === 'string' ? publicKey : publicKey.toString(),
      ...blockQuery,
    });
  }

  async viewAccessKeys(accountId: string, blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<AccessKeyList> {
    return this.query({
      request_type: 'view_access_key_list',
      account_id: accountId,
      ...blockQuery,
    });
  }

  async protocolConfig(blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<NearProtocolConfig> {
    // @ts-expect-error Bad type
    return this.experimental_protocolConfig(blockQuery);
  }

  async accountBalance(accountId: string, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<AccountBalance> {
    const config = await this.protocolConfig(blockQuery);
    const state = await this.viewAccount(accountId, blockQuery);
    const cost = config.runtime_config.storage_amount_per_byte;
    const costPerByte = NEAR.from(cost);
    const stateStaked = NEAR.from(state.storage_usage).mul(costPerByte);
    const staked = NEAR.from(state.locked);
    const total = NEAR.from(state.amount).add(staked);
    const available = total.sub(staked.max(stateStaked));
    return {
      total,
      stateStaked,
      staked,
      available,
    };
  }

  async viewCall(accountId: string, methodName: string, args: Record<string, unknown> | Uint8Array, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<CodeResult> {
    const argsBuffer = stringifyJsonOrBytes(args);
    return this.viewCallRaw(accountId, methodName, argsBuffer.toString('base64'), blockQuery);
  }

  /**
   * Get full response from RPC about result of view method
   * @param accountId
   * @param methodName
   * @param args Base64 encoded string
   * @param blockQuery
   * @returns
   */
  async viewCallRaw(accountId: string, methodName: string, args: string, blockQuery: {block_id: BlockId} | {finality: Finality} = OPTIMISTIC): Promise<CodeResult> {
    return this.query({
      request_type: 'call_function',
      account_id: accountId,
      method_name: methodName,
      args_base64: args,
      ...blockQuery,
    });
  }

  /**
   * Download the state of a contract given a prefix of a key.
   *
   * @param accountId contract account to lookup
   * @param prefix string or byte prefix of keys to loodup
   * @param blockQuery state at what block, defaults to most recent final block
   * @returns raw RPC response
   */
  async viewState(accountId: string, prefix: string | Uint8Array, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<Array<{key: Buffer; value: Buffer}>> {
    const values = await this.viewStateRaw(accountId, prefix, blockQuery);

    return values.map(({key, value}) => ({
      key: Buffer.from(key, 'base64'),
      value: Buffer.from(value, 'base64'),
    }));
  }

  /**
   * Download the state of a contract given a prefix of a key without decoding from base64.
   *
   * @param accountId contract account to lookup
   * @param prefix string or byte prefix of keys to loodup
   * @param blockQuery state at what block, defaults to most recent final block
   * @returns raw RPC response
   */
  async viewStateRaw(accountId: string, prefix: string | Uint8Array, blockQuery?: {block_id: BlockId} | {finality: Finality}): Promise<StateItem[]> {
    const {values} = await this.query<ViewStateResult>({
      request_type: 'view_state',
      ...(blockQuery ?? {finality: 'optimistic'}),
      account_id: accountId,
      prefix_base64: Buffer.from(prefix).toString('base64'),
    });

    return values;
  }

  /**
   * Updates records without using a transaction.
   * Note: only avaialable on Sandbox endpoints.
   * @param records
   * @returns Promise<Empty>
   */
  async patchStateRecords(records: Records): Promise<Empty> {
    return this.sendJsonRpc('sandbox_patch_state', records);
  }

  /**
   * Fast forward to a point in the future. The delta block height is supplied to tell the
   * network to advanced a certain amount of blocks. This comes with the advantage only having
   * to wait a fraction of the time it takes to produce the same number of blocks.
   *
   * Estimate as to how long it takes: if our delta_height crosses `X` epochs, then it would
   * roughly take `X * 5` milliseconds for the fast forward request to be processed.
   *
   * Note: This is not to be confused with speeding up the current in-flight transactions;
   * the state being forwarded in this case refers to time-related state (the block height, timestamp and epoch).
   * @param deltaHeight
   * @returns Promise<Empty>
   */
  async fastForward(deltaHeight: number): Promise<Empty> {
    return this.sendJsonRpc('sandbox_fast_forward', {delta_height: deltaHeight});
  }
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TestnetRpc = JsonRpcProvider.from(TESTNET_RPC_ADDR);
// eslint-disable-next-line @typescript-eslint/naming-convention
export const MainnetRpc = JsonRpcProvider.from(MAINNET_RPC_ADDR);
