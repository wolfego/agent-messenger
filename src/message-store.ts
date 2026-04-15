import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  rmdirSync, statSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface MessageMeta {
  id: string;
  to: string;
  from: string;
  subject: string;
  channel: string | null;
  action: string | null;
  priority: "normal" | "urgent";
  unread: boolean;
  timestamp: string;
  reply_to: string | null;
  thread_id: string;
  context_files: string[];
  task_id: string | null;
  body_size: number;
}

export interface Message extends MessageMeta {
  body: string;
}

export interface ConversationSummary {
  thread_id: string;
  subject: string;
  last_message: MessageMeta;
  unread_count: number;
  message_count: number;
}

function generateId(): string {
  return `msg-${randomBytes(4).toString("hex")}`;
}

export class MessageStore {
  private indexPath: string;
  private messagesDir: string;
  private lockDir: string;

  constructor(storeDir: string) {
    this.indexPath = join(storeDir, "index.json");
    this.messagesDir = join(storeDir, "messages");
    this.lockDir = join(storeDir, "index.lock");

    mkdirSync(this.messagesDir, { recursive: true });
    if (!existsSync(this.indexPath)) {
      writeFileSync(this.indexPath, "[]", "utf-8");
    }
  }

  // --- Locking ---

  private acquireLock(timeoutMs = 5000): void {
    const start = Date.now();
    while (true) {
      try {
        mkdirSync(this.lockDir);
        return;
      } catch {
        try {
          const stat = statSync(this.lockDir);
          if (Date.now() - stat.mtimeMs > 10_000) {
            rmdirSync(this.lockDir);
            continue;
          }
        } catch { /* lock vanished, retry */ }

        if (Date.now() - start > timeoutMs) {
          throw new Error("Failed to acquire message store lock");
        }
        const end = Date.now() + 5;
        while (Date.now() < end) { /* busy wait */ }
      }
    }
  }

  private releaseLock(): void {
    try { rmdirSync(this.lockDir); } catch { /* already gone */ }
  }

  // --- Index I/O ---

  readIndex(): MessageMeta[] {
    try {
      const raw = readFileSync(this.indexPath, "utf-8");
      return JSON.parse(raw) as MessageMeta[];
    } catch {
      return [];
    }
  }

  private writeIndex(entries: MessageMeta[]): void {
    const tmpPath = this.indexPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
    renameSync(tmpPath, this.indexPath);
  }

  // --- Body I/O ---

  private bodyPath(id: string): string {
    return join(this.messagesDir, `${id}.body`);
  }

  readBody(id: string): string {
    return readFileSync(this.bodyPath(id), "utf-8");
  }

  private writeBody(id: string, body: string): void {
    writeFileSync(this.bodyPath(id), body, "utf-8");
  }

  // --- Public API ---

  create(params: {
    to: string;
    from: string;
    subject: string;
    body: string;
    channel?: string | null;
    action?: string | null;
    priority?: "normal" | "urgent";
    context_files?: string[];
    task_id?: string | null;
    reply_to?: string | null;
    thread_id?: string | null;
  }): MessageMeta {
    const id = generateId();
    const body = params.body;

    const meta: MessageMeta = {
      id,
      to: params.to,
      from: params.from,
      subject: params.subject,
      channel: params.channel ?? null,
      action: params.action ?? null,
      priority: params.priority ?? "normal",
      unread: true,
      timestamp: new Date().toISOString(),
      reply_to: params.reply_to ?? null,
      thread_id: params.thread_id ?? id,
      context_files: params.context_files ?? [],
      task_id: params.task_id ?? null,
      body_size: Buffer.byteLength(body, "utf-8"),
    };

    this.writeBody(id, body);

    this.acquireLock();
    try {
      const index = this.readIndex();
      index.push(meta);
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }

    return meta;
  }

  find(id: string): MessageMeta | undefined {
    return this.readIndex().find((m) => m.id === id);
  }

  inbox(
    agentId: string,
    baseId: string,
    opts?: { channel?: string; includeRead?: boolean },
  ): Message[] {
    const index = this.readIndex();
    const targets = new Set([agentId, baseId]);

    const filtered = index.filter((m) => {
      if (!targets.has(m.to)) return false;
      if (!opts?.includeRead && !m.unread) return false;
      if (opts?.channel && m.channel !== opts.channel) return false;
      return true;
    });

    return filtered.map((meta) => ({
      ...meta,
      body: this.readBody(meta.id),
    }));
  }

  markRead(id: string): void {
    this.acquireLock();
    try {
      const index = this.readIndex();
      const entry = index.find((m) => m.id === id);
      if (entry) entry.unread = false;
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }
  }

  markAllRead(ids: string[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.acquireLock();
    try {
      const index = this.readIndex();
      for (const entry of index) {
        if (idSet.has(entry.id)) entry.unread = false;
      }
      this.writeIndex(index);
    } finally {
      this.releaseLock();
    }
  }

  thread(messageId: string): Message[] {
    const index = this.readIndex();
    const target = index.find((m) => m.id === messageId);
    if (!target) return [];

    const threadId = target.thread_id;
    const threadMetas = index
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return threadMetas.map((meta) => ({
      ...meta,
      body: this.readBody(meta.id),
    }));
  }

  conversations(
    agentId: string,
    baseId: string,
    _opts?: { status?: "open" | "closed" | "all" },
  ): ConversationSummary[] {
    const index = this.readIndex();
    const targets = new Set([agentId, baseId]);

    const relevant = index.filter(
      (m) => targets.has(m.to) || targets.has(m.from),
    );

    const threads = new Map<string, MessageMeta[]>();
    for (const m of relevant) {
      const existing = threads.get(m.thread_id) ?? [];
      existing.push(m);
      threads.set(m.thread_id, existing);
    }

    const summaries: ConversationSummary[] = [];
    for (const [threadId, msgs] of threads) {
      msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const root = msgs[0]!;
      const last = msgs[msgs.length - 1]!;
      const unreadCount = msgs.filter((m) => m.unread && targets.has(m.to)).length;

      summaries.push({
        thread_id: threadId,
        subject: root.subject.replace(/^Re: /, ""),
        last_message: last,
        unread_count: unreadCount,
        message_count: msgs.length,
      });
    }

    summaries.sort(
      (a, b) =>
        new Date(b.last_message.timestamp).getTime() -
        new Date(a.last_message.timestamp).getTime(),
    );
    return summaries;
  }

  query(filter: {
    from?: string;
    to?: string;
    channel?: string;
    limit?: number;
  }): MessageMeta[] {
    let results = this.readIndex();

    if (filter.from) results = results.filter((m) => m.from === filter.from);
    if (filter.to) results = results.filter((m) => m.to === filter.to);
    if (filter.channel) results = results.filter((m) => m.channel === filter.channel);

    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter.limit) results = results.slice(0, filter.limit);

    return results;
  }

  prune(opts?: { olderThanDays?: number; readOnly?: boolean }): number {
    const days = opts?.olderThanDays ?? 7;
    const readOnly = opts?.readOnly ?? true;
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;

    this.acquireLock();
    try {
      const index = this.readIndex();
      const keep: MessageMeta[] = [];
      let pruned = 0;

      for (const entry of index) {
        const age = new Date(entry.timestamp).getTime();
        const shouldPrune = age < threshold && (!readOnly || !entry.unread);
        if (shouldPrune) {
          try { unlinkSync(this.bodyPath(entry.id)); } catch { /* body may already be gone */ }
          pruned++;
        } else {
          keep.push(entry);
        }
      }

      this.writeIndex(keep);
      return pruned;
    } finally {
      this.releaseLock();
    }
  }
}
