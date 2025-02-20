declare module 'node-port-check' {
  interface NodePortCheck {
    nextAvailable: (from: number, ipAddr: string) => Promise<number>;
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const NodePortCheck: NodePortCheck;

  export = NodePortCheck;
}
