import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import { randomUUID } from 'crypto';

// ── Startup credential check ─────────────────────────────────────────────────
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('[FATAL] Missing Cloudinary environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET). File uploads will fail.');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, _file) => ({
    folder: 'xoksis',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    // Use a random UUID instead of file.originalname to prevent:
    // - Path traversal attacks (../../../etc)
    // - Naming collisions
    // - Information disclosure via filenames
    public_id: randomUUID(),
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    // Note: file.mimetype is client-supplied. Cloudinary performs its own
    // server-side content validation as a second layer of defense.
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: JPG, PNG, WebP. Got: ${file.mimetype}`));
    }
  },
});

export { cloudinary, upload };
