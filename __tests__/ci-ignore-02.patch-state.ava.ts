/**
 * This test demonstrates patchState behavior, using the contract from
 * https://github.com/near-examples/rust-status-message
 *
 * If you want to make arbitrary modifications to a contract that wouldn't be
 * possible with ordinary function calls, you can use patchState. In a
 * test below, this is used to set the status of an account that is never
 * created within the testing environment, `alice.near`.
 *
 * patchState is a Sandbox-specific feature, so these tests can't be run on
 * testnet. That's why they're wrapped with `if (getNetworkFromEnv() === 'sandbox')`.
 */

/* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-unsafe-argument */
import anyTest, {type TestFn} from 'ava';
import * as borsh from '../packages/js/node_modules/borsh';
import {Worker, getNetworkFromEnv, type NearAccount} from '../packages/js';
import {NEAR} from '../packages/js/node_modules/near-units';

if (getNetworkFromEnv() === 'sandbox') {
  const test = anyTest as TestFn<{
    worker: Worker;
    accounts: Record<string, NearAccount>;
  }>;

  test.beforeEach(async t => {
    const worker = await Worker.init();
    const root = worker.rootAccount;
    const contract = await root.devDeploy('__tests__/build/debug/status_message.wasm');
    const ali = await root.createSubAccount('ali');

    t.context.worker = worker;
    t.context.accounts = {root, contract, ali};
  });

  test.afterEach.always(async t => {
    await t.context.worker.tearDown().catch((error: unknown) => {
      console.log('Failed to tear down the worker:', error);
    });
  });

  class Assignable {
    [key: string]: any;
    constructor(properties: any) {
      for (const key of Object.keys(properties)) {
        this[key] = properties[key];
      }
    }
  }

  class StatusMessage extends Assignable {}

  class BorshRecord extends Assignable {}

  const schema = new Map([
    [StatusMessage, {kind: 'struct', fields: [['records', [BorshRecord]]]}],
    [
      BorshRecord,
      {
        kind: 'struct',
        fields: [
          ['k', 'string'],
          ['v', 'string'],
        ],
      },
    ],
  ]);

  test('View state', async t => {
    const {contract, ali} = t.context.accounts;
    await ali.call(contract, 'set_status', {message: 'hello'});
    const state = await contract.viewState();
    // Get raw value
    const data = state.getRaw('STATE');
    // Deserialize from borsh
    const statusMessage: StatusMessage = borsh.deserialize(
      schema,
      StatusMessage,
      data,
    );
    t.deepEqual(statusMessage.records[0],
      new BorshRecord({k: ali.accountId, v: 'hello'}),
    );
  });

  test('Patch state', async t => {
    const {contract, ali} = t.context.accounts;
    // Contract must have some state for viewState & patchState to work
    await ali.call(contract, 'set_status', {message: 'hello'});
    // Get state
    const state = await contract.viewState();
    // Get raw value
    const statusMessage = state.get('STATE', {schema, type: StatusMessage});
    // Update contract state
    statusMessage.records.push(
      new BorshRecord({k: 'alice.near', v: 'hello world'}),
    );
    // Serialize and patch state back to runtime
    await contract.patchState(
      'STATE',
      borsh.serialize(schema, statusMessage),
    );
    // Check again that the update worked
    const result = await contract.view('get_status', {
      account_id: 'alice.near',
    });
    t.is(result, 'hello world');
  });

  test('Patch Account', async t => {
    const {root, contract, ali} = t.context.accounts;
    const bob = root.getAccount('bob');
    const public_key = await bob.setKey();
    const {code_hash} = await contract.accountView();
    const BOB_BALANCE = NEAR.parse('100 N');

    await bob.updateAccount({
      amount: BOB_BALANCE.toString(),
      code_hash,
    });

    await bob.updateAccessKey(
      public_key,
      {
        nonce: 0,
        permission: 'FullAccess',
      },
    );

    await bob.updateContract(await contract.viewCode());
    const balance = await bob.availableBalance();
    t.deepEqual(balance, BOB_BALANCE);
    await ali.call(bob, 'set_status', {message: 'hello'});
    const result = await bob.view('get_status', {
      account_id: ali.accountId,
    });

    t.is(result, 'hello');
  });
}
