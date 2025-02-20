/**
 * This test file demonstrates the reuse of the Worker across several tests.
 * The maine differance is the usage of before() and after() AVA functions
 * instead of beforeEach() and after each.
 * Keep in mind that tests are executed in parallel.
 * It means that they should not depend on each other.
 */
import anyTest, {type TestFn} from 'ava';
import {Worker, NEAR, type NearAccount} from '../packages/js';

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.before(async t => {
  const worker = await Worker.init();

  const root = worker.rootAccount;
  const contract = await root.devDeploy(
    '__tests__/build/debug/status_message.wasm',
    {initialBalance: NEAR.parse('3 N').toJSON()},
  );
  const ali = await root.createSubAccount('ali', {initialBalance: NEAR.parse('3 N').toJSON()});

  t.context.worker = worker;
  t.context.accounts = {root, contract, ali};
});

test.after.always(async t => {
  await t.context.worker.tearDown().catch((error: unknown) => {
    console.log('Failed to tear down the worker:', error);
  });
});

test('Root gets null status', async t => {
  const {root, contract} = t.context.accounts;
  const result: null = await contract.view('get_status', {account_id: root.accountId});
  t.is(result, null);
});

test('Ali sets then gets status', async t => {
  const {ali, contract} = t.context.accounts;
  await ali.call(contract, 'set_status', {message: 'hello'});
  const result: string = await contract.view('get_status', {account_id: ali});
  t.is(result, 'hello');
});
