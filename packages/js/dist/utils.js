"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNEAR = exports.parseGas = exports.timeSuffix = exports.homeKeyStore = exports.getNetworkFromEnv = exports.EMPTY_CONTRACT_HASH = exports.hashContract = exports.urlConfigFromNetwork = exports.isTopLevelAccount = exports.captureError = exports.NO_DEPOSIT = exports.asId = exports.randomAccountId = exports.tGas = exports.createKeyPair = exports.toYocto = exports.ONE_NEAR = void 0;
const buffer_1 = require("buffer");
const process = __importStar(require("process"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const nearAPI = __importStar(require("near-api-js"));
const js_sha256_1 = __importDefault(require("js-sha256"));
const base_1 = require("@scure/base");
const near_units_1 = require("near-units");
exports.ONE_NEAR = near_units_1.NEAR.parse('1N');
function toYocto(amount) {
    return near_units_1.NEAR.parse(`${amount}N`).toString();
}
exports.toYocto = toYocto;
function createKeyPair() {
    return nearAPI.utils.KeyPairEd25519.fromRandom();
}
exports.createKeyPair = createKeyPair;
function tGas(x) {
    if (typeof x === 'string' && Number.isNaN(Number.parseInt(x, 10))) {
        throw new TypeError(`tGas expects a number or a number-like string; got: ${x}`);
    }
    return String(x) + '0'.repeat(12);
}
exports.tGas = tGas;
// Create random account with at least 33 digits by default
function randomAccountId(prefix = 'dev-', dateLength = 13, suffixLength = 15) {
    const suffix = Math.floor(Math.random() * (10 ** 22)) % (10 ** suffixLength);
    return `${timeSuffix(prefix, dateLength)}-${suffix}`;
}
exports.randomAccountId = randomAccountId;
function asId(id) {
    return typeof id === 'string' ? id : id.accountId;
}
exports.asId = asId;
exports.NO_DEPOSIT = near_units_1.NEAR.from(0);
async function captureError(fn) {
    try {
        await fn();
    }
    catch (error) {
        if (error instanceof Error) {
            return error.message;
        }
    }
    throw new Error('fn succeeded when expected to throw an exception');
}
exports.captureError = captureError;
function isTopLevelAccount(accountId) {
    return !accountId.includes('.');
}
exports.isTopLevelAccount = isTopLevelAccount;
function configFromDomain(network) {
    let rpcAddr = `https://archival-rpc.${network}.near.org`;
    if (network === 'mainnet' && process.env.NEAR_CLI_MAINNET_RPC_SERVER_URL) {
        rpcAddr = process.env.NEAR_CLI_MAINNET_RPC_SERVER_URL;
    }
    else if (network === 'testnet' && process.env.NEAR_CLI_TESTNET_RPC_SERVER_URL) {
        rpcAddr = process.env.NEAR_CLI_TESTNET_RPC_SERVER_URL;
    }
    return {
        network,
        rpcAddr,
        walletUrl: `https://wallet.${network}.near.org`,
        helperUrl: `https://helper.${network}.near.org`,
        explorerUrl: `https://explorer.${network}.near.org`,
        archivalUrl: `https://archival-rpc.${network}.near.org`,
    };
}
function urlConfigFromNetwork(network) {
    const networkName = typeof network === 'string' ? network : network.network;
    const rpcAddr = typeof network === 'string' ? undefined : network.rpcAddr;
    switch (networkName) {
        case 'sandbox':
            return {
                network: 'sandbox',
                rpcAddr: 'http://127.0.0.1',
            };
        case 'custom':
            return {
                network: 'custom',
                rpcAddr: rpcAddr,
            };
        case 'testnet':
        case 'mainnet': return configFromDomain(networkName);
        default:
            throw new Error(`Got network ${networkName}, but only accept 'sandbox', 'testnet', 'mainnet' and 'custom'`);
    }
}
exports.urlConfigFromNetwork = urlConfigFromNetwork;
/**
 *
 * @param contract Base64 encoded binary or Buffer.
 * @returns sha256 hash of contract.
 */
function hashContract(contract) {
    const bytes = typeof contract === 'string' ? buffer_1.Buffer.from(contract, 'base64') : contract;
    const buffer = buffer_1.Buffer.from(js_sha256_1.default.sha256(bytes), 'hex');
    return base_1.base58.encode(Uint8Array.from(buffer));
}
exports.hashContract = hashContract;
exports.EMPTY_CONTRACT_HASH = '11111111111111111111111111111111';
/**
 *
 * @returns network to connect to. Default 'sandbox'
 */
function getNetworkFromEnv() {
    const network = process.env.NEAR_WORKSPACES_NETWORK;
    switch (network) {
        case 'sandbox':
        case 'testnet':
        case 'custom':
            return network;
        case undefined:
            return 'sandbox';
        default:
            throw new Error(`environment variable NEAR_WORKSPACES_NETWORK=${network} invalid; `
                + 'use \'testnet\', \'custom\', or \'sandbox\' (the default)');
    }
}
exports.getNetworkFromEnv = getNetworkFromEnv;
function homeKeyStore() {
    return new nearAPI.keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), '.near-credentials'));
}
exports.homeKeyStore = homeKeyStore;
function timeSuffix(prefix, length = 6) {
    return `${prefix}${Date.now() % (10 ** length)}`;
}
exports.timeSuffix = timeSuffix;
const NOT_NUMBER_OR_UNDERLINE = /[^\d_]/;
function parseGas(s) {
    if (typeof s === 'string' && NOT_NUMBER_OR_UNDERLINE.test(s)) {
        return near_units_1.Gas.parse(s);
    }
    return near_units_1.Gas.from(s);
}
exports.parseGas = parseGas;
// One difference with `NEAR.parse` is that here strings of just numbers are considered `yN`
// And not `N`
function parseNEAR(s) {
    if (typeof s === 'string' && NOT_NUMBER_OR_UNDERLINE.test(s)) {
        return near_units_1.NEAR.parse(s);
    }
    return near_units_1.NEAR.from(s);
}
exports.parseNEAR = parseNEAR;
//# sourceMappingURL=utils.js.map