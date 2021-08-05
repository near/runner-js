import { strict as assert } from "assert";
import { createSandbox, SandboxRuntime, SandboxRunner } from "../../../src";
import * as borsh from "borsh";

jest.setTimeout(15000)

// sandbox creates sub-accounts of 'test.near'
const ALI = "ali.test.near";
const BOB = "bob.test.near";
const CONTRACT = "status-message.test.near";

let sandboxRunner: SandboxRunner

beforeAll(async () => {
  sandboxRunner = await createSandbox(async (sandbox: SandboxRuntime) => {
    await sandbox.createAndDeploy(
      CONTRACT,
      `${__dirname}/../build/debug/status_message.wasm`
    );
    await sandbox.createAccount(ALI);
    await sandbox.createAccount(BOB);
  })
})

test('Ali sets then gets status', async () => {
  await sandboxRunner(async (sandbox: SandboxRuntime) => {
    const ali = sandbox.getAccount(ALI);
    const contract = sandbox.getContractAccount(CONTRACT);
    await ali.call(CONTRACT, "set_status", { message: "hello" })
    const result = await contract.view("get_status", { account_id: ALI })
    assert.equal(result, "hello");
  })
});

test('Bob gets null status', async () => {
  await sandboxRunner(async (sandbox: SandboxRuntime) => {
    const contract = sandbox.getContractAccount(CONTRACT);
    const result = await contract.view("get_status", { account_id: BOB })
    assert.equal(result, null)
  })
});

test('Bob and Ali have different statuses', async () => {
  await sandboxRunner(async (sandbox: SandboxRuntime) => {
    const bob = sandbox.getAccount(BOB);
    const contract = sandbox.getContractAccount(CONTRACT);
    await bob.call(CONTRACT, "set_status", { message: "world" })
    const bobStatus = await contract.view(
      "get_status",
      { account_id: BOB }
    )
    assert.equal(bobStatus, "world");

    const aliStatus = await contract.view(
      "get_status",
      { account_id: ALI }
    )
    assert.equal(aliStatus, null)
  })
});



class Assignable {
  [key: string]:any;
  constructor(properties: any) {
    Object.keys(properties).map((key) => {
      this[key] = properties[key];
    });
  }
}

class StatusMessage extends Assignable {}

class Record extends Assignable {}

const schema = new Map([
  [StatusMessage, { kind: "struct", fields: [["records", [Record]]] }],
  [
    Record,
    {
      kind: "struct",
      fields: [
        ["k", "string"],
        ["v", "string"],
      ],
    },
  ],
]);

test('Ali sets then gets status and patches state', async () => {
  await sandboxRunner(async (sandbox: SandboxRuntime) => {
    const ali = sandbox.getAccount(ALI);
    const contract = sandbox.getContractAccount(CONTRACT);
    await ali.call(CONTRACT, "set_status", { message: "hello" })
    
    // Get state
    const state = await contract.viewState();
    // Get raw value
    let data = state.get_raw("STATE")//,{schema, type: StatusMessage});
    // deserialize from borsh
    const statusMessage: StatusMessage = borsh.deserialize(schema, StatusMessage, data);
    // update contract state
    statusMessage.records.push(new Record({k: "alice.near", v: "hello world"}));
    
    // serialize and patch state back to sandbox
    await contract.patchState("STATE", borsh.serialize(schema, statusMessage));
    
    // Check again that the update worked
    const result = await contract.view("get_status", { account_id: "alice.near" })
    expect(result).toBe("hello world");

    // Can also get value by passing the schema
    data = (await contract.viewState()).get("STATE", {schema, type: StatusMessage});
    expect(data).toStrictEqual(statusMessage);
    
  })
});