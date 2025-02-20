import {Buffer} from 'buffer';
import {Gas} from 'near-units';
import {
  type Action,
  type ClientConfig,
  type ExecutionError,
  type ExecutionOutcome,
  type ExecutionOutcomeWithId,
  type ExecutionStatus,
  type ExecutionStatusBasic,
  type FinalExecutionOutcome,
  type FinalExecutionStatus,
  type FinalExecutionStatusBasic,
  type PublicKey,
} from './types';

function includes(pattern: string | RegExp): (s: string) => boolean {
  if (typeof pattern === 'string') {
    return s => s.includes(pattern);
  }

  return s => pattern.test(s);
}

function parseValue<T>(value: string): T | string {
  const buffer = Buffer.from(value, 'base64').toString();
  try {
    return JSON.parse(buffer) as T;
  } catch {
    return buffer;
  }
}

export class ReceiptOutcome {
  constructor(public outcome: ExecutionOutcome) {}

  get failures(): Array<Record<string, unknown>> {
    return [];
  }

  get status(): ExecutionStatus | ExecutionStatusBasic {
    return this.outcome.status;
  }

  get succeeded(): boolean {
    if (typeof this.status === 'string') {
      return false;
    }

    return this.status.SuccessValue !== undefined;
  }

  get isFailure(): boolean {
    if (typeof this.status === 'string') {
      return false;
    }

    return this.status.Failure !== undefined;
  }

  get executionStatus(): ExecutionStatus {
    return this.status as ExecutionStatus;
  }

  parseResult(): any {
    if (this.succeeded) {
      return parseValue(this.SuccessValue!);
    }

    throw new Error(JSON.stringify(this.status));
  }

  get SuccessValue(): string | undefined {
    if (this.succeeded) {
      return this.executionStatus.SuccessValue!;
    }

    return undefined;
  }

  get executionFailure(): ExecutionError | undefined {
    if (this.isFailure) {
      return this.executionStatus.Failure!;
    }

    return undefined;
  }

  get failureMessage(): string | undefined {
    return this.executionFailure?.error_message;
  }

  get failureType(): string | undefined {
    return this.executionFailure?.error_type;
  }

  get logs(): string[] {
    return this.outcome.logs;
  }

  get gas_burnt(): Gas {
    return Gas.from(this.outcome.gas_burnt);
  }
}

export class TransactionResult {
  constructor(
    public readonly result: FinalExecutionOutcome,
    public readonly startMs: number,
    public readonly endMs: number,
    private readonly config: ClientConfig,
  ) {}

  get durationMs(): number {
    return this.endMs - this.startMs;
  }

  get outcomesWithId(): ExecutionOutcomeWithId[] {
    const {result} = this;
    return [result.transaction_outcome, ...result.receipts_outcome];
  }

  get receipts_outcomes(): ReceiptOutcome[] {
    return this.result.receipts_outcome.flatMap(
      o => new ReceiptOutcome(o.outcome),
    );
  }

  get outcome(): ExecutionOutcome {
    return this.result.transaction_outcome.outcome;
  }

  get outcomes(): ExecutionOutcome[] {
    return this.outcomesWithId.flatMap(o => o.outcome);
  }

  get logs(): string[] {
    return this.outcomes.flatMap(it => it.logs);
  }

  get transactionReceipt(): TransactionReceipt {
    return this.result.transaction as TransactionReceipt;
  }

  get failures(): ExecutionError[] {
    const failures = [...this.receiptFailures];

    if (this.Failure) {
      failures.unshift(this.Failure);
    }

    return failures;
  }

  get status(): FinalExecutionStatus | FinalExecutionStatusBasic {
    return this.result.status;
  }

  get succeeded(): boolean {
    if (typeof this.result.status === 'string') {
      return false;
    }

    return this.result.status.SuccessValue !== undefined;
  }

  get SuccessValue(): string | null {
    if (this.succeeded) {
      return this.finalExecutionStatus.SuccessValue!;
    }

    return null;
  }

  get failed(): boolean {
    if (typeof this.result.status === 'string') {
      return false;
    }

    return this.result.status.Failure !== undefined;
  }

  get Failure(): ExecutionError | null {
    if (this.failed) {
      return this.finalExecutionStatus.Failure!;
    }

    return null;
  }

  logsContain(pattern: string | RegExp): boolean {
    return this.logs.some(includes(pattern));
  }

  findLogs(pattern: string | RegExp): string[] {
    return this.logs.filter(includes(pattern));
  }

  receiptSuccessValuesContain(pattern: string | RegExp): boolean {
    return this.receiptSuccessValues.some(includes(pattern));
  }

  findReceiptSuccessValues(pattern: string | RegExp): string[] {
    return this.receiptSuccessValues.filter(includes(pattern));
  }

  get finalExecutionStatus(): FinalExecutionStatus {
    return this.status as FinalExecutionStatus;
  }

  get receiptFailures(): ExecutionError[] {
    return this.receipts_outcomes.flatMap(o => o.executionFailure ?? []);
  }

  get receiptSuccessValues(): string[] {
    return this.receipts_outcomes.flatMap(o => o.SuccessValue ?? []);
  }

  get receiptFailureMessages(): string[] {
    return this.receiptFailures.map(failure => JSON.stringify(failure));
  }

  get gas_burnt(): Gas {
    const receiptsGas = this.receipts_outcomes.reduce((accamulator, current) => accamulator + current.outcome.gas_burnt, 0);
    return Gas.from(this.result.transaction_outcome.outcome.gas_burnt + receiptsGas);
  }

  receiptFailureMessagesContain(pattern: string | RegExp): boolean {
    return this.receiptFailureMessages.some(includes(pattern));
  }

  parseResult<T>(): T {
    if (this.succeeded) {
      return parseValue<T>(this.SuccessValue!) as T;
    }

    throw new Error(JSON.stringify(this.status));
  }

  parsedReceiptResults(): any[] {
    return this.receiptSuccessValues.map(parseValue);
  }

  summary(): string {
    return `(${this.durationMs} ms) burned ${this.gas_burnt.toHuman()} ${transactionReceiptToString(this.transactionReceipt, this.config.explorerUrl)}`;
  }
}

export interface TransactionReceipt {
  actions: Action[];
  hash: string;
  nonce: number;
  public_key: PublicKey;
  receiver_id: string;
  signature: string;
  signer_id: string;
}

function transactionReceiptToString(tx: TransactionReceipt, explorerUrl?: string): string {
  return `${tx.signer_id} -> ${tx.receiver_id} Nonce: ${tx.nonce} Hash: ${explorerUrl ? explorerUrl + '/' : ''}${tx.hash} Actions:\n${tx.actions.map(a => JSON.stringify(a)).join('\n')}`;
}

export class TransactionError extends Error {
  constructor(result: TransactionResult) {
    super(JSON.stringify(result));
  }

  parse(): ExecutionOutcome {
    return JSON.parse(this.message) as ExecutionOutcome;
  }
}

export type TxResult = TransactionResult;
