import path from 'path';
import anyTest, {type TestFn} from 'ava';
import {getNetworkFromEnv, type NearAccount, Worker} from '..';

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

if (getNetworkFromEnv() === 'sandbox') {
  test.beforeEach(async t => {
    const worker = await Worker.init();
    const root = worker.rootAccount;

    t.context.worker = worker;
    t.context.accounts = {root};
  });

  test.afterEach.always(async t => {
    await t.context.worker.tearDown().catch((error: unknown) => {
      console.log('Failed to tear down the worker:', error);
    });
  });

  test('deploy', async t => {
    const {root} = t.context.accounts;
    const statusMessage = await root.createSubAccount('statusmessage');
    await statusMessage.deploy(path.join(__dirname, '..', '..', '..', '__tests__', 'build', 'debug', 'status_message.wasm'));
    await root.call(statusMessage, 'set_status', {message: 'hello'});
    const result = await statusMessage.view('get_status', {account_id: root});
    t.is(result, 'hello');
  });

  test('devCreateAccount', async t => {
    const {root} = t.context.accounts;
    const developmentAccount = await root.devCreateAccount();
    await developmentAccount.deploy(path.join(__dirname, '..', '..', '..', '__tests__', 'build', 'debug', 'status_message.wasm'));
    await root.call(developmentAccount, 'set_status', {message: 'hello'});
    const result = await developmentAccount.view('get_status', {account_id: root});
    t.is(result, 'hello');
  });

  test('viewAccessKeys', async t => {
    const {root} = t.context.accounts;
    const access = await root.viewAccessKeys(root.accountId);
    t.is(access.keys.length, 1);
    t.is(access.keys[0].access_key.permission, 'FullAccess');
  });
}
