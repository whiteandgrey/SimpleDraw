// Build portable ZIP from SimpleDraw-win32-x64 directory
import { existsSync, statSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const winDir = join(root, 'release', 'SimpleDraw-win32-x64');
const zipPath = join(root, 'release', `SimpleDraw-${pkg.version}-win32-x64-portable.zip`);

if (!existsSync(winDir)) {
    console.error('错误: 未找到 SimpleDraw-win32-x64 目录。请先运行 npm run build:asar');
    process.exit(1);
}

if (existsSync(zipPath)) rmSync(zipPath);

// Write a small python script to temp file (avoid escaping issues)
const pyScript = `
import zipfile, os
win_dir = r'${winDir}'
zip_path = r'${zipPath}'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for rootdir, dirs, files in os.walk(win_dir):
        for f in files:
            p = os.path.join(rootdir, f)
            arcname = os.path.relpath(p, os.path.join(win_dir, '..'))
            z.write(p, arcname)
print(os.path.getsize(zip_path))
`;

const pyFile = join('/tmp', 'build-zip.py');
writeFileSync(pyFile, pyScript);
const result = spawnSync('python3', [pyFile], { stdio: 'pipe' });
unlinkSync(pyFile);

if (result.status !== 0) {
    console.error('ZIP 创建失败:', result.stderr.toString());
    process.exit(1);
}

const mb = statSync(zipPath).size / 1024 / 1024;
console.log(`✓ 便携版 ZIP 已创建 (${mb.toFixed(0)} MB)`);
