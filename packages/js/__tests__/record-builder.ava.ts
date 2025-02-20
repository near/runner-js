import path from 'path';
import anyTest, {type TestFn} from 'ava';
import {NEAR} from 'near-units';
import {getNetworkFromEnv, type NearAccount, Worker} from '..';
import {RecordBuilder} from '../dist/record';

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

if (getNetworkFromEnv() === 'sandbox') {
  test.beforeEach(async t => {
    const worker = await Worker.init();
    const root = worker.rootAccount;

    const contract = await root.devDeploy(
      path.join(__dirname, '..', '..', '..', '__tests__', 'build', 'debug', 'status_message.wasm'),
    );
    const ali = await root.createSubAccount('ali');

    t.context.worker = worker;
    t.context.accounts = {root, contract, ali};
  });

  test.afterEach.always(async t => {
    await t.context.worker.tearDown().catch((error: unknown) => {
      console.log('Failed to tear down the worker:', error);
    });
  });

  test('Patch account', async t => {
    const {root, ali, contract} = t.context.accounts;
    const bob = root.getAccount('bob');
    const public_key = await bob.setKey();
    const {code_hash} = await contract.accountView();
    const BOB_BALANCE = NEAR.parse('100 N');
    const rb = RecordBuilder.fromAccount(bob)
      .account({
        amount: BOB_BALANCE.toString(),
        code_hash,
      }).accessKey(
        public_key,
        {
          nonce: 0,
          permission: 'FullAccess',
        }).contract(await contract.viewCode());
    await bob.patchStateRecords(rb);
    const balance = await bob.availableBalance();
    t.deepEqual(balance, BOB_BALANCE);
    await ali.call(bob, 'set_status', {message: 'hello'});
    const result = await bob.view('get_status', {
      account_id: ali.accountId,
    });
    t.is(result, 'hello');
  });
} else {
  test('skipping; not using sandbox', t => {
    t.true(true);
    // Ava requires a test in each file
  });
}
