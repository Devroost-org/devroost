import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { constants } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { DevroostConfig } from "./types.js";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SAFE_HOST_PATTERN = /^(?:\*\.)?(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;

export interface LoadedDevroostProject {
  config: DevroostConfig;
  configPath: string;
  projectRoot: string;
}

const serviceSchema = z.object({
  type: z.string().min(1),
  image: z.string().min(1),
  composer: z.boolean().optional(),
  user: z.string().min(1).optional(),
  userns: z.enum(["keep-id"]).optional(),
  execUser: z.string().min(1).optional(),
  entrypoint: z.string().optional(),
  command: z.string().optional(),
  workdir: z.string().optional(),
  ports: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  healthcheck: z
    .object({
      command: z.string(),
      intervalSeconds: z.number().int().positive().optional(),
      timeoutSeconds: z.number().int().positive().optional(),
      retries: z.number().int().positive().optional(),
      startPeriodSeconds: z.number().int().nonnegative().optional()
    })
    .optional()
});

const configSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().regex(SAFE_IDENTIFIER_PATTERN, {
    message: "Project name must start with an alphanumeric character and contain only letters, digits, dot, underscore, or dash."
  }),
  runtime: z.object({
    engine: z.literal("podman"),
    rootless: z.boolean().default(true),
    machine: z
      .object({
        managed: z.boolean().default(true)
      })
      .optional()
  }),
  services: z.record(
    z.string().regex(SAFE_IDENTIFIER_PATTERN, {
      message: "Service names must start with an alphanumeric character and contain only letters, digits, dot, underscore, or dash."
    }),
    serviceSchema
  ),
  routes: z
    .array(
      z.object({
        host: z.string().regex(SAFE_HOST_PATTERN, {
          message: "Route host must be a valid hostname and may start with '*.'."
        }),
        service: z.string(),
        port: z.number().int().positive(),
        https: z.boolean().optional()
      })
    )
    .optional(),
  tasks: z
    .record(
      z.object({
        service: z.string(),
        command: z.string()
      })
    )
    .optional()
});

async function findConfigPath(configPath: string): Promise<string> {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  let currentDir = process.cwd();

  while (true) {
    const candidate = resolve(currentDir, configPath);

    try {
      await access(candidate, constants.F_OK);
      return candidate;
    } catch {
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        throw new Error(`Unable to find '${configPath}' from ${process.cwd()} or any parent directory.`);
      }

      currentDir = parentDir;
    }
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function loadProjectEnv(projectRoot: string): Promise<Record<string, string>> {
  const envPath = resolve(projectRoot, ".env");

  try {
    const raw = await readFile(envPath, "utf-8");
    return {
      ...parseDotEnv(raw),
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    };
  } catch {
    return Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  }
}

function interpolateString(value: string, env: Record<string, string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, key: string, defaultValue?: string) => {
    const resolved = env[key];
    if (resolved !== undefined) {
      return resolved;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Missing required environment variable '${key}' while loading Devroost config.`);
  });
}

function interpolateConfigValue(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === "string") {
    return interpolateString(value, env);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateConfigValue(entry, env));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, interpolateConfigValue(entry, env)])
    );
  }

  return value;
}

export async function loadDevroostProject(configPath = "devroost.yaml"): Promise<LoadedDevroostProject> {
  const absolutePath = await findConfigPath(configPath);
  const raw = await readFile(absolutePath, "utf-8");
  const projectRoot = dirname(absolutePath);
  const env = await loadProjectEnv(projectRoot);
  const parsed = interpolateConfigValue(parse(raw), env);
  return {
    config: configSchema.parse(parsed) as DevroostConfig,
    configPath: absolutePath,
    projectRoot
  };
}

export async function loadDevroostConfig(configPath = "devroost.yaml"): Promise<DevroostConfig> {
  const loaded = await loadDevroostProject(configPath);
  return loaded.config;
}

export type { DevroostConfig, DevroostRoute, DevroostService, DevroostTask } from "./types.js";
