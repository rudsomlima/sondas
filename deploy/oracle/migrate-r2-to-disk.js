// Copia TODOS os objetos do bucket R2 para o disco (DATA_DIR), conferindo o
// tamanho de cada um. Não apaga nada no R2. Rodar dentro do container do app
// (tem o SDK e as credenciais do R2):
//   docker exec -i -e DATA_DIR=/data sondas-sondas-1 node - < migrate-r2-to-disk.js
const fs = require('node:fs'), path = require('node:path')
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3')
const root = process.env.DATA_DIR
if (!root) { console.error('defina DATA_DIR'); process.exit(1) }
const c = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } })
const Bucket = process.env.R2_BUCKET_NAME || 'sondas'
;(async () => {
  let token, all = []
  do {
    const r = await c.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }))
    all.push(...(r.Contents || [])); token = r.NextContinuationToken
  } while (token)
  let bytes = 0, bad = 0
  for (const o of all) {
    const res = await c.send(new GetObjectCommand({ Bucket, Key: o.Key }))
    const buf = Buffer.from(await res.Body.transformToByteArray())
    const file = path.join(root, ...o.Key.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file)
    if (buf.length !== o.Size || fs.statSync(file).size !== o.Size) { bad++; console.log('TAMANHO DIFERENTE', o.Key) }
    bytes += buf.length
  }
  console.log(`copiados ${all.length} objetos, ${bytes} bytes, divergencias: ${bad}`)
  process.exit(bad ? 2 : 0)
})().catch(e => { console.error('ERRO', e.message); process.exit(1) })
