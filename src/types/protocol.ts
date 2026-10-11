export type WorkerAction =
  | 'INIT'
  | 'LOAD_TABLE'
  | 'UNLOAD_TABLE'
  | 'EXECUTE_EXTRACTION'
  | 'CHECK_SYNTAX'
  | 'EXECUTE_DRY_RUN'
  | 'EXECUTE_FULL';

export interface ColumnProfile {
  name: string;
  rawType: string;
  semanticType?: string;
  nullCount: number;
  uniqueCount: number;
  sampleValues: (string | number | boolean | null)[];
}

export interface TableProfile {
  alias: string;
  fileName: string;
  totalRowCount: number;
  totalRowsSampled: number;
  columns: ColumnProfile[];
  rawRecordsHead: Record<string, any>[];
}

export interface ExecutionResult {
  outputRowCount: number;
  outputColCount: number;
  outputColumns?: { name: string; dtype: string }[];
  headPreview: Record<string, any>[];
  outputCsvBuffer?: Uint8Array;
}

export interface WorkerError {
  phase: 'INIT' | 'AST' | 'RUNTIME' | 'CONTRACT';
  message: string;
  traceback?: string;
  line?: number;
  failingRecord?: Record<string, any>;
}

export interface WorkerPayloads {
  INIT: {
    vendorBase: string;
  };
  LOAD_TABLE: {
    alias: string;
    fileName: string;
    buffer: ArrayBuffer;
    separator: string;
    sampleSize: number;
  };
  UNLOAD_TABLE: {
    alias: string;
  };
  EXECUTE_EXTRACTION: {
    extractionCode: string;
  };
  CHECK_SYNTAX: {
    code: string;
  };
  EXECUTE_DRY_RUN: {
    code: string;
  };
  EXECUTE_FULL: {
    code: string;
    outputSeparator: string;
  };
}

export interface WorkerMessage<T = any> {
  id: string;
  action: WorkerAction;
  payload: T;
}

export interface WorkerResponse<T = any> {
  id: string;
  success: boolean;
  data?: T;
  error?: WorkerError;
}
