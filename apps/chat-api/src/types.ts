import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

export interface WorkspaceLimits {
  dailyChatCap: number;
  maxModels: string[];
  maxToolSteps: number;
  maxTokensPerRequest: number;
}

export interface WorkspaceFeatures {
  advancedTools: boolean;
  customPrompts: boolean;
}

export interface WorkspaceItem {
  workspaceId: string;
  name: string;
  plan: string;
  limits: WorkspaceLimits;
  features: WorkspaceFeatures;
  createdAt: string;
  updatedAt: string;
}

export type AppVariables = {
  claims: CognitoAccessTokenPayload;
  workspaceId: string;
  workspace: WorkspaceItem;
};
