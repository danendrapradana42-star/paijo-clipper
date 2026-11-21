import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

const configDir = path.dirname(fileURLToPath(import.meta.url));

function detectBuildGithubRepo(): string {
  const fromEnv = [
    process.env.DESKTOP_GITHUB_REPO || '',
    process.env.VITE_DESKTOP_GITHUB_REPO || '',
    process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : '',
  ];
  for (const cand of fromEnv) {
    const clean = cand.trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) return clean;
  }
  try {
    const remote = execSync('git config --get remote.origin.url', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    })
      .toString('utf8')
      .trim();
    const match = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(remote);
    if (match?.[1]) return match[1];
  } catch {
    // Ignore when .git or remote.origin.url is absent
  }
  return '';
}

export default defineConfig(() => {
  const autoGithubRepo = detectBuildGithubRepo();

  return {
    define: {
      'import.meta.env.VITE_AUTO_GITHUB_REPO': JSON.stringify(autoGithubRepo),
    },
    build: {
      chunkSizeWarningLimit: 1800,
    },
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(configDir, 'dist');
          const srcAssets = path.resolve(configDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(configDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
