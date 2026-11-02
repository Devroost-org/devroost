import { publishedImageDocument, type PublishedImageName } from "./published-image-data.js";

export interface PublishedImageRecord {
  name: string;
  image: string;
  digest: string;
}

export interface PublishedImageDocument {
  schemaVersion: number;
  registry: string;
  images: readonly PublishedImageRecord[];
}

const publishedRegistry = "ghcr.io/devroost-org";
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function createPublishedImageResolver(document: unknown): (name: string) => string {
  if (!document || typeof document !== "object") throw new Error("Published image document must be an object");
  const candidate = document as Partial<PublishedImageDocument>;
  if (candidate.schemaVersion !== 1) throw new Error("Published image schemaVersion must be 1");
  if (candidate.registry !== publishedRegistry) {
    throw new Error(`Published image registry must be ${publishedRegistry}`);
  }
  if (!Array.isArray(candidate.images)) throw new Error("Published image document images must be an array");

  const references = new Map<string, string>();
  for (const record of candidate.images) {
    if (!record || typeof record !== "object" || typeof record.name !== "string" || !record.name) {
      throw new Error("Published image record name is required");
    }
    if (references.has(record.name)) throw new Error(`Duplicate published image ${record.name}`);
    const expectedImage = `${publishedRegistry}/${record.name}`;
    if (record.image !== expectedImage) {
      throw new Error(`Published image ${record.name} repository must be ${expectedImage}`);
    }
    if (!digestPattern.test(record.digest ?? "")) {
      throw new Error(`Published image ${record.name} digest must be a lowercase sha256 value`);
    }
    references.set(record.name, `${record.image}@${record.digest}`);
  }

  return (name: string): string => {
    const reference = references.get(name);
    if (!reference) throw new Error(`Unknown published image ${name}`);
    return reference;
  };
}

const resolvePublishedImage = createPublishedImageResolver(publishedImageDocument);

export function publishedImage(name: PublishedImageName): string {
  return resolvePublishedImage(name);
}
