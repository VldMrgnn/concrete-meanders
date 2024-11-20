export type TEndpointDef = { url: string | URL | Request; opts?: RequestInit };

export interface ITenantState<T extends string = string | "main"> {
  idbBaseName: string;
  tenantKey: T;
  tenantKeys: T[];
  uploadEndpoint?: TEndpointDef;
  downloadEndpoint?: TEndpointDef;
  controlEndpoint?: TEndpointDef;
  backenWaitList?: T[];
  fn?: void;
}
export interface IBackFile {
  file: string;
  timestamp: number;
}

export interface TBackStore extends IBackFile {
  isNextToLoad: boolean;
}
