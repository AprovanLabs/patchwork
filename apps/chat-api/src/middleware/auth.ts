import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../types";

interface JwtVerifier {
  verify(token: string): Promise<CognitoAccessTokenPayload>;
}

let verifier: JwtVerifier | null = null;

function getVerifier(): JwtVerifier {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env["COGNITO_USER_POOL_ID"]!,
      clientId: process.env["COGNITO_CLIENT_ID"]!,
      tokenUse: "access",
    });
  }
  return verifier;
}

export const authMiddleware: MiddlewareHandler<{ Variables: AppVariables }> =
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    try {
      const payload = await getVerifier().verify(token);
      c.set("claims", payload);
      return next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };
