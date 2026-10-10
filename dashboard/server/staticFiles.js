// Serves the built dashboard from dist/ (run `npm run build` first), so one
// backend process can host the whole dashboard without Vite.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const contentTypes =
{
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

// The phone and motion pages are their own entries; everything else falls back to the dashboard.
const pageAliases = { '/': '/index.html', '/camera': '/camera.html', '/camera/': '/camera.html', '/motion': '/motion.html', '/motion/': '/motion.html' };

function sendJson(response, status, body)
{
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}

export async function serveStatic(request, response, url, distDirectory)
{
    if (request.method !== 'GET' && request.method !== 'HEAD')
    {
        return sendJson(response, 405, { error: 'Method not allowed' });
    }

    const root = resolve(distDirectory);
    let pathname = pageAliases[url.pathname];

    try
    {
        pathname ??= decodeURIComponent(url.pathname);
    }
    catch
    {
        return sendJson(response, 400, { error: 'Bad path' });
    }

    let file = resolve(join(root, pathname));

    if (file !== root && !file.startsWith(root + sep))
    {
        return sendJson(response, 403, { error: 'Forbidden' });
    }

    let fileStats = await stat(file).catch(() => null);

    if (!fileStats?.isFile())
    {
        file = join(root, 'index.html');
        fileStats = await stat(file).catch(() => null);

        if (!fileStats)
        {
            return sendJson(response, 503, { error: 'Dashboard not built. Run npm run build.' });
        }
    }

    const isHashedAsset = file.startsWith(join(root, 'assets') + sep);

    response.writeHead(200,
    {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
}
