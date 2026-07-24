/**
 * Sign-in gate for patchwork.
 *
 * Renders children once authenticated. When Cognito is not configured (offline /
 * `APROVAN_ENV=off`) it renders children as-is so the app still loads. Otherwise
 * it shows a Cognito sign-in card until the user completes the PKCE flow.
 */

import { useAuth } from "@aprovan/ui/auth";
import { LogIn, Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

/**
 * A private published app (aprovan.com/apps/…) bounces here to sign in, since
 * chat shares this origin + Cognito callback and writes the token key the app
 * shell reads. `?authReturn=<same-origin path>` is where to land afterwards.
 * Guarded to same-origin absolute paths so it can't be an open redirect.
 */
function readAuthReturn(): string | null {
  const raw = new URLSearchParams(window.location.search).get("authReturn");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { status, signIn } = useAuth();

  // When an app sent us here to authenticate, complete the round-trip: sign in
  // if needed, then hand control back to the app rather than showing chat.
  useEffect(() => {
    const authReturn = readAuthReturn();
    if (!authReturn) return;
    if (status === "authenticated") window.location.replace(authReturn);
    else if (status === "unauthenticated") void signIn(authReturn);
  }, [status, signIn]);

  // Mid-redirect to a returning app: don't flash chat's UI underneath.
  if (readAuthReturn() && status !== "unconfigured") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Unconfigured → run unauthenticated. Authenticated → render the app.
  if (status === "unconfigured" || status === "authenticated") {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-3">
          <p className="mt-8 text-sm text-muted-foreground">
            Sign in with your Aprovan account to connect to the gateway.
          </p>
          <Button
            onClick={() =>
              void signIn(`${window.location.pathname}${window.location.search}`)
            }
          >
            <LogIn className="mr-2 size-4" />
            Sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
