import { Hono } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { downloadUrl, iconUrl } from "./api";
import { getLatest, listLatest, listVersions } from "./store";
import type { AppEnv, ListedRow, VersionRow } from "./types";

const CSS = `
:root{color-scheme:light dark;--bg:#f2f2f1;--card:#fff;--border:#dcdcda;--text:#1b1b1a;--muted:#62625e;--soft:#e8e8e6;--accent:#3c3c3a;--on-accent:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--card:#202020;--border:#333331;--text:#ececea;--muted:#a2a29d;--soft:#2a2a28;--accent:#ececea;--on-accent:#161616}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}
header{border-bottom:1px solid var(--border);background:var(--card)}
.bar,main{max-width:960px;margin:0 auto;padding:0 20px}
.bar{display:flex;align-items:center;gap:16px;height:56px}
.brand{font-weight:700;letter-spacing:-.01em;text-decoration:none}
.brand span{color:var(--muted);font-weight:500}
main{padding-top:28px;padding-bottom:64px}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}
h2{font-size:16px;margin:32px 0 10px}
.lede,.muted{color:var(--muted)}
form.search{display:flex;gap:8px;margin:20px 0}
input[type=search]{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font:inherit}
button,.button{padding:9px 14px;border:0;border-radius:8px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;text-decoration:none;cursor:pointer;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{display:flex;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border);border-radius:12px;text-decoration:none}
.card:hover{border-color:var(--muted)}
.icon{flex:none;width:44px;height:44px;border-radius:10px;background:var(--soft);object-fit:contain;display:grid;place-items:center;color:var(--muted);font-weight:700}
.card h3{margin:0;font-size:15px}
.card p{margin:2px 0 0;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:12px;margin-right:6px}
.hero{display:flex;gap:16px;align-items:center;margin-bottom:8px}
.hero .icon{width:64px;height:64px;border-radius:14px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-size:14px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:0}
th{color:var(--muted);font-weight:600;background:var(--soft)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.shots{display:flex;gap:12px;overflow-x:auto}
.shots img{height:220px;border:1px solid var(--border);border-radius:10px}
.pager{display:flex;gap:10px;margin-top:20px}
footer{max-width:960px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:13px}
`;

const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <header>
        <div class="bar">
          <a class="brand" href="/">
            Atur Terminal <span>Extensions</span>
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer>Extensions are signed and verified by Atur Terminal before install.</footer>
    </body>
  </html>
);

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

const Icon: FC<{ origin: string; row: Pick<VersionRow, "name" | "icon_key"> }> = ({
  origin,
  row,
}) => {
  const src = iconUrl(origin, row);
  return src ? (
    <img class="icon" src={src} alt="" width="44" height="44" loading="lazy" />
  ) : (
    <div class="icon">{row.name.slice(0, 1).toUpperCase()}</div>
  );
};

function date(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

const Card: FC<{ origin: string; row: ListedRow }> = ({ origin, row }) => (
  <a class="card" href={`/e/${encodeURIComponent(row.name)}`}>
    <Icon origin={origin} row={row} />
    <div>
      <h3>
        {row.name} <span class="muted">{row.version}</span>
      </h3>
      <p>{row.description ?? ""}</p>
    </div>
  </a>
);

export const pages = new Hono<AppEnv>();

pages.get("/", async (c) => {
  const origin = new URL(c.req.url).origin;
  const search = (c.req.query("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const perPage = 24;
  const { rows, total } = await listLatest(c.env.DB, {
    search,
    category: null,
    sort: "all",
    page,
    perPage,
  });
  const query = (target: number) =>
    `/?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(target) })}`;
  return c.html(
    <Layout title="Atur Terminal Extensions">
      <h1>Extensions</h1>
      <p class="lede">
        Add panels, tabs and tools to Atur Terminal. Install them from Settings → Extensions.
      </p>
      <form class="search" method="get" action="/">
        <input
          type="search"
          name="q"
          value={search}
          placeholder="Search extensions"
          aria-label="Search extensions"
        />
        <button type="submit">Search</button>
      </form>
      {rows.length === 0 ? (
        <p class="muted">
          {search ? "No extensions match your search." : "Nothing published yet."}
        </p>
      ) : (
        <div class="grid">
          {rows.map((row) => (
            <Card origin={origin} row={row} />
          ))}
        </div>
      )}
      <div class="pager">
        {page > 1 && (
          <a class="button" href={query(page - 1)}>
            Previous
          </a>
        )}
        {page * perPage < total && (
          <a class="button" href={query(page + 1)}>
            Next
          </a>
        )}
      </div>
    </Layout>,
  );
});

pages.get("/e/:name", async (c) => {
  const origin = new URL(c.req.url).origin;
  const name = c.req.param("name");
  const row = await getLatest(c.env.DB, name);
  if (!row) {
    return c.html(
      <Layout title="Not found">
        <h1>Extension not found</h1>
        <p>
          <a href="/">Back to all extensions</a>
        </p>
      </Layout>,
      404,
    );
  }
  const versions = await listVersions(c.env.DB, name);
  const permissions = parseList(row.permissions);
  const categories = parseList(row.categories);
  const shots = parseList(row.screenshot_keys);
  return c.html(
    <Layout title={`${row.name} · Atur Terminal Extensions`}>
      <p>
        <a href="/">← All extensions</a>
      </p>
      <div class="hero">
        <Icon origin={origin} row={row} />
        <div>
          <h1>
            {row.name} <span class="muted">{row.version}</span>
          </h1>
          <div>
            {row.first_party === 1 && <span class="badge">Atur</span>}
            {categories.map((category) => (
              <span class="badge">{category}</span>
            ))}
          </div>
        </div>
      </div>
      <p>{row.description ?? ""}</p>
      <p>
        <a class="button" href={downloadUrl(origin, row.name, row.version)}>
          Download {row.version}
        </a>
      </p>
      <p class="muted">
        Published by {row.publisher}
        {row.author_name ? ` · ${row.author_name}` : ""} · {row.total_downloads} downloads ·{" "}
        {bytes(row.size)}
        {row.homepage && (
          <>
            {" · "}
            <a href={row.homepage} rel="noopener noreferrer">
              Homepage
            </a>
          </>
        )}
        {row.repository && (
          <>
            {" · "}
            <a href={row.repository} rel="noopener noreferrer">
              Source
            </a>
          </>
        )}
      </p>
      {shots.length > 0 && (
        <div class="shots">
          {shots.map((_, index) => (
            <img
              src={`/api/extensions/${encodeURIComponent(row.name)}/screenshots/${index}`}
              alt=""
              loading="lazy"
            />
          ))}
        </div>
      )}
      <h2>Permissions</h2>
      {permissions.length === 0 ? (
        <p class="muted">This extension asks for no permissions.</p>
      ) : (
        <p>
          {permissions.map((permission) => (
            <span class="badge">
              <code>{permission}</code>
            </span>
          ))}
        </p>
      )}
      <h2>Integrity</h2>
      <p class="muted">
        SHA-256: <code>{row.sha256}</code>
      </p>
      <p class="muted">
        Signature (Ed25519): <code>{row.signature}</code>
      </p>
      <h2>Versions</h2>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Published</th>
            <th>Size</th>
            <th>Downloads</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr>
              <td>
                {version.yanked === 1 ? (
                  <>
                    {version.version} <span class="badge">yanked</span>
                  </>
                ) : (
                  <a href={downloadUrl(origin, version.name, version.version)}>{version.version}</a>
                )}
              </td>
              <td>{date(version.published_at)}</td>
              <td>{bytes(version.size)}</td>
              <td>{version.downloads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>,
  );
});
