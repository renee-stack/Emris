import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let target = path.join(root, specifier.slice(2));
    if (!target.endsWith(".ts") && !target.endsWith(".tsx") && !target.endsWith(".js")) {
      target = `${target}.ts`;
    }
    return nextResolve(pathToFileURL(target).href, context);
  }
  if (specifier.endsWith(".ts") || !specifier.startsWith(".")) {
    return nextResolve(specifier, context);
  }
  // Relative imports without extension → .ts for Node strip-types.
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
