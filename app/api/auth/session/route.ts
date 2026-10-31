import { privateJson } from "@/lib/lookup";
import { viewer } from "@/lib/auth/viewer";

/** Email for the signed-in UI. The user id stays on the server. */
export async function GET() {
  const user = await viewer();
  return privateJson({ email: user?.email ?? null });
}
