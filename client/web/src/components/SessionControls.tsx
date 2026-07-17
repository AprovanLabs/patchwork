/**
 * Top-bar session area for patchwork.
 *
 * Wraps the shared `@aprovan/ui/shell` SessionArea — workspace switcher +
 * profile menu (identity, credentials link, sign out) when signed in, a
 * sign-in button when signed out — wired to the app auth client and the
 * gateway session. Keeps the `onLoad`/`onSwitch` contract `ChatPage` uses to
 * reset workspace-scoped state.
 */

import { useAuth } from "@aprovan/ui/auth";
import { useGatewaySession } from "@aprovan/ui/gateway";
import { SessionArea, type SessionAreaStatus } from "@aprovan/ui/shell";
import { useEffect, useRef, useState } from "react";
import { gateway } from "../lib/gateway";
import { credentialsUrl } from "../lib/registry";

interface SessionControlsProps {
  /** Called once with the server's active workspace id (null if unknown). */
  onLoad?: (activeWorkspaceId: string | null) => void;
  /** Called after a workspace switch is confirmed by the gateway. */
  onSwitch: (workspaceId: string) => void;
}

export default function SessionControls({ onLoad, onSwitch }: SessionControlsProps) {
  const auth = useAuth();
  const session = useGatewaySession(gateway, auth.status === "authenticated");
  const [switching, setSwitching] = useState(false);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    if (session.status === "loading" || session.status === "idle") return;
    loadedRef.current = true;
    onLoadRef.current?.(session.workspaceId);
  }, [session.status, session.workspaceId]);

  async function handleSelect(workspaceId: string) {
    if (workspaceId === session.workspaceId || switching) return;
    setSwitching(true);
    try {
      await session.select(workspaceId);
      onSwitch(workspaceId);
    } catch {
      // the current workspace stays active
    } finally {
      setSwitching(false);
    }
  }

  const status: SessionAreaStatus =
    auth.status === "unconfigured"
      ? "unconfigured"
      : auth.status === "loading"
        ? "loading"
        : auth.status === "unauthenticated"
          ? "signed-out"
          : session.status === "loading" || session.status === "idle"
            ? "loading"
            : "ready";

  return (
    <SessionArea
      status={status}
      user={auth.user ? { email: auth.user.email } : null}
      workspaces={session.workspaces}
      activeWorkspaceId={session.workspaceId}
      onSelectWorkspace={(id) => void handleSelect(id)}
      switching={switching}
      onSignIn={() =>
        void auth.signIn(`${window.location.pathname}${window.location.search}`)
      }
      onSignOut={() => void auth.signOut()}
      links={[{ label: "Credentials", href: credentialsUrl() }]}
    />
  );
}
