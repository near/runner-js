/**
 * This test shows how to "spoon" a contract from testnet or mainnet to your
 * local sandbox environment. "Spooning" is copying a contract's bytes (compiled
 * source code) and data from one network and pasting it into another.
 *
 * This test shows off how to spoon just contract bytes from mainnet. You could
 * do the same with testnet: just replace the `mainnetContract` lines below with
 * a `testnetContract` equivalent.
 *
 * You can use `withData` to also pull the data of a contract. However, at this
 * time most RPC endpoints limit these queries to 50kB (see the "Heads Up" at
 * https://docs.near.org/docs/api/rpc/contracts#view-contract-state). Some teams
 * at NEAR are hard at work giving you an easy way to run your own RPC server,
 * at which point you can point tests at your custom RPC endpoint and get around
 * the 50kB limit.
 *
 * Even without the ability to fetch the data, being able to test against "live"
 * contracts can give you a huge confidence boost that your contracts will work
 * as expected once actually deployed.
 */
import anyTest, {type TestFn} from 'ava';
import {
  Gas,
  NEAR,
  type NearAccount,
  Worker,
  captureError,
} from '../packages/js';

const REF_FINANCE_ACCOUNT = 'v2.ref-finance.near';

const DEFAULT_BLOCK_HEIGHT = 45_800_000;

const INIT_SHARES_SUPPLY = '1000000000000000000000000';

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async t => {
  t.context.worker = await Worker.init();
});

test.afterEach.always(async t => {
  await t.context.worker.tearDown().catch((error: unknown) => {
    console.log('Failed to tear down the worker:', error);
  });
});

test('using `withData` for contracts > 50kB fails', async t => {
  const root = t.context.worker.rootAccount;

  const error_response = await captureError(async () => {
    await root.importContract({
      mainnetContract: REF_FINANCE_ACCOUNT,
      withData: true,
      blockId: 50_000_000,
    });
  });
  t.assert(
    error_response.includes('is larger than allowed') || error_response.includes('is too large to be viewed'),
  );
});

test('if skipping `withData`, fetches only contract Wasm bytes', async t => {
  const root = t.context.worker.rootAccount;

  const refFinance = await root.importContract({
    mainnetContract: REF_FINANCE_ACCOUNT,
    blockId: DEFAULT_BLOCK_HEIGHT,
  });
  t.regex(
    await captureError(async () => refFinance.view('version')),
    /The contract is not initialized/,
  );
});

/**
     * This test copies logic from the Ref.Finance source code:
     * https://github.com/ref-finance/ref-contracts/blob/e96a6b5e3b403a3ba5271b6a03843a50b3e54a4f/ref-exchange/src/lib.rs#L454-L501
     *
     * However, this test also has some cool upgrades compared to the tests there:
     *
     *   - Whereas Rust unit tests can only interact with one contract, this
     *     test makes actual cross-contract calls (compare `depositTokens` here to
     *     `deposit_tokens` at the link above, for example).
     *   - It uses a local Fungible Token contract while pulling "live" versions
     *     of Ref Finance and wNEAR. Using this approach can help give you
     *     confidence that your contracts work as expected with deployed contracts
     *     on testnet or mainnet.
     */
test('integrate own FT with Ref.Finance', async t => {
  const root = t.context.worker.rootAccount;

  const [ft, refFinance, wNEAR] = await Promise.all([
    root.devDeploy(
      '__tests__/build/debug/fungible_token.wasm',
      {
        method: 'new_default_meta',
        args: {
          owner_id: root,
          total_supply: NEAR.parse('1,000,000,000 N'),
        },
      }),
    createRef(root),
    createWNEAR(root),
  ]);
  const pool_id = await createPoolWithLiquidity(root, refFinance, {
    [ft.accountId]: NEAR.parse('5 N').toJSON(),
    [wNEAR.accountId]: NEAR.parse('10 N').toJSON(),
  });
  await depositTokens(root, refFinance, {
    [ft.accountId]: NEAR.parse('100 N').toJSON(),
    [wNEAR.accountId]: NEAR.parse('100 N').toJSON(),
  });
  await depositTokens(root, refFinance, {});
  t.is(
    await refFinance.view('get_deposit', {account_id: root, token_id: ft}),
    NEAR.parse('100 N').toJSON(),
  );
  t.is(
    await refFinance.view('get_deposit', {account_id: root, token_id: wNEAR}),
    NEAR.parse('100 N').toJSON(),
  );
  t.is(
    await refFinance.view('get_pool_total_shares', {pool_id}),
    INIT_SHARES_SUPPLY,
  );

  // Get price from pool :0 1 -> 2 tokens.
  const expectedOut: string = await refFinance.view('get_return', {
    pool_id,
    token_in: ft,
    amount_in: NEAR.parse('1 N'),
    token_out: wNEAR,
  });
  t.is(expectedOut, '1662497915624478906119726');
  const amountOut: string = await root.call(refFinance, 'swap', {
    actions: [{
      pool_id,
      token_in: ft,
      amount_in: NEAR.parse('1 N'),
      token_out: wNEAR,
      min_amount_out: '1',
    }],
  }, {
    attachedDeposit: '1',
  });
  t.is(amountOut, expectedOut);
  t.is(
    await refFinance.view('get_deposit', {account_id: root, token_id: ft}),
    NEAR.parse('99 N').toJSON(),
  );
});

// Contract: https://github.com/near/core-contracts/blob/master/w-near
async function createWNEAR(
  creator: NearAccount,
  blockId = DEFAULT_BLOCK_HEIGHT,
): Promise<NearAccount> {
  const wNEAR = await creator.importContract({
    mainnetContract: 'wrap.near',
    blockId,
  });
  await creator.call(wNEAR, 'new', {
    owner_id: creator,
    total_supply: NEAR.parse('1,000,000,000 N'),
  });
  await creator.call(wNEAR, 'storage_deposit', {}, {
    attachedDeposit: NEAR.parse('0.008 N'),
  });
  await creator.call(wNEAR, 'near_deposit', {}, {
    attachedDeposit: NEAR.parse('200 N'),
  });
  return wNEAR;
}

// Contract: https://github.com/ref-finance/ref-contracts/
async function createRef(
  creator: NearAccount,
  blockId = DEFAULT_BLOCK_HEIGHT,
): Promise<NearAccount> {
  const refFinance = await creator.importContract({
    mainnetContract: REF_FINANCE_ACCOUNT,
    blockId,
    initialBalance: NEAR.parse('1000 N').toJSON(),
  });
  await creator.call(
    refFinance,
    'new',
    {
      owner_id: creator,
      exchange_fee: 4,
      referral_fee: 1,
    },
  );
  await creator.call(refFinance, 'storage_deposit', {}, {
    attachedDeposit: NEAR.parse('30 mN'),
  });
  return refFinance;
}

  type AccountID = string;

async function createPoolWithLiquidity(
  root: NearAccount,
  refFinance: NearAccount,
  tokenAmounts: Record<AccountID, string>,
): Promise<string> {
  const tokens = Object.keys(tokenAmounts);
  await root.call(refFinance, 'extend_whitelisted_tokens', {tokens});
  const pool_id: string = await root.call(refFinance, 'add_simple_pool', {tokens, fee: 25}, {
    attachedDeposit: NEAR.parse('3mN'),
  });
  await root.call(refFinance, 'register_tokens', {token_ids: tokens}, {
    attachedDeposit: '1',
  });
  await depositTokens(root, refFinance, tokenAmounts);
  await root.call(refFinance, 'add_liquidity', {
    pool_id,
    amounts: Object.values(tokenAmounts),
  }, {
    attachedDeposit: NEAR.parse('1N'),
  });
  return pool_id;
}

async function depositTokens(
  root: NearAccount,
  refFinance: NearAccount,
  tokenAmounts: Record<AccountID, string>,
): Promise<void> {
  await Promise.all(Object.entries(tokenAmounts).map(async ([accountId, amount]) => {
    await refFinance.call(accountId, 'storage_deposit', {registration_only: true}, {
      attachedDeposit: NEAR.parse('1N'),
    });
    await root.call(accountId, 'ft_transfer_call', {
      receiver_id: refFinance,
      amount,
      msg: '',
    }, {
      attachedDeposit: '1',
      gas: Gas.parse('200Tgas'),
    });
  }));
}

