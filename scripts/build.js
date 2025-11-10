#!/usr/bin/env node

/**
 * Wellness Hub 构建脚本
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

/**
 * 构建配置
 */
const buildConfig = {
  src: {
    css: path.join(projectRoot, 'src/css'),
    js: path.join(projectRoot, 'src/js'),
    templates: path.join(projectRoot, 'src/templates')
  },
  dist: {
    css: path.join(projectRoot, 'public/css'),
    js: path.join(projectRoot, 'public/js'),
    html: path.join(projectRoot, 'public')
  },
  // 需要复制的文件
  copyFiles: [
    'index.html',
    'user-home.html',
    'drink-water.html',
    'bowel-tracker.html',
    'slack-tracker.html',
    'smoking-tracker.html',
    'mini-games.html',
    'schulte-table.html',
    'memory-flip.html',
    'reaction-test.html',
    'sudoku.html'
  ]
};

/**
 * 日志工具
 */
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

/**
 * 确保目录存在
 */
async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * 复制文件
 */
async function copyFile(src, dest) {
  try {
    await fs.copyFile(src, dest);
    log.info(`Copied: ${path.relative(projectRoot, src)} -> ${path.relative(projectRoot, dest)}`);
  } catch (error) {
    log.error(`Failed to copy ${src}: ${error.message}`);
  }
}

/**
 * 构建 CSS
 */
async function buildCSS() {
  log.info('Building CSS...');

  // 确保输出目录存在
  await ensureDir(buildConfig.dist.css);

  // 创建主 CSS 文件
  const mainCSS = `
/* Wellness Hub Main Stylesheet */
/* Generated on ${new Date().toISOString()} */

/* Core styles */
@import url('../src/css/core/variables.css');
@import url('../src/css/core/reset.css');
@import url('../src/css/core/typography.css');

/* Components */
@import url('../src/css/components/buttons.css');
@import url('../src/css/components/cards.css');
@import url('../src/css/components/forms.css');
@import url('../src/css/components/layout.css');

/* Utilities */
@import url('../src/css/utils/animations.css');

/* Pages */
@import url('../src/css/pages/navigation.css');
@import url('../src/css/pages/games.css');

/* Legacy styles */
@import url('../../css/nav.css');
@import url('../../css/drink-water.css');
@import url('../../css/simple-tracker.css');
@import url('../../css/mini-games.css');
@import url('../../css/mobile-game-shell.css');
@import url('../../css/simple-page.css');
@import url('../../css/user-home.css');
`;

  const mainCSSPath = path.join(buildConfig.dist.css, 'main.css');
  await fs.writeFile(mainCSSPath, mainCSS);
  log.info(`Created: ${path.relative(projectRoot, mainCSSPath)}`);
}

/**
 * 构建 JavaScript
 */
async function buildJS() {
  log.info('Building JavaScript...');

  // 确保输出目录存在
  await ensureDir(buildConfig.dist.js);

  // 创建主 JS 文件
  const mainJS = `
/**
 * Wellness Hub Main Entry Point
 * Generated on ${new Date().toISOString()}
 */

// Import main application
import '/public/js/main.js';

// Import legacy scripts
const legacyScripts = [
  '/js/nav.js',
  '/js/activity-api.js',
  '/js/user-home.js',
  '/js/drink-water.js',
  '/js/bowel-tracker.js',
  '/js/slack-tracker.js',
  '/js/smoking-tracker.js',
  '/js/util-footer.js',
  '/js/ai-battle-room.js',
  '/js/memory-flip.js'
];

// Load legacy scripts dynamically
legacyScripts.forEach(script => {
  const scriptElement = document.createElement('script');
  scriptElement.src = script;
  scriptElement.async = true;
  document.head.appendChild(scriptElement);
});
`;

  const mainJSPath = path.join(buildConfig.dist.js, 'main.js');
  await fs.writeFile(mainJSPath, mainJS);
  log.info(`Created: ${path.relative(projectRoot, mainJSPath)}`);
}

/**
 * 复制 HTML 文件
 */
async function copyHTML() {
  log.info('Copying HTML files...');

  for (const file of buildConfig.copyFiles) {
    const src = path.join(projectRoot, file);
    const dest = path.join(buildConfig.dist.html, file);

    try {
      await fs.access(src);
      await copyFile(src, dest);
    } catch {
      log.warn(`File not found: ${src}`);
    }
  }
}

/**
 * 复制其他资源
 */
async function copyAssets() {
  log.info('Copying assets...');

  const assetsDir = path.join(projectRoot, 'public', 'assets');
  await ensureDir(assetsDir);

  // 复制图标文件（如果存在）
  const iconsDir = path.join(projectRoot, 'assets');
  try {
    await fs.access(iconsDir);
    const files = await fs.readdir(iconsDir);
    for (const file of files) {
      await copyFile(
        path.join(iconsDir, file),
        path.join(assetsDir, file)
      );
    }
  } catch {
    log.warn('Assets directory not found, skipping...');
  }
}

/**
 * 更新 HTML 文件中的引用路径
 */
async function updateHTMLPaths() {
  log.info('Updating HTML paths...');

  for (const file of buildConfig.copyFiles) {
    const filePath = path.join(buildConfig.dist.html, file);

    try {
      let content = await fs.readFile(filePath, 'utf8');

      // 更新 CSS 引用
      content = content.replace(
        /href="css\/[^"]*"/g,
        'href="/public/css/main.css"'
      );

      // 更新 JS 引用
      content = content.replace(
        /src="js\/[^"]*"/g,
        'src="/public/js/main.js"'
      );

      await fs.writeFile(filePath, content);
      log.info(`Updated paths in: ${file}`);
    } catch (error) {
      log.warn(`Failed to update ${file}: ${error.message}`);
    }
  }
}

/**
 * 生成清单文件
 */
async function generateManifest() {
  log.info('Generating manifest...');

  const manifest = {
    name: 'Wellness Hub',
    short_name: 'Wellness',
    description: '健康生活管理平台',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#3b82f6',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/assets/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/assets/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  };

  const manifestPath = path.join(buildConfig.dist.html, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  log.info(`Created: ${path.relative(projectRoot, manifestPath)}`);
}

/**
 * 清理构建目录
 */
async function clean() {
  log.info('Cleaning build directory...');

  try {
    await fs.rm(buildConfig.dist.css, { recursive: true, force: true });
    await fs.rm(buildConfig.dist.js, { recursive: true, force: true });
    log.info('Clean completed');
  } catch (error) {
    log.warn(`Clean warning: ${error.message}`);
  }
}

/**
 * 主构建函数
 */
async function build() {
  const startTime = Date.now();
  log.info('Starting build process...');

  try {
    await clean();
    await buildCSS();
    await buildJS();
    await copyHTML();
    await copyAssets();
    await updateHTMLPaths();
    await generateManifest();

    const duration = Date.now() - startTime;
    log.info(`Build completed successfully in ${duration}ms!`);
  } catch (error) {
    log.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 开发服务器
 */
async function serve() {
  log.info('Starting development server...');

  // 这里可以集成一个简单的开发服务器
  log.info('Development server would start here');
  log.info('Please use your preferred development server');
}

// 命令行参数处理
const command = process.argv[2];

switch (command) {
  case 'build':
    build();
    break;
  case 'clean':
    clean();
    break;
  case 'serve':
    serve();
    break;
  default:
    log.info('Available commands:');
    log.info('  build  - Build the project');
    log.info('  clean  - Clean build directory');
    log.info('  serve  - Start development server');
    break;
}