import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client/http';
import type { Client, Transaction, InValue } from '@libsql/client';

type Row = Record<string, unknown>;

/** One SQL interface for local SQLite and a persistent remote libSQL database. */
export class Database {
  private local?: DatabaseSync;
  private remote?: Client;
  private scope = new AsyncLocalStorage<DatabaseSync | Transaction>();
  private queue: Promise<void> = Promise.resolve();
  readonly isRemote: boolean;

  constructor(location: string, authToken?: string) {
    this.isRemote = /^(libsql|https):\/\//.test(location);
    if (this.isRemote) {
      if (!authToken) throw new Error('TURSO_AUTH_TOKEN is required for a remote database.');
      this.remote = createClient({ url: location, authToken, intMode: 'number' });
    } else {
      if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
      this.local = new DatabaseSync(location);
      this.local.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    }
  }

  private async locked<T>(action: () => T | Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async execute(sql: string, args: InValue[]): Promise<{ rows: Row[]; changes: number }> {
    const connection = this.scope.getStore();
    if (connection instanceof DatabaseSync) {
      const statement = connection.prepare(sql);
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
        return { rows: statement.all(...(args as SQLInputValue[])) as Row[], changes: 0 };
      }
      const result = statement.run(...(args as SQLInputValue[]));
      return { rows: [] as Row[], changes: Number(result.changes) };
    }
    if (this.remote) {
      const result = await ((connection as Transaction | undefined) ?? this.remote).execute({
        sql,
        args,
      });
      return { rows: result.rows as unknown as Row[], changes: result.rowsAffected };
    }
    return this.locked(() => this.scope.run(this.local!, () => this.execute(sql, args)));
  }

  prepare(sql: string) {
    return {
      all: async (...args: InValue[]) => (await this.execute(sql, args)).rows,
      get: async (...args: InValue[]) => (await this.execute(sql, args)).rows[0],
      run: async (...args: InValue[]) => ({ changes: (await this.execute(sql, args)).changes }),
    };
  }

  async exec(sql: string) {
    const connection = this.scope.getStore();
    if (connection instanceof DatabaseSync) {
      connection.exec(sql);
      return;
    }
    if (this.remote) {
      await ((connection as Transaction | undefined) ?? this.remote).executeMultiple(sql);
      return;
    }
    await this.locked(() => this.local!.exec(sql));
  }

  async transaction<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.scope.getStore()) throw new Error('Nested database transactions are not supported.');
    if (this.remote) {
      const transaction = await this.remote.transaction('write');
      try {
        const result = await this.scope.run(transaction, action);
        await transaction.commit();
        return result;
      } catch (error) {
        try {
          await transaction.rollback();
        } catch {
          /* Preserve the original failure. */
        }
        throw error;
      } finally {
        transaction.close();
      }
    }
    return this.locked(async () => {
      this.local!.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.scope.run(this.local!, action);
        this.local!.exec('COMMIT');
        return result;
      } catch (error) {
        this.local!.exec('ROLLBACK');
        throw error;
      }
    });
  }

  close() {
    this.remote?.close();
    this.local?.close();
  }
}
