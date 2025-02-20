import {Buffer} from 'buffer';
import * as borsh from 'borsh';

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

  get(key: string, borshSchema?: {type: any; schema: any}): any {
    const value = this.getRaw(key);
    if (borshSchema) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return borsh.deserialize(borshSchema.schema, borshSchema.type, value);
    }

    return value.toJSON();
  }
}

