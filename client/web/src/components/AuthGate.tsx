/**
 * Sign-in gate for patchwork.
 *
 * Renders children once authenticated. When Cognito is not configured (offline /
 * `APROVAN_ENV=off`) it renders children as-is so the app still loads. Otherwise
 * it shows a Cognito sign-in card until the user completes the PKCE flow.
 */

import { useAuth } from "@aprovan/ui/auth";
import { LogIn, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { status, signIn } = useAuth();

  // Unconfigured → run unauthenticated. Authenticated → render the app.
  if (status === "unconfigured" || status === "authenticated") {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Patchwork</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in with your Aprovan account to connect to the gateway.
          </p>
          <Button
            onClick={() =>
              void signIn(`${window.location.pathname}${window.location.search}`)
            }
          >
            <LogIn className="size-4" />
            Sign in with Cognito
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
