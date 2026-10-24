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
