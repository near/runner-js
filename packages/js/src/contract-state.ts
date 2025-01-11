import {Buffer} from 'buffer';
import {Schema, deserialize} from 'borsh';

export class ContractState {
  private readonly data: Map<string, Buffer>;
  constructor(dataArray: Array<{key: Buffer; value: Buffer}>) {
    this.data = new Map();
    for (const {key, value} of dataArray) {
      this.data.set(key.toString(), value);
    }
  }

  getRaw(key: string): Buffer {
    return this.data.get(key) ?? Buffer.from('');
  }

  get(key: string, borshSchema: Schema): any {
    const value = this.getRaw(key);
    if (borshSchema) {
      return deserialize(borshSchema, Uint8Array.from(value));
    }

    return value.toJSON();
  }
}

