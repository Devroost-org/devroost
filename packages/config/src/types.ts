export type DevroostServiceType = "node" | "php" | "python" | "postgres" | "redis" | string;

export interface DevroostService {
  type: DevroostServiceType;
  image: string;
  composer?: boolean;
  user?: string;
  userns?: "keep-id";
  execUser?: string;
  entrypoint?: string;
  command?: string;
  workdir?: string;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  dependsOn?: string[];
  healthcheck?: {
    command: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
    retries?: number;
    startPeriodSeconds?: number;
  };
}

export interface DevroostRoute {
  host: string;
  service: string;
  port: number;
  https?: boolean;
}

export interface DevroostTask {
  service: string;
  command: string;
}

export interface DevroostConfig {
  version: number;
  name: string;
  runtime: {
    engine: "podman";
    rootless: boolean;
    machine?: {
      managed: boolean;
    };
  };
  services: Record<string, DevroostService>;
  routes?: DevroostRoute[];
  tasks?: Record<string, DevroostTask>;
}
