import { defineConfig } from 'tsup';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  external: [
    'better-sqlite3',
    'keytar',
    'open',
  ],
  noExternal: ['@modelcontextprotocol/sdk'],
  onSuccess: () => {
    // Copy database schema files to dist
    const srcDb = join('src', 'database');
    const distDb = join('dist', 'database');
    
    mkdirSync(distDb, { recursive: true });
    mkdirSync(join(distDb, 'migrations'), { recursive: true });
    
    copyFileSync(join(srcDb, 'schema.sql'), join(distDb, 'schema.sql'));
    copyFileSync(join(srcDb, 'migrations', '001_initial.sql'), join(distDb, 'migrations', '001_initial.sql'));

    // Compile web-ui TypeScript files to JavaScript for browser
    try {
      execFileSync(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.web.json'], {
        stdio: 'inherit',
      });
      
      // Clean up extra compiled output
      const srcDir = join('dist', 'web-ui', 'src');
      if (existsSync(srcDir)) {
        rmSync(srcDir, { recursive: true, force: true });
      }
      const staticAssetsJs = join('dist', 'web-ui', 'static-assets.js');
      if (existsSync(staticAssetsJs)) {
        rmSync(staticAssetsJs, { force: true });
      }
      
      // Copy static HTML/CSS files
      const srcWeb = join('src', 'web-ui');
      const distWeb = join('dist', 'web-ui');
      copyFileSync(join(srcWeb, 'index.html'), join(distWeb, 'index.html'));
      copyFileSync(join(srcWeb, 'styles.css'), join(distWeb, 'styles.css'));
      
      console.log('Web UI compiled successfully');
    } catch (error: unknown) {
      console.warn('Warning: web-ui compilation failed:', error);
    }
  },
});
