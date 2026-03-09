const NOTIFY_API = "https://dashboard.alchemy.com/api";

export interface CreateWebhookParams {
  network: string;
  webhookUrl: string;
  graphqlQuery: string;
  name: string;
  signingKey?: string;
}

export interface CreateWebhookResponse {
  data?: { id: string; signingKey: string };
  error?: string;
}

/**
 * 通过 Alchemy Notify API 创建 Custom Webhook
 */
export async function createWebhook(
  authToken: string,
  params: CreateWebhookParams
): Promise<{ id: string; signingKey: string }> {
  const res = await fetch(`${NOTIFY_API}/create-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Alchemy-Token": authToken,
    },
    body: JSON.stringify({
      network: params.network,
      webhook_type: "GRAPHQL",
      webhook_url: params.webhookUrl,
      graphql_query: params.graphqlQuery,
      name: params.name,
      addresses: [], // Custom Webhook 的过滤在 graphql_query 中定义
    }),
  });

  const json = (await res.json()) as CreateWebhookResponse & { id?: string; signing_key?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  const id = json.data?.id ?? json.id;
  const signingKey = json.data?.signingKey ?? json.signing_key;
  if (!id) {
    throw new Error("Create webhook response missing id");
  }
  return { id, signingKey: signingKey ?? "" };
}

export interface WebhookInfo {
  id: string;
  network: string;
  webhook_url: string;
  is_active: boolean;
  signing_key?: string;
}

/**
 * 获取当前 App 下的所有 Webhook
 */
export async function listWebhooks(authToken: string): Promise<WebhookInfo[]> {
  const res = await fetch(`${NOTIFY_API}/webhooks`, {
    headers: { "X-Alchemy-Token": authToken },
  });
  if (!res.ok) {
    throw new Error(`List webhooks failed: ${res.status}`);
  }
  const json = (await res.json()) as { data?: WebhookInfo[]; webhooks?: WebhookInfo[] };
  return json.data ?? json.webhooks ?? [];
}

/**
 * 删除 Webhook
 */
export async function deleteWebhook(
  authToken: string,
  webhookId: string
): Promise<void> {
  const res = await fetch(`${NOTIFY_API}/delete-webhook`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Alchemy-Token": authToken,
    },
    body: JSON.stringify({ webhook_id: webhookId }),
  });
  if (!res.ok) {
    throw new Error(`Delete webhook failed: ${res.status}`);
  }
}
