import process from 'process';
import anyTest, {type TestFn} from 'ava';
import {Worker, getNetworkFromEnv} from '../packages/js';

// To run this test, you need to set the NEAR_RPC_API_KEY environment variable tied the Pagoda testnet network.
// And the NEAR_WORKSPACES_NETWORK environment variable to 'custom'.
//
// Sample: NEAR_WORKSPACES_NETWORK=custom NEAR_RPC_API_KEY="xxx" pnpm test...
if (getNetworkFromEnv() === 'custom' && process.env.NEAR_RPC_API_KEY !== '') {
  const test = anyTest as TestFn<{
    worker: Worker;
  }>;

  test.before(async t => {
    const worker = await Worker.init({
      network: 'custom',
      rpcAddr: 'https://near-testnet.api.pagoda.co/rpc/v1/',
      apiKey: process.env.NEAR_RPC_API_KEY!,
    });
    t.context.worker = worker;
  });

  test.after.always(async t => {
    await t.context.worker.tearDown().catch((error: unknown) => {
      console.log('Failed to tear down the worker:', error);
    });
  });

  test('Ping network', async t => {
    try {
      await t.context.worker.provider.block({finality: 'final'});
    } catch (error: unknown) {
      t.fail(`Failed to ping the network: ${error as string}`);
      return;
    }

    t.pass('Network pinged successfully!');
  });
}

