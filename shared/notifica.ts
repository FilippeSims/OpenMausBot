export interface NotificaStatus {
  configured: boolean;
  enabled: boolean;
  authFailed: boolean;
  retryAt?: number;
  pending: Array<{
    eventId: string;
    threadId: string;
    conversationKey: string;
    title: string;
    status: "aguardando_usuario" | "enfileirado" | "recebido" | "erro";
    conversationId?: string;
    messageId?: string;
    alertId?: string;
    error?: string;
  }>;
}

/** Installation-owned catalog; a bot belongs to exactly one company and team. */
export interface NotificaWorkspaceStatus {
  configured: boolean;
  enabled: boolean;
  authFailed: boolean;
  error?: string;
  retryAt?: number;
  lastSyncAt?: number;
  companies: Array<{ id: string; name: string }>;
  teamCompanies: Record<string, string>;
  teams: Array<{ id: string; name: string; companyId: string; section: string }>;
  bots: number;
  pending: number;
}
