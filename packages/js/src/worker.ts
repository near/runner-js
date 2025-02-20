import fs from 'fs';
import {NEAR} from 'near-units';
import {lock} from 'proper-lockfile';
import {getNetworkFromEnv, urlConfigFromNetwork} from './utils';
import {type Config, type ClientConfig} from './types';
import {AccountManager, type NearAccount, type NearAccountManager} from './account';
import {JsonRpcProvider} from './jsonrpc';
import {debug} from './internal-utils';
import {SandboxServer} from './server/server';

const API_KEY_HEADER = 'x-api-key';

/**
 * The main interface to near-workspaces. Create a new worker instance with {@link Worker.init}, then run code on it.
 */
export abstract class Worker {
  /**
   * Initialize a new worker.
   *
   * In local sandbox mode, this will:
   *   - Create a new local blockchain
   *   - Load the root account for that blockchain, available as `root`:
   *
   * In testnet mode, the same functionality is achieved via different means:
   * creating a new account as the `root`.
   * Since all actions must occur on one blockchain instead of N.
   *
   * @param config a configuration object
   * @returns an instance of the Worker class
   */
  static async init(config: Partial<Config> = {}): Promise<Worker> {
    debug('Lifecycle.Worker.init()', 'config:', config);
    switch (config.network ?? getNetworkFromEnv()) {
      case 'testnet': {
        return TestnetWorker.init(config);
      }

      case 'sandbox': {
        return SandboxWorker.init(config);
      }

      case 'custom': {
        return CustomnetWorker.init(config);
      }

      default: {
        throw new Error(
          `config.network = '${config.network}' invalid; `
            + 'must be \'testnet\', \'sandbox\' or \'custom\' (the default). Soon \'mainnet\'',
        );
      }
    }
  }

  protected config: Config;

  protected manager!: NearAccountManager;

  constructor(config: Config) {
    debug('Lifecycle.Worker.constructor', 'config:', config);
    this.config = config;
    this.manager = AccountManager.create(config);
  }

  get rootAccount(): NearAccount {
    return this.manager.root;
  }

  abstract get provider(): JsonRpcProvider;

  abstract tearDown(): Promise<void>;
}

// Connect to a custom network.
// Note: the burden of ensuring the methods that are able to be called are left up to the user.
export class CustomnetWorker extends Worker {
  static async init(config: Partial<Config>): Promise<CustomnetWorker> {
    debug('Lifecycle.CustomnetWorker.create()', 'config:', config);
    const fullConfig = {
      homeDir: 'ignored',
      port: 3030,
      rm: false,
      refDir: null,
      ...urlConfigFromNetwork({network: 'custom', rpcAddr: config.rpcAddr}), // Copied over, can't access member clientConfig here
      ...config,
    };

    const worker = new CustomnetWorker(fullConfig);
    if (config.apiKey) {
      worker.provider.connection.headers = {
        ...worker.provider.connection.headers, [API_KEY_HEADER]: config.apiKey,
      };
    }

    await worker.manager.init();
    return worker;
  }

  private readonly clientConfig: ClientConfig = urlConfigFromNetwork({network: 'custom', rpcAddr: this.config.rpcAddr});

  get provider(): JsonRpcProvider {
    return JsonRpcProvider.from(this.clientConfig);
  }

  async tearDown(): Promise<void> {
    // We are not stopping any server here because it is an external network.
  }

  get defaultConfig(): Config {
    return {
      homeDir: 'ignored',
      port: 3030,
      rm: false,
      refDir: null,
      ...this.clientConfig,
    };
  }
}

export class TestnetWorker extends Worker {
  static async init(config: Partial<Config>): Promise<TestnetWorker> {
    debug('Lifecycle.TestnetWorker.create()', 'config:', config);
    const fullConfig = {...this.defaultConfig, ...config};

    const worker = new TestnetWorker(fullConfig);
    if (config.apiKey) {
      worker.provider.connection.headers = {
        ...worker.provider.connection.headers, [API_KEY_HEADER]: config.apiKey,
      };
    }

    await worker.manager.init();
    return worker;
  }

  get provider(): JsonRpcProvider {
    return JsonRpcProvider.from(TestnetWorker.clientConfig);
  }

  async tearDown(): Promise<void> {
    // We are not stoping any server here because we are using Testnet
  }

  static get defaultConfig(): Config {
    return {
      homeDir: 'ignored',
      port: 3030,
      rm: false,
      refDir: null,
      ...this.clientConfig,
    };
  }

  private static get clientConfig(): ClientConfig {
    return urlConfigFromNetwork('testnet');
  }
}

export class SandboxWorker extends Worker {
  static async init(config: Partial<Config>): Promise<SandboxWorker> {
    debug('Lifecycle.SandboxWorker.create()', 'config:', config);
    const syncFilename = SandboxServer.lockfilePath('near-sandbox-worker-sync.txt');
    try {
      fs.accessSync(syncFilename, fs.constants.F_OK);
    } catch {
      debug('catch err in access file:', syncFilename);
      fs.writeFileSync(syncFilename, 'workspace-js test port sync');
    }

    const retryOptions = {
      retries: {
        retries: 100,
        factor: 3,
        minTimeout: 200,
        maxTimeout: 2 * 1000,
        randomize: true,
      },
    };

    // Add file lock in assign port and run near node process
    const release = await lock(syncFilename, retryOptions);
    const defaultConfig = await this.defaultConfig();
    const worker = new SandboxWorker({...defaultConfig, ...config});
    if (config.apiKey) {
      worker.provider.connection.headers = {
        ...worker.provider.connection.headers, [API_KEY_HEADER]: config.apiKey,
      };
    }

    worker.server = await SandboxServer.init(worker.config);
    await worker.server.start();
    // Release file lock after near node start
    await release();
    await worker.manager.init();
    return worker;
  }

  static async defaultConfig(): Promise<Config> {
    const port = await SandboxServer.nextPort();
    return {
      ...this.clientConfig,
      homeDir: SandboxServer.randomHomeDir(),
      port,
      rm: false,
      refDir: null,
      rpcAddr: `http://127.0.0.1:${port}`,
    };
  }

  private server!: SandboxServer;

  get provider(): JsonRpcProvider {
    return JsonRpcProvider.from(this.rpcAddr);
  }

  async tearDown(): Promise<void> {
    try {
      await this.server.close();
    } catch (error: unknown) {
      debug('this.server.close() threw error.', JSON.stringify(error, null, 2));
    }
  }

  private static get clientConfig(): ClientConfig {
    return {
      network: 'sandbox',
      rootAccountId: 'test.near',
      rpcAddr: '', // Will be over written
      initialBalance: NEAR.parse('100 N').toJSON(),
    };
  }

  private get rpcAddr(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }
}
