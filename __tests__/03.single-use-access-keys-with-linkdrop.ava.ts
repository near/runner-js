/**
 * This test verifies the functionality of the contract at
 * https://github.com/near/near-linkdrop
 *
 * An interesting feature of this contract: when someone first visits a linkdrop
 * page, they don't yet have a NEAR account. But they still make a call to the
 * contract! How? From the contract's perspective, it _calls itself_ (see
 * `linkdrop.call(linkdrop, …)` below) using a Function Call access key, which
 * can only call one function (`create_account_and_claim`) and which is only
 * good for one use.
 *
 * You can see this functionality in action below using `signWithKey`.
 */
import anyTest, {type TestFn} from 'ava';
import {
  Worker, createKeyPair, NEAR, type NearAccount,
} from '../packages/js';

/* Contract API for reference
impl Linkdrop {
  pub fn create_account(new_account_id: &str, new_public_key: &str){}
  pub fn get_key_balance(public_key: &str){}
  pub fn send(public_key: &str){}
  pub fn create_account_and_claim(new_account_id: &str, new_public_key: &str){}
  pub fn on_account_created(predecessor_account_id: &str, amount: &str){}
  pub fn on_account_created_and_claimed(amount: &str){}
  pub fn claim(account_id: &str){}
}
*/

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async t => {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const linkdrop = await root.devDeploy(
    '__tests__/build/debug/linkdrop.wasm',
    {initialBalance: NEAR.parse('3 N').toJSON()},
  );

  t.context.worker = worker;
  t.context.accounts = {root, linkdrop};
});

test.afterEach.always(async t => {
  await t.context.worker.tearDown().catch((error: unknown) => {
    console.log('Failed to tear down the worker:', error);
  });
});

test('Use `create_account_and_claim` to create a new account', async t => {
  const {root, linkdrop} = t.context.accounts;
  // Create temporary keys for access key on linkdrop
  const senderKey = createKeyPair();
  const public_key = senderKey.getPublicKey().toString();
  const attachedDeposit = '2 N';

  // This adds the key as a function access key on `create_account_and_claim`
  await root.call(linkdrop, 'send', {public_key}, {attachedDeposit});

  const new_account_id = `bob.${linkdrop.accountId}`;
  const actualKey = createKeyPair();
  const new_public_key = actualKey.getPublicKey().toString();

  await linkdrop.callRaw(
    linkdrop,
    'create_account_and_claim',
    {
      new_account_id,
      new_public_key,
    },
    {
      signWithKey: senderKey,
      gas: '50 TGas',
    },
  );

  const bob = root.getAccount(new_account_id);
  const balance = await bob.availableBalance();
  t.log(balance.toHuman());
  t.deepEqual(balance, NEAR.parse('0.99818'));

  t.log(`Account ${new_account_id} claim and has ${balance.toHuman()} available`);
});

test('Use `claim` to transfer to an existing account', async t => {
  const {root, linkdrop} = t.context.accounts;
  const bob = await root.createSubAccount('bob', {initialBalance: NEAR.parse('3 N').toJSON()});
  const originalBalance = await bob.availableBalance();
  // Create temporary keys for access key on linkdrop
  const senderKey = createKeyPair();
  const public_key = senderKey.getPublicKey().toString();
  const attachedDeposit = '2 N';

  // This adds the key as a function access key on `create_account_and_claim`
  await root.call(linkdrop, 'send', {public_key}, {attachedDeposit});
  // Can only create subaccounts

  await linkdrop.callRaw(
    linkdrop,
    'claim',
    {
      account_id: bob,
    },
    {
      signWithKey: senderKey,
      gas: '50 TGas',
    },
  );

  const newBalance = await bob.availableBalance();

  t.assert(originalBalance.lt(newBalance));
  t.log(
    `${bob.accountId} claimed ${newBalance
      .sub(originalBalance).toHuman()}`,
  );
});
