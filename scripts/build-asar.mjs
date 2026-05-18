// Build app.asar from latest dist/ directory
import { execSync } from 'child_process';
import { existsSync, copyFileSync, readdirSync, renameSync, rmdirSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const asarTmp = '/tmp/asar-root-fixed';
const distSrc = join(root, 'dist');
const pkgSrc = join(root, 'package.json');
const asarDst = join(root, 'release', 'SimpleDraw-win32-x64', 'resources', 'app.asar');

// Clean and recreate tmp dir
if (existsSync(asarTmp)) rmSync(asarTmp, { recursive: true });
mkdirSync(asarTmp, { recursive: true });

// Copy dist/ and package.json
execSync(`cp -r "${distSrc}" "${asarTmp}/dist"`, { stdio: 'pipe' });
copyFileSync(pkgSrc, join(asarTmp, 'package.json'));

// Fix nested fonts directory
const fontsDir = join(asarTmp, 'dist', 'renderer', 'fonts');
if (existsSync(join(fontsDir, 'fonts'))) {
    const nested = join(fontsDir, 'fonts');
    for (const f of readdirSync(nested)) {
        renameSync(join(nested, f), join(fontsDir, f));
    }
    rmdirSync(nested);
}

// Pack asar
execSync(`npx asar pack "${asarTmp}" "${asarDst}"`, { stdio: 'pipe', cwd: root });

if (existsSync(asarDst)) {
    const mb = statSync(asarDst).size / 1024 / 1024;
    console.log(`✓ app.asar 已创建 (${mb.toFixed(0)} MB)`);
}
