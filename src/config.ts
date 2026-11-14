export interface ServerConfig {
  port: number;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  demoAuthorityToken: string | undefined;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const port = Number(environment.PORT ?? 3_000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const supabaseUrl = environment.SUPABASE_URL?.trim() || undefined;
  const supabaseServiceRoleKey =
    environment.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
  const demoAuthorityToken =
    environment.CRISISGRID_DEMO_AUTHORITY_TOKEN?.trim() || undefined;

  if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together.",
    );
  }

  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      if (url.protocol !== "https:" && url.hostname !== "localhost") {
        throw new Error("SUPABASE_URL must use HTTPS outside localhost.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("HTTPS")) throw error;
      throw new Error("SUPABASE_URL must be a valid absolute URL.");
    }
  }

  if (demoAuthorityToken && demoAuthorityToken.length < 24) {
    throw new Error(
      "CRISISGRID_DEMO_AUTHORITY_TOKEN must contain at least 24 characters.",
    );
  }

  return { port, supabaseUrl, supabaseServiceRoleKey, demoAuthorityToken };
}
