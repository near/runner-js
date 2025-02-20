import process from 'process';
import test from 'ava';
import {JsonRpcProvider} from '../src/jsonrpc';

test('check url', t => {
  const provider = JsonRpcProvider.fromNetwork('mainnet');

  const rpcUrl = process.env.NEAR_CLI_MAINNET_RPC_SERVER_URL;

  if (rpcUrl) {
    console.log('use rpc', rpcUrl);
    t.is(provider.connection.url, rpcUrl.toString());
  }
});
