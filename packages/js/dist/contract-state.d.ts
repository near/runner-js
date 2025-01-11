/// <reference types="node" />
import { Buffer } from 'buffer';
import { Schema } from 'borsh';
export declare class ContractState {
    private readonly data;
    constructor(dataArray: Array<{
        key: Buffer;
        value: Buffer;
    }>);
    getRaw(key: string): Buffer;
    get(key: string, borshSchema: Schema): any;
}
//# sourceMappingURL=contract-state.d.ts.map