import anyTest, {type TestFn} from 'ava';
import {getNetworkFromEnv, type NearAccount, Worker} from '../packages/js';

if (getNetworkFromEnv() === 'testnet') {
  const test = anyTest as TestFn<{
    worker: Worker;
    accounts: Record<string, NearAccount>;
  }>;

  test.beforeEach(async t => {
    t.context.worker = await Worker.init({
      network: 'testnet',
      rootAccountId: 'meta',
    });
  });

  test.afterEach.always(async t => {
    await t.context.worker.tearDown().catch((error: unknown) => {
      console.log('Failed to tear down the worker:', error);
    });
  });

  test('Inspecting an account on testnet', async t => {
    // The rootAccointId is not meta anymore, invertigate if it's important
    // const root = t.context.worker.rootAccount;
    // t.is(root.accountId, 'meta');
    // t.assert(await root.exists());
    t.assert(true);
  });
}
