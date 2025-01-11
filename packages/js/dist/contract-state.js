"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractState = void 0;
const buffer_1 = require("buffer");
const borsh_1 = require("borsh");
class ContractState {
    constructor(dataArray) {
        this.data = new Map();
        for (const { key, value } of dataArray) {
            this.data.set(key.toString(), value);
        }
    }
    getRaw(key) {
        var _a;
        return (_a = this.data.get(key)) !== null && _a !== void 0 ? _a : buffer_1.Buffer.from('');
    }
    get(key, borshSchema) {
        const value = this.getRaw(key);
        if (borshSchema) {
            return (0, borsh_1.deserialize)(borshSchema, Uint8Array.from(value));
        }
        return value.toJSON();
    }
}
exports.ContractState = ContractState;
//# sourceMappingURL=contract-state.js.map