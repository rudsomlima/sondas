/**
 * Armazenamento em disco que imita o pedaço do cliente S3 que o blobStore.ts
 * usa (Get/Put/List/Delete/Head), pra o app rodar sem R2: com `DATA_DIR`
 * definido, `getClient()` devolve este cliente no lugar do S3Client e nenhuma
 * outra função do blobStore muda. Ver docs/ORACLE.md.
 *
 * Fiel ao S3 no que o app depende:
 * - chave = caminho relativo dentro de DATA_DIR (`sondas/history-2026.json`);
 * - Get de arquivo inexistente lança `name: 'NoSuchKey'` + 404;
 * - ETag = md5 do conteúdo entre aspas; `IfMatch`/`IfNoneMatch: '*'` no Put
 *   falham com 412 (é o que `updateJsonConditional` usa pra não perder
 *   gravações concorrentes);
 * - gravação atômica (arquivo temporário + rename) e uma trava por chave, pra
 *   a checagem do ETag e a escrita não se intercalarem. A trava mora em
 *   `globalThis` porque cada rota do Next pode carregar uma cópia própria
 *   deste módulo.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const LOCKS_KEY = '__sondasLocalStoreLocks'
const g = globalThis as unknown as Record<string, Map<string, Promise<unknown>>>
const locks = (g[LOCKS_KEY] ??= new Map())

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(key, tail)
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key) })
  return run
}

function s3Error(name: string, status: number, message: string) {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } })
}

const etagOf = (buf: Buffer) => `"${createHash('md5').update(buf).digest('hex')}"`

export class LocalStoreClient {
  constructor(private readonly root: string) {}

  private fileFor(key: string): string {
    const clean = key.replace(/\\/g, '/')
    if (!clean || clean.startsWith('/') || clean.split('/').some(p => p === '..' || p === '')) {
      throw s3Error('InvalidKey', 400, `chave inválida: ${key}`)
    }
    return path.join(this.root, ...clean.split('/'))
  }

  async send(cmd: unknown): Promise<any> {
    if (cmd instanceof GetObjectCommand) return this.get(cmd.input.Key!)
    if (cmd instanceof PutObjectCommand) return this.put(cmd.input)
    if (cmd instanceof HeadObjectCommand) return this.head(cmd.input.Key!)
    if (cmd instanceof DeleteObjectCommand) return this.del(cmd.input.Key!)
    if (cmd instanceof ListObjectsV2Command) return this.list(cmd.input.Prefix ?? '')
    throw s3Error('NotImplemented', 501, 'comando não suportado pelo armazenamento em disco')
  }

  private async get(key: string) {
    const file = this.fileFor(key)
    let buf: Buffer
    try { buf = await fs.readFile(file) } catch (e: any) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') throw s3Error('NoSuchKey', 404, `NoSuchKey: ${key}`)
      throw e
    }
    return {
      ETag: etagOf(buf),
      ContentLength: buf.length,
      Body: {
        transformToString: async () => buf.toString('utf8'),
        transformToByteArray: async () => new Uint8Array(buf),
      },
    }
  }

  private async head(key: string) {
    let st
    try { st = await fs.stat(this.fileFor(key)) } catch (e: any) {
      if (e?.code === 'ENOENT') throw s3Error('NotFound', 404, `NotFound: ${key}`)
      throw e
    }
    return { ContentLength: st.size, LastModified: st.mtime }
  }

  private put(input: PutObjectCommand['input']) {
    const key = input.Key!
    return withLock(key, async () => {
      const file = this.fileFor(key)
      if (input.IfMatch || input.IfNoneMatch) {
        let current: string | null = null
        try { current = etagOf(await fs.readFile(file)) } catch (e: any) {
          if (e?.code !== 'ENOENT') throw e
        }
        if (input.IfNoneMatch === '*' && current !== null) throw s3Error('PreconditionFailed', 412, `já existe: ${key}`)
        if (input.IfMatch && input.IfMatch !== current) throw s3Error('PreconditionFailed', 412, `ETag mudou: ${key}`)
      }
      const body = input.Body
      const buf = typeof body === 'string' ? Buffer.from(body, 'utf8')
        : body instanceof Uint8Array ? Buffer.from(body)
        : Buffer.from(String(body ?? ''), 'utf8')
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(tmp, buf)
      await fs.rename(tmp, file)
      return { ETag: etagOf(buf) }
    })
  }

  private del(key: string) {
    return withLock(key, async () => {
      try { await fs.unlink(this.fileFor(key)) } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e
      }
      return {}
    })
  }

  private async list(prefix: string) {
    const out: { Key: string; Size: number; LastModified: Date }[] = []
    const walk = async (dir: string, rel: string) => {
      let entries
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (e: any) {
        if (e?.code === 'ENOENT') return
        throw e
      }
      for (const ent of entries) {
        const childRel = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) await walk(path.join(dir, ent.name), childRel)
        else if (ent.isFile() && !ent.name.endsWith('.tmp')) {
          const key = childRel
          if (!key.startsWith(prefix)) continue
          const st = await fs.stat(path.join(dir, ent.name))
          out.push({ Key: key, Size: st.size, LastModified: st.mtime })
        }
      }
    }
    await walk(this.root, '')
    out.sort((a, b) => a.Key.localeCompare(b.Key))
    return { Contents: out, NextContinuationToken: undefined, IsTruncated: false }
  }
}
