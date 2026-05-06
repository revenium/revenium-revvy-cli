export interface Subscriber {
  idExpression: string;
  emailExpression?: string;
}

export interface Organization {
  name?: string;
  customerIdExpression: string;
  source: "auth-context" | "api-key" | "custom";
}

export interface Product {
  name: string;
  description?: string;
}

export interface Agent {
  name: string;
  productRef?: string;
  taskTypes?: string[];
}

export interface TaskTypeDefinition {
  name: string;
  description?: string;
}

export interface MeteringDesign {
  version: "1.0";
  trackingGoal: "billing" | "internal-allocation" | "both";
  organization: Organization;
  subscriber?: Subscriber;
  products: Product[];
  agents: Agent[];
  taskTypes: TaskTypeDefinition[];
  outcomeTracking: boolean;
  centralizedCallPattern?: {
    detected: boolean;
    filePath?: string;
    description?: string;
  };
  callSiteCount: number;
  detectedProviders: string[];
  detectedLanguage: "node" | "python" | "go";
}
