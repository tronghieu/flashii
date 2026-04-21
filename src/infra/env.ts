export interface Env {
  TURSO_URL: string;
  TURSO_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_IMAGE_MODEL?: string;
  IMAGES: R2Bucket;
  LOG_LEVEL?: string;
}

export interface Variables {
  userId: string;
}
