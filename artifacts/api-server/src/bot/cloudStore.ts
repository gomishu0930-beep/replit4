/**
 * GCS を使ったシンプルな JSON 永続化モジュール
 * - デプロイをまたいでも posts.json / external-patterns.json が消えない
 * - GCS が使えない場合はローカルファイルにフォールバック
 */
import { Storage } from '@google-cloud/storage';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const REPLIT_SIDECAR = 'http://127.0.0.1:1106';
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? '';
const LOCAL_DIR = resolve(process.cwd(), 'fanza-bot/data');

// Replit サイドカー認証で GCS クライアントを初期化
function createClient(): Storage | null {
  if (!BUCKET_ID) return null;
  try {
    return new Storage({
      credentials: {
        audience: 'replit',
        subject_token_type: 'access_token',
        token_url: `${REPLIT_SIDECAR}/token`,
        type: 'external_account',
        credential_source: {
          url: `${REPLIT_SIDECAR}/credential`,
          format: { type: 'json', subject_token_field_name: 'access_token' },
        },
        universe_domain: 'googleapis.com',
      } as any,
      projectId: '',
    });
  } catch {
    return null;
  }
}

const gcs = createClient();

function localPath(key: string): string {
  mkdirSync(LOCAL_DIR, { recursive: true });
  return resolve(LOCAL_DIR, key);
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  // ① GCS から読み込み
  if (gcs && BUCKET_ID) {
    try {
      const file = gcs.bucket(BUCKET_ID).file(`fanza-bot/${key}`);
      const [exists] = await file.exists();
      if (exists) {
        const [content] = await file.download();
        const parsed = JSON.parse(content.toString('utf-8')) as T;
        // ローカルにも書いてキャッシュ
        writeFileSync(localPath(key), content);
        return parsed;
      }
    } catch (e: any) {
      console.warn(`  ⚠ GCS読み込み失敗 (${key}): ${e.message} → ローカルにフォールバック`);
    }
  }

  // ② ローカルファイルにフォールバック
  const local = localPath(key);
  if (existsSync(local)) {
    try {
      return JSON.parse(readFileSync(local, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  const json = JSON.stringify(data, null, 2);

  // ローカルにも書く（同期的・即時）
  writeFileSync(localPath(key), json, 'utf-8');

  // GCS にも書く（非同期・失敗してもローカルは保存済み）
  if (gcs && BUCKET_ID) {
    try {
      const file = gcs.bucket(BUCKET_ID).file(`fanza-bot/${key}`);
      await file.save(json, { contentType: 'application/json', resumable: false });
    } catch (e: any) {
      console.warn(`  ⚠ GCS書き込み失敗 (${key}): ${e.message}`);
    }
  }
}
