/**
 * MyBrain ロゴ SVG → PNG アイコン生成スクリプト
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');

// アイコン用 SVG（正方形 + ラベンダー背景）
const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <!-- 背景 -->
  <rect width="512" height="512" rx="112" fill="#EEF0FF"/>
  <!-- ロゴを中央に配置（元 240x200 → 320x267 にスケール、位置調整） -->
  <g transform="translate(96, 122.5) scale(1.333)">
    <g stroke="#1B2F5B" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
      <!-- 左脳 -->
      <path d="M115 38 C100 30 78 30 70 42 C55 40 44 50 46 62 C34 64 28 78 36 88 C28 98 34 112 46 112 C46 126 60 134 72 128 C82 140 104 138 115 128 Z" fill="#ffffff"/>
      <!-- 右脳 -->
      <g transform="translate(240,0) scale(-1,1)">
        <path d="M115 38 C100 30 78 30 70 42 C55 40 44 50 46 62 C34 64 28 78 36 88 C28 98 34 112 46 112 C46 126 60 134 72 128 C82 140 104 138 115 128 Z" fill="#ffffff"/>
      </g>
      <!-- 左：ネットワーク -->
      <line x1="64" y1="72" x2="88" y2="86"/>
      <line x1="64" y1="100" x2="88" y2="86"/>
    </g>
    <g fill="#1B2F5B">
      <circle cx="62" cy="72" r="6"/>
      <circle cx="62" cy="100" r="6"/>
      <circle cx="90" cy="86" r="6"/>
    </g>
    <!-- 右：横線 -->
    <g stroke="#1B2F5B" stroke-width="5" stroke-linecap="round">
      <line x1="150" y1="74" x2="178" y2="74"/>
      <line x1="150" y1="86" x2="172" y2="86"/>
      <line x1="150" y1="98" x2="178" y2="98"/>
    </g>
  </g>
</svg>`;

const svgBuffer = Buffer.from(svgSrc);

async function generate() {
  // icon-192.png
  await sharp(svgBuffer).resize(192, 192).png().toFile(`${publicDir}/icon-192.png`);
  console.log('✓ icon-192.png');

  // icon-512.png
  await sharp(svgBuffer).resize(512, 512).png().toFile(`${publicDir}/icon-512.png`);
  console.log('✓ icon-512.png');

  // apple-touch-icon.png (180x180)
  await sharp(svgBuffer).resize(180, 180).png().toFile(`${publicDir}/apple-touch-icon.png`);
  console.log('✓ apple-touch-icon.png');

  // favicon.png (32x32) → favicon.ico 代替として PNG を使う
  await sharp(svgBuffer).resize(32, 32).png().toFile(`${publicDir}/favicon-32.png`);
  console.log('✓ favicon-32.png');

  console.log('\nAll icons generated in /public/');
}

generate().catch((err) => { console.error(err); process.exit(1); });
