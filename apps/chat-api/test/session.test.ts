import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  GetCommand: vi.fn((input) => input),
  PutCommand: vi.fn((input) => input),
}));

const { getSessionWorkspaceId, setSessionWorkspaceId, resetSessionCache } =
  await import("../src/session");

describe("session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionCache();
    process.env["USER_SESSIONS_TABLE_NAME"] = "test-user-sessions";
    process.env["AWS_REGION"] = "us-east-1";
  });

  it("returns null when no session record exists", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const result = await getSessionWorkspaceId("user-abc");
    expect(result).toBeNull();
  });

  it("returns activeWorkspaceId from session record", async () => {
    mockSend.mockResolvedValueOnce({ Item: { userSub: "user-abc", activeWorkspaceId: "ws-xyz" } });
    const result = await getSessionWorkspaceId("user-abc");
    expect(result).toBe("ws-xyz");
  });

  it("caches the result and skips DDB on second call", async () => {
    mockSend.mockResolvedValueOnce({ Item: { activeWorkspaceId: "ws-cached" } });
    await getSessionWorkspaceId("user-cached");
    await getSessionWorkspaceId("user-cached");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("setSessionWorkspaceId writes to DDB and updates cache", async () => {
    mockSend.mockResolvedValueOnce({});
    await setSessionWorkspaceId("user-set", "ws-new");
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Second read should come from cache, not DDB
    const result = await getSessionWorkspaceId("user-set");
    expect(result).toBe("ws-new");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
